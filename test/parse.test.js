// Runs the real parseMetrics() from app.js against a real /metrics sample
// captured from the production llama-swap server (see test/fixtures/).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Extract only the parseMetrics source and eval it (indirect eval -> global scope).
const src = readFileSync(resolve(root, 'app.js'), 'utf8');
const start = src.indexOf('function parseMetrics');
const end = src.indexOf('\n}', start);
const evalFn = eval;
evalFn(src.slice(start, end + 2));

const metrics = readFileSync(resolve(here, 'fixtures/metrics-real-server.txt'), 'utf8');

const out = parseMetrics(metrics);

let pass = 0,
  fail = 0;
function check(label, got, want) {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'ok' : 'not ok'} - ${label}: got ${got}, want ${want}`);
}

// GPU selected by dedicated VRAM (RTX 3080, not a software render driver).
check('gpu.name', out.gpu?.name, 'NVIDIA GeForce RTX 3080');
check('gpu.util', out.gpu?.util, 43);
check('gpu.temp', out.gpu?.temp, 56);
check('gpu.power', out.gpu?.power, 223.75);
// 16 cores averaged.
check('cpu.avg rounded', Math.round(out.cpu), 32);
// Scientific-notation memory values parse correctly.
check('mem.used', out.mem?.used, 27996979200);
check('mem.total', out.mem?.total, 34258026496);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
