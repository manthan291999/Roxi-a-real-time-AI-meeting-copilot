# 📊 LLM Usage Dashboard

A zero-build developer dashboard that shows **every LLM request** this project
makes — tokens, latency, cost, errors, the actual prompts sent, and a map of
where each call lives in the codebase.

```
dashboard/
├── package.json          # express + better-sqlite3 only
├── server.js             # read-only REST API + serves the UI
├── codemap.json          # "where are API calls made" map (authored from audit)
├── lib/schema.js         # shared DDL + pricing (seed script)
├── scripts/seed-demo.js  # demo rows so you can view the UI without a live meeting
└── public/               # single-page dark UI (vanilla JS + Chart.js CDN)
```

## Quick start

```bash
cd dashboard
npm install
npm run smoke     # validate the recording layer (no API key needed)
npm run seed      # optional: demo data (add -- --reset to wipe first)
npm start         # → http://localhost:3300
```

Or from the repo root: `npm run dashboard` (seeds nothing; runs the server).

With real data, no seeding is needed: run the Tauri app (or the chatbot) and
every LLM call is recorded automatically into `gateway/llm_usage.db`.

## The four tabs

| Tab | What it answers |
|---|---|
| 📊 **Overview** | Totals (requests, ok/failed, tokens in/out, cost, avg/p95 latency), tokens-over-time, cumulative cost, calls-per-agent, latency distribution, per-agent rollup, sessions (one sidecar pid = one session). |
| 📋 **Requests** | Filterable, paginated table of every request (source, tag, model, status, tokens, cost, latency, attempts). Click a row to inspect it. |
| 🔎 **Request Detail** | The exact request sent to the LLM: full messages array (system + user), params (model, max_tokens, expect_json, timeout), response preview, usage breakdown, retry count, error info, and **which file/function made the call** (matched from the code map). |
| 🗺️ **API Call Map** | Static reference of every LLM call site (file, function, tag, agent config, prompt purpose, pricing) plus the non-LLM APIs (AssemblyAI / Speechmatics STT). |

## REST API

| Endpoint | Description |
|---|---|
| `GET /api/health` | DB path/availability + pricing table |
| `GET /api/summary` | Global totals incl. avg & p95 latency |
| `GET /api/requests?source=&tag=&model=&status=&from=&to=&limit=&offset=` | Paginated request list |
| `GET /api/requests/:id` | Full request incl. parsed messages payload |
| `GET /api/by-agent` | Rollup grouped by source + tag |
| `GET /api/timeline?bucket=auto\|minute\|hour` | Tokens/cost/calls per time bucket |
| `GET /api/sessions` | Grouped by pid (one sidecar run = one session) |
| `GET /api/latency-histogram` | Latency buckets for ok calls |
| `GET /api/codemap` | The authored call-site map + pricing |

## Data dictionary — table `llm_requests`

| Column | Meaning |
|---|---|
| `ts` | ISO timestamp of the call |
| `source` | `gateway` (capture pipeline) or `chatbot` (Ask Roxi) |
| `tag` | Call tag / agent name (`analyst`, `generate`, `summary`, …) |
| `provider`, `endpoint` | e.g. `openai` → `https://api.openai.com/v1/chat/completions` |
| `model` | e.g. `gpt-5.6-luna` |
| `expect_json`, `max_tokens`, `timeout_ms` | Request params |
| `status`, `error_code`, `error_message` | `ok` / `failed` + why |
| `attempts`, `latency_ms` | Attempts incl. retries; wall time incl. retries |
| `prompt_tokens`, `completion_tokens`, `total_tokens` | Token usage per request |
| `cost_usd` | Priced via `MODEL_PRICES` (billing-tracker.js) |
| `request_messages` | Serialized messages array (truncated to 16k chars) |
| `response_preview` | First 2k chars of the completion |
| `pid` | Process id — groups rows into sessions |

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `LLM_USAGE_DB` | `gateway/llm_usage.db` | DB file used by writers **and** the dashboard |
| `LLM_TRACK_PAYLOADS` | `1` | Set `0` to stop storing prompts/responses (privacy) |
| `LLM_USAGE_TRACKING` | `1` | Set `0` to disable recording entirely |
| `DASHBOARD_PORT` | `3300` | Dashboard HTTP port |

## Architecture notes

- **Writers:** `gateway/infrastructure/usage-store.js` (hooked into
  `gateway/llm/openai-client.js`) and
  `chatbot/src/infrastructure/usage/UsageRecorder.js` (injected into both LLM
  adapters by the chatbot composition root). Both are best-effort and **never
  throw** — tracking can't kill a live meeting or a chat reply.
- **Reader:** `server.js` opens the DB **read-only**; it can run while a
  meeting is being recorded (SQLite WAL).
- **Decoupling:** the dashboard has no dependency on gateway/chatbot code; the
  chatbot never imports gateway code (it writes the same file with the same
  idempotent schema). `meeting_history.db` and its Rust read path are untouched.
- **Privacy:** everything stays local. Payloads are truncated and can be
  disabled with `LLM_TRACK_PAYLOADS=0`. The DB file is git-ignored (`*.db`).
- Chart.js loads from a CDN; if it's blocked the tables still render.
