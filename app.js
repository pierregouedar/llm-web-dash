'use strict';

const KEY = 'llm_dash_host';
const APIKEY_KEY = 'llm_dash_key';
const POLL_KEY = 'llm_dash_poll';
let host = localStorage.getItem(KEY) || '';
let apiKey = localStorage.getItem(APIKEY_KEY) || '';
let pollMs = Number(localStorage.getItem(POLL_KEY)) || 3000;
let activity = [];        // [{t, rate}] generation tokens/s over time
let reqRows = [];         // recent request rows (bounded)
let refreshInterval;     // periodic refresh handle
let sseController;       // abort handle for live SSE stream

const $ = (id) => document.getElementById(id);

// Load config.json (defaults), then localStorage (user overrides).
fetch('config.json').then(r => r.ok ? r.json() : {}).then(cfg => {
  host = localStorage.getItem(KEY) || cfg.host || host;
  apiKey = localStorage.getItem(APIKEY_KEY) || cfg.apiKey || apiKey;
  pollMs = Number(localStorage.getItem(POLL_KEY)) || cfg.pollMs || pollMs;
  init();
}).catch(() => init());

function init() {
  $('hostInput').value = host;
  $('hostKeyInput').value = apiKey;
  $('pollInput').value = pollMs || 3000;
  $('hostLabel').textContent = host || '—';
  $('saveBtn').addEventListener('click', () => {
    host = $('hostInput').value.trim().replace(/\/+$/, '');
    apiKey = $('hostKeyInput').value.trim();
    pollMs = Number($('pollInput').value) || 3000;
    localStorage.setItem(KEY, host);
    localStorage.setItem(APIKEY_KEY, apiKey);
    localStorage.setItem(POLL_KEY, pollMs);
    $('hostLabel').textContent = host || '—';
    // Restart periodic refresh and live SSE with the new config.
    clearInterval(refreshInterval);
    refreshInterval = setInterval(refresh, pollMs);
    connectEvents();
    refresh();
  });
  renderModels([]);
  refreshInterval = setInterval(refresh, pollMs);
  connectEvents();
}


function api(path) { return host + path; }

// Headers carry the API key for auth-protected llama-swap servers.
function headers() {
  const h = { 'Accept': 'application/json' };
  if (apiKey) h['x-api-key'] = apiKey;
  return h;
}

function setConn(ok) {
  $('connDot').className = 'dot ' + (ok ? 'ok' : 'err');
}

// --- Formatting helpers -----------------------------------------------------
function fmtBytes(b) {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i];
}
function fmtNum(n, d = 1) { return n == null ? '—' : Number(n).toFixed(d); }
function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms.toFixed(0) + ' ms';
  return (ms / 1000).toFixed(1) + ' s';
}
function stateClass(s) {
  const v = String(s || '').toLowerCase();
  if (v === '200' || v === 'ready' || v === 'running' || v === 'loaded') return 'loaded';
  if (/^\d\d\d$/.test(v) && Number(v) >= 400) return 'stopped';
  if (v.includes('start') || v === 'loading') return 'starting';
  if (v === 'idle') return 'idle';
  return 'stopped';
}
function stateLabel(s) {
  const v = String(s || '');
  if (/^\d{3}$/.test(v)) return Number(v) >= 400 ? 'échoué (' + v + ')' : 'réussi';
  const t = v.toLowerCase();
  if (t === 'loaded' || t === 'ready' || t === 'running') return 'chargé';
  if (t.includes('start') || t === 'loading') return 'démarrage';
  if (t === 'idle') return 'inactif';
  if (t === 'stopped' || t === 'unloaded') return 'arrêté';
  return v || 'inconnu';
}

// --- Rendering --------------------------------------------------------------
// Live GPU/RAM from the Prometheus /metrics endpoint (real-time usage),
// not the /api/hardware startup snapshot (capacities only).
function renderHw(metrics) {
  const g = metrics.gpu;
  if (g) {
    const pct = g.total ? Math.round((g.used / g.total) * 100) : null;
    $('vramVal').textContent = g.total
      ? `${fmtBytes(g.used)} / ${fmtBytes(g.total)} (${pct}%)`
      : fmtBytes(g.used);
    $('vramBar').style.width = (pct ?? 0) + '%';
  }
  $('gpuVal').textContent = g.name || '—';
  $('nvidiaVal').textContent = g.util != null ? `${Math.round(g.util)}% GPU` : '—';

  const m = metrics.mem;
  if (m) {
    const pct = m.total ? Math.round((m.used / m.total) * 100) : null;
    $('ramVal').textContent = m.total
      ? `${fmtBytes(m.used)} / ${fmtBytes(m.total)} (${pct}%)`
      : fmtBytes(m.used);
    $('ramBar').style.width = (pct ?? 0) + '%';
  }
}

function renderModels(models) {
  const body = $('modelsBody');
  if (!models.length) { body.innerHTML = '<div class="empty">Aucun modèle configuré</div>'; return; }
  body.innerHTML = models.map(m => `
    <div class="model-head">
      <div>
        <div class="model-name">${escapeHtml(m.name || m.id)}</div>
        <div class="model-meta">${escapeHtml(m.name || m.id)} · <span class="state ${stateClass(m.state)}">${stateLabel(m.state)}</span></div>
      </div>
      <div class="btns">
        <button class="btn-wake" onclick="wake('${escapeAttr(m.id)}')">▶ Réveiller</button>
        <button class="btn-unload" onclick="unload('${escapeAttr(m.id)}')">■ Décharger</button>
      </div>
    </div>
  `).join('');
}

function renderQueue(running) {
  const body = $('queueBody');
  const busy = (running || []).filter(r => {
    const s = (r.state || '').toLowerCase();
    return s.includes('start') || s === 'loading';
  });
  if (!busy.length) { body.innerHTML = '<div class="empty">Rien en cours de démarrage</div>'; return; }
  body.innerHTML = busy.map(r => `
    <div class="queue-item">
      <b>${escapeHtml(r.name || r.model)}</b>
      <span class="state ${stateClass(r.state)}">${stateLabel(r.state)}</span>
      <div class="muted" style="font-size:11px">${escapeHtml(r.cmd || '')}</div>
    </div>`).join('');
}

function renderRequests() {
  const tbody = $('reqTable').querySelector('tbody');
  $('reqEmpty').style.display = reqRows.length ? 'none' : 'block';
  tbody.innerHTML = reqRows.map(r => {
    const t = r.tokens || {};
    const d = fmtDur(r.duration_ms);
    const rate = fmtNum(t.tokens_per_second);
    return `
    <tr>
      <td>${escapeHtml(new Date(r.timestamp).toLocaleTimeString('fr-FR'))}</td>
      <td>${escapeHtml(r.model)}</td>
      <td><span class="state ${stateClass(r.resp_status_code || '')}">${stateLabel(r.resp_status_code || '')}</span></td>
      <td class="num">${fmtNum(t.input_tokens, 0)}</td>
      <td class="num">${fmtNum(t.output_tokens, 0)}</td>
      <td class="num">${d}</td>
      <td class="num">${rate}</td>
    </tr>`;
  }).join('');
}

function renderActivity() {
  const c = $('activityCanvas');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; ctx.scale(dpr, dpr); }
  ctx.clearRect(0, 0, w, h);
  if (activity.length < 2) {
    ctx.fillStyle = '#8b949e'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('collecte en cours…', w / 2, h / 2); return;
  }
  const max = Math.max(1, ...activity.map(a => a.rate));
  const n = activity.length;
  ctx.beginPath();
  activity.forEach((a, i) => {
    const x = (i / (n - 1)) * w;
    const y = h - (a.rate / max) * (h - 4) - 2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.lineTo(w, h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(88,166,255,.4)'); g.addColorStop(1, 'rgba(88,166,255,0)');
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();
  activity.forEach((a, i) => {
    const x = (i / (n - 1)) * w;
    const y = h - (a.rate / max) * (h - 4) - 2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.5; ctx.stroke();
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return String(s).replace(/'/g, "\\'"); }

// Parse Prometheus text into { gpu: {name, used, total, util}, mem: {used, total} }.
function parseMetrics(text) {
  const out = { gpu: null, mem: null };
  const gpuByName = new Map();
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const sp = s.lastIndexOf(' ');
    if (sp < 0) continue;
    const name = s.slice(0, sp);
    let val = parseFloat(s.slice(sp + 1));
    if (Number.isNaN(val)) continue;
    // Extract labels like {id="0",name="NVIDIA GeForce RTX 3080"}.
    let gpuName = null;
    const m = s.match(/\{([^}]*)\}/);
    if (m) {
      const nm = m[1].match(/name="([^"]*)"/);
      if (nm) gpuName = nm[1];
    }
    if (name.startsWith('llamaswap_gpu_memory_used_bytes')) {
      const g = gpuByName.get(gpuName) || (gpuByName.set(gpuName, { name: gpuName, used: 0, total: 0, util: null }) && gpuByName.get(gpuName));
      g.used = val;
    } else if (name.startsWith('llamaswap_gpu_memory_total_bytes')) {
      const g = gpuByName.get(gpuName) || (gpuByName.set(gpuName, { name: gpuName, used: 0, total: 0, util: null }) && gpuByName.get(gpuName));
      g.total = val;
    } else if (name.startsWith('llamaswap_gpu_util_percent')) {
      const g = gpuByName.get(gpuName) || (gpuByName.set(gpuName, { name: gpuName, used: 0, total: 0, util: null }) && gpuByName.get(gpuName));
      g.util = val;
    } else if (name === 'llamaswap_memory_used_bytes') { out.mem = out.mem || {}; out.mem.used = val; }
    else if (name === 'llamaswap_memory_total_bytes') { out.mem = out.mem || {}; out.mem.total = val; }
  }
  // Pick the real GPU: dedicated VRAM, not the software "Render Driver".
  for (const g of gpuByName.values()) {
    if (!g.name || /microsoft|render driver|basic/i.test(g.name)) continue;
    if (g.total && g.total > 0) { out.gpu = g; break; }
  }
  return out;
}

// --- Actions ----------------------------------------------------------------
// llama-swap has no dedicated "load" endpoint: a model wakes on first
// inference request. So wake() sends a tiny chat completion that is discarded.
async function wake(model) {
  try {
    const r = await fetch(api('/v1/chat/completions'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'wake' }], max_tokens: 1, temperature: 0 }),
    });
    if (!r.ok) { flash('⚠ Réveil échoué (' + r.status + ') ' + model); return; }
    flash('▶ Réveil ' + model);
  } catch (e) {
    alert('Réveil échoué : ' + e.message);
  }
  setTimeout(refresh, 500);
}
window.wake = wake;

async function unload(model) {
  const r = await fetch(api('/api/models/unload/' + encodeURIComponent(model)), { method: 'POST', headers: headers() });
  if (r.ok) flash('■ Déchargement ' + model); else alert('Déchargement échoué (' + r.status + ')');
  refresh();
}
window.unload = unload;

function flash(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#161b22;border:1px solid #58a6ff;color:#e6edf3;padding:8px 16px;border-radius:8px;z-index:999';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// --- Polling ----------------------------------------------------------------
async function refresh() {
  try {
    const [hw, running, activityData, ver] = await Promise.all([
      fetch(api('/metrics'), { headers: headers() }).then(r => r.ok ? r.text() : null).then(t => t ? parseMetrics(t) : null),
      fetch(api('/running'), { headers: headers() }).then(r => r.ok ? r.json() : { running: [] }),
      fetch(api('/api/metrics/activity?limit=50'), { headers: headers() }).then(r => r.ok ? r.json() : null),
      fetch(api('/api/version'), { headers: headers() }).then(r => r.ok ? r.json().then(j => j.version) : null).catch(() => null),
    ]);
    if (hw) renderHw(hw);
    if (running) renderQueue(running.running || []);
    if (activityData) {
      const rows = (activityData.data || []).slice(0, 50);
      // Latest successful row per model -> live tok/s for the throughput panel.
      const byModel = new Map();
      rows.forEach(r => {
        if (r.tokens && r.tokens.tokens_per_second > 0) byModel.set(r.model, r.tokens);
      });
      const rates = [...byModel.values()];
      if (rates.length) {
        const g = rates.reduce((s, t) => s + t.tokens_per_second, 0) / rates.length;
        const p = rates.reduce((s, t) => s + t.prompt_per_second, 0) / rates.length;
        $('outRateVal').textContent = fmtNum(g) + ' tok/s';
        $('inRateVal').textContent = fmtNum(p) + ' tok/s';
        activity.push({ t: Date.now(), rate: g });
        if (activity.length > 60) activity.shift();
        renderActivity();
      }
      reqRows = rows;
      renderRequests();
    }
    if (ver) $('ver').textContent = ver;
    setConn(true);
    $('lastUpdate').textContent = 'mis à jour ' + new Date().toLocaleTimeString('fr-FR');
  } catch (e) {
    setConn(false);
    const lbl = $('hostLabel');
    $('connText').innerHTML = '<span style="color:var(--error)">hors ligne — vérifiez l\'hôte</span>' + (lbl ? ' <b id="hostLabel">' + lbl.textContent + '</b>' : '');
    console.warn('poll failed', e);
  }
}

// --- Live model list via SSE ----------------------------------------------
// /api/events leads with the full model list (msgTypeModelStatus) then streams
// state changes. Uses a fetch-based reader because EventSource cannot send the
// x-api-key header required by auth-protected servers.
function connectEvents() {
  if (sseController) { try { sseController.abort(); } catch (_) {} }
  let reader, controller;
  async function stream() {
    try {
      const res = await fetch(api('/api/events'), { headers: headers() });
      if (!res.ok) { setConn(false); setTimeout(stream, 3000); return; }
      controller = new AbortController();
      sseController = controller;
      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          handleSSE(chunk);
        }
      }
    } catch (e) { /* connection closed; reconnect below */ }
    setTimeout(stream, 3000);
  }
  function handleSSE(chunk) {
    let data = null;
    for (const rawLine of chunk.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('data:')) data = (data ? data + '\n' : '') + line.slice(5).trimStart();
    }
    if (!data) return;
    let msg;
    try { msg = JSON.parse(data); } catch (_) { return; }
    if (msg.type !== 'modelStatus') return;
    let list = msg.data;
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch (_) { return; } }
    renderModels(list.filter(m => !m.unlisted));
  }
  stream();
}
