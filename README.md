# LLM Dashboard

> Lightweight, dependency-free web dashboard for monitoring **llama-swap** / **llama-cpp**
> model state on a machine anywhere on your network — meant to be hosted on a NAS.

[![Status](https://img.shields.io/badge/status-works%20against%20real%20llama%2Dswap%20metrics-38e0c9)](#features)
[![No dependencies](https://img.shields.io/badge/deps-0%20installed-7a8296)](#dependencies)
[![License](https://img.shields.io/badge/license-MIT-7a8296)](#license)
[![Language](https://img.shields.io/badge/lang-HTML%20%7C%20CSS%20%7C%20JS-7a8296)](#language)

![LLM Dashboard](./logo.svg)

---

## Features

- **Hardware** — VRAM, system RAM, GPU model, GPU utilization, CPU utilization, GPU temperature, GPU power draw — loaded *live* from Prometheus `/metrics`
- **Throughput** — generation and prompt tokens/s, with a 60-second rolling chart
- **Models** — state (loaded / starting / idle / stopped), Wake / Unload actions
- **Queue** — models currently starting up
- **Recent requests** — model, status, in/out tokens, latency, throughput


---

## Usage

The dashboard reads `config.json` at startup (host, API key, poll interval in ms), then
`localStorage` for user overrides. Editing `config.json` directly is enough to set the host
and key; the UI also lets you type everything manually and press **Connect**.

`config.json`:

```json
{ "host": "http://nas:8080", "apiKey": "", "pollMs": 3000 }
```

---

## llama-swap endpoints used

| Panel | Endpoint |
|-------|----------|
| Hardware | `GET /metrics` (Prometheus, live load) |
| Model state | `GET /running` |
| Throughput / requests | `GET /api/metrics/activity?limit=50` |
| Model list (live) | `GET /api/events` (SSE) |
| Version | `GET /api/version` |
| Wake | `POST /v1/chat/completions` (first request triggers the swap) |
| Unload | `POST /api/models/unload/{model}` |

> `llama-swap` has no dedicated "load" endpoint: a model wakes on its first inference
> request. So the **Wake** button sends a throwaway tiny completion; untested in production.

> The dashboard runs in the browser. `config.json` is read client-side, the API key is
> stored in `localStorage`, and sent in the `x-api-key` header on every request. Anyone who
> visits the site (or knows the NAS URL) can read the JSON and the `localStorage` — the key
> is in plaintext. Use a dedicated key scoped to the llama-swap API, and revoke it if exposed.

---

## Test with the mock

`mock-llama.js` serves a fake llama-swap API so you can try the dashboard without a real
machine:

```sh
node mock-llama.js index.html
# then open http://localhost:8123/ and enter http://localhost:8123 in the host field
```

---

## Dependencies

None. HTML/CSS/JS vanilla, compatible with recent browsers.

---

## License

MIT
