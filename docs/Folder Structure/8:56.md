# The Meeting Cartridge — full implementation plan

## Context

You asked me to implement the architecture memo "The Meeting Cartridge" (artifact `bcba9c87…`) end-to-end in this repo, then show what the full system architecture looks like once it's built, and to ground the plan's latency expectations in research on how comparable real-time AI-meeting/interview copilots (Parakeet AI, Pluely) and the underlying STT/LLM providers actually perform.

The memo's core claim: on a hosted OpenAI API there is no way to keep an uploaded document "inside the model" between calls — the only lever that survives between calls is OpenAI's automatic prefix-based prompt cache. The product-shaped version of that idea is a **meeting cartridge**: compile the uploaded document once, at capture start, into a ≤1500-token brief; prepend it (plus a shared "charter") to every agent's prompt for that meeting, byte-identical every time, so the cache actually engages; and stop treating "the document" as something re-sent or retrieved per chunk.

I verified the memo's claims against the live working tree (which has moved on from the memo's cited commit `66c6b1f` in some places) using two rounds of codebase investigation, and had two independent design passes work out the Rust side and the frontend/gateway/dashboard side. Findings that materially change the plan from a literal reading of the memo:

- The memo's headline bug (`ChunkGraph` stage-2 fan-out passing `ChunkState::default()` to 4 agents) **is already fixed** in the current working tree — verified by reading `chunk_graph.rs` directly. Nothing to do there.
- There are **6 live LLM agents**, not 7 (`complexity_analyzer.rs` is dead code, folded into `context_manager`). Preambles are ~35-90 tokens each, not 150-250 — real but modest shared boilerplate, not near-duplicates.
- `capture_usecase.rs::start(context, role, ...)` forwards both only to the gateway sidecar's argv — confirmed directly, `ChunkGraph::run(&self, chunk: &str, speaker: &str)` has no way to receive them today, and no meeting id ever reaches Rust either (a gap the memo doesn't mention, but which blocks per-meeting cartridge caching entirely).
- The role slug bug is real and independent of everything else: `gateway/sidecar.js`'s `ROLE_PROFILES` keys (`pm`, `tech_lead`, …) never match the human labels (`"Project Manager"`, `"Technical Lead"`, …) the frontend actually sends, so every session silently runs as `tech_lead`.
- There is no document-upload UI anywhere in `context-intake/` today — building the cartridge means building that field, not just the compile pipeline behind it.
- `rig-core 0.2.1` (the current LLM client crate) exposes no `prompt_cache_key` and no structured-output hook. Getting either requires swapping to `async-openai`, which I verified (against its actual source, v0.41.3) does expose both, plus the real `usage.prompt_tokens_details.cached_tokens` field needed to measure whether any of this worked.
- A live OpenAI community report claims strict `response_format: json_schema` can suppress prompt-cache writes entirely on some models — a real risk for `response_agent` (the one agent this whole feature exists to make cheaper), which the plan below builds in a fallback for rather than discovering after shipping.

Decisions already made with you: the §05 "affect layer" (prosody/emotion) is **design-only** this pass — a stubbed seam, no model; the LLM client **migrates to `async-openai`** now; document upload is **built now**, not deferred.

---

## Workstream A — `PromptFrame` / `LlmClient` v2 (prerequisite for everything else)

**Files:** `src-tauri/src/agents/ports/llm_port.rs`, all 6 agent files under `src-tauri/src/agents/agents/`, `src-tauri/src/agents/domain/chunk_state.rs`.

Replace the current two-string trait —
```rust
async fn complete(&self, system: &str, user: &str) -> Result<String>;
```
— with an explicit three-part frame that makes prefix ordering a type-level invariant instead of a call-site convention:
```rust
pub struct PromptFrame<'a> {
    pub cache_key: String,        // "meeting:{id}:agent:{tag}" — routing hint, not the cache identity itself
    pub prefix: Arc<str>,         // charter + cartridge. Byte-identical per meeting. Never mutate mid-session.
    pub instructions: &'a str,    // this agent's own distinct instruction body
    pub input: String,            // rolling window + chunk + speaker + affect seam — changes every call
    pub json_schema: Option<JsonSchemaSpec>,
    pub max_completion_tokens: Option<u32>,
}
pub trait LlmClient: Send + Sync {
    async fn complete(&self, frame: PromptFrame<'_>) -> Result<String>;
    async fn complete_json(&self, frame: PromptFrame<'_>) -> Result<Value>;
}
```
Every call is sent as exactly `[system(prefix), system(instructions), user(input)]`, in that order, everywhere (6 agents + the new compile agent + warm-up/heartbeat). This ordering is what lets OpenAI's cache match across agents on the shared segment — get it wrong at one call site and that agent silently stops caching, so add a doc comment on the struct spelling this out.

`ChunkState` (`agents/domain/chunk_state.rs`) gains the fields agents need to build a frame from `&ChunkState` alone (agents only ever see `&ChunkState`, so nothing else can carry this): `meeting_id: Option<i64>`, `cartridge_prefix: Arc<str>` (never `Option` — always at least the bare charter), `role: Option<String>`, `affect: Option<AffectVector>` (always `None` — the design-only seam, see Workstream E).

**Charter consolidation** (`src-tauri/src/agents/domain/charter.rs`, new): one shared `CHARTER` const holding the genuinely common framing, plus `build_prefix(cartridge: Option<&str>) -> Arc<str>`. Each agent keeps its own distinct `INSTRUCTIONS` + JSON schema in its own file, **minus** the "Return JSON… CRITICAL: Output ONLY raw JSON" boilerplate every agent currently repeats — moot once `response_format: json_schema` enforces shape at the API level (Workstream B).

**Open call resolved now, not deferred:** `ContextManagerAgent`'s `new_technical_terms: {"term": "definition"}` is a free-form dict, which strict JSON-schema mode can't express. Change the wire shape to `Vec<{term, definition}>` (schema-legal), converting to the internal `HashMap` after parsing — keeps `ChunkState`'s field type unchanged, only the LLM-facing contract changes.

---

## Workstream B — `OpenAiAdapter` on `async-openai`

**Files:** `src-tauri/Cargo.toml` (replace `rig-core = "0.2.1"` with `async-openai`, pinned — verify exact latest version with `cargo add` rather than trusting a version number written today), `src-tauri/src/agents/adapters/openai_adapter.rs` (full rewrite).

Verified directly against `async-openai`'s source: `CreateChatCompletionRequest` has `prompt_cache_key: Option<String>` and `response_format: Option<ResponseFormat>` where `ResponseFormat::JsonSchema { json_schema: { name, schema, strict, description } }` is a real variant; the response's `usage.prompt_tokens_details.cached_tokens` is the real field to read for cache-hit instrumentation (not an estimate).

Rewrite `complete`/`complete_json` to build a `CreateChatCompletionRequest` from `PromptFrame` (three ordered messages, `prompt_cache_key` set from `frame.cache_key`, `response_format` set when `frame.json_schema` is `Some`), call `self.client.chat().create(request)`, and — this replaces the current fragile "slice between first `{` and last `}`" parser — `complete_json` becomes a direct `serde_json::from_str(&content)`, since `response_format: json_schema` guarantees valid matching JSON. Keep the old brace-scrape only as a fallback if `from_str` ever fails (defense in depth, not the primary path).

**Risk to build a fallback for, not discover in production:** strict `json_schema` mode has been reported to suppress prompt-cache writes on some models. Give `JsonSchemaSpec` a `strict: bool` field so `response_agent` (the one agent on the premium `gpt-5.6-luna` model, and the one this whole feature exists to make cheaper) can be flipped to non-strict or `json_object` mode independently of the other five agents if the new cache-hit instrumentation (Workstream D) shows strict mode is zeroing out its cache writes. Don't wait to find out — build the knob now.

Read real usage from the response instead of estimating: `prompt_tokens`, `completion_tokens`, `cached_tokens` (`Option`, `None` for calls that predate this or hit a provider omitting the field) all flow into the `usage_store.rs` row (Workstream D).

---

## Workstream C — cartridge domain, compile pipeline, and the plumbing to reach it

**New files:** `src-tauri/src/agents/domain/meeting_brief.rs` (the `MeetingBrief` struct: entities/glossary, numeric facts, prior decisions/open questions, known risks, stakeholder map, user role — rendered via `to_prefix_block()` into the ≤1500-token prose block that actually gets embedded), `src-tauri/src/agents/agents/compile_agent.rs` (one-shot, not a per-chunk `Agent` — single premium-model call below a conservative ~10k-token document-length threshold, map-reduce above it; the threshold needs tuning once `gpt-5.6-luna`'s real context window is confirmed, flag it as a named constant so it's easy to find), `src-tauri/src/agents/domain/document_extract.rs` (`extract_text(path: &Path) -> Result<String>` — PDF via the `pdf-extract` crate, pure-Rust and dependency-free of any system library, important since this ships as a signed `.app`; `.txt`/`.md` passthrough by extension), `src-tauri/src/application/session_context.rs` (a `SessionStore` — single slot, not a map, since `capture_usecase.rs` already refuses a second concurrent session: `meeting_id`, `role`, `cartridge_prefix`, updated in place as the compile task and the meeting-id event land asynchronously).

**Where the cartridge is persisted — deliberately not the memo's literal suggestion.** The memo (and one of my design passes) suggested adding a `cartridge` column to `meeting_history.db`'s `meetings` table, which is currently owned end-to-end by the gateway (`gateway/db/migrate.js`, forward-only migrations; `CLAUDE.md` documents it as "two independent SQLite databases... never joined," with Rust as a read-only consumer via `adapters/sqlite.rs`). Making Rust a second writer to that table works, but it's a real, needless boundary crossing. Instead: **a new table in `llm_usage.db`**, which Rust already owns and writes to via `usage_store.rs`'s existing connection pattern — `meeting_cartridges(meeting_id INTEGER PRIMARY KEY, role TEXT, cartridge TEXT, created_at INTEGER)`. No gateway migration, no dual-writer concern, no change to the documented DB ownership split. `meeting_history.db` and its migration file are untouched by this entire feature.

**Closing the "Rust never learns the meeting id" gap** (required regardless of the storage choice above, since the cartridge must be keyed by something): `gateway/sidecar.js` gains one new stdout line after `initDB()` resolves — `{"type":"MeetingStarted","meetingId":...}` — following the exact pattern every other sidecar event already uses. `src-tauri/src/sidecar/events.rs` gains a `MeetingStarted` variant; `event_router.rs` gains a match arm that calls `session_store.set_meeting_id(id)`. This is additive to the existing typed JSON-line protocol, not a new channel.

**Trigger and timing:** `capture_usecase.rs::start()` spawns the compile pass as a background `tauri::async_runtime` task immediately after starting the sidecar/audio capture — it never blocks meeting start on document parsing + an LLM round-trip. Concretely: extract text → `CompileAgent::compile()` → `SessionStore::update_cartridge()` (patches the live prefix) → persist to `meeting_cartridges` once both the compiled brief and the meeting id have landed (order between them is not guaranteed, so persistence is gated on "both present," not "compile finished"). This means the first handful of chunks in a meeting see a charter-only prefix, then the rest see charter+cartridge — an intentional small cold-start window, not a bug. `event_router.rs`'s call into `ChunkGraph::run` reads the current `SessionStore` snapshot (`meeting_id`, `cartridge_prefix`, `role`) and sets them on the `ChunkState` it builds, which is the only change needed to `ChunkGraph`/`event_router.rs` itself — `ChunkGraph::run`'s signature and internal stage logic don't need to change at all.

**Document upload — path-based, not bytes-based.** The frontend uses `@tauri-apps/plugin-dialog`'s `open()` (new JS + Rust dependency; register in `lib.rs`'s plugin chain; add a `dialog:allow-open` capability to `src-tauri/capabilities/default.json`) to get an absolute filesystem path from the native picker, and sends that path — never file bytes — to `start_capture`. This avoids a new `plugin-fs` dependency, a 33%-larger base64 payload, and matches the existing pattern where Rust (not the webview) touches the filesystem. `start_capture` (`commands/capture.rs`) gains `document_path: Option<String>`, forwarded through `capture_usecase.start()` into the extraction step above. Filters: `pdf`, `txt`, `md`. A size/type cap (10-20MB suggested) is enforced Rust-side when the file is read, surfaced as a plain `Err(String)` — which is also the fix for a separate, real gap: **`useCaptureSession.ts` today discards the actual error message on a `startCapture` rejection, and `App.tsx` has no UI branch for `status === 'error'` at all** — a document/compile failure would currently be invisible to the user. Add: an `errorMessage` returned from `useCaptureSession`, a new `CaptureErrorNotice.tsx` (same card shell as the existing `BlackholeNotice.tsx`), and an `App.tsx` branch for `status === 'error'` rendering it with a retry action.

**Role slug fix (independent bug, fixed here since it touches the same `start_capture` contract):** add `slug` to each `MeetingRole` in `presets.ts` (`pm`, `tech_lead`, `client`, `designer`, `executive` — matching `ROLE_PROFILES`'s existing keys exactly), thread a new `roleSlug` field through the mapper and a new `role_slug: Option<String>` param through `start_capture` → `capture_usecase.start()` → `GatewayClient::start_session()` → a **new** `--role-slug` argv (leave the existing `--role`/human-label argv alone — Rust's own agents may want the human label later, and it's otherwise harmless). `gateway/sidecar.js` reads `--role-slug` instead of `--role` for its `ROLE_PROFILES` lookup. This is fully self-contained and can be built and shipped independently of the rest of this plan.

---

## Workstream D — instrumentation (cached-token tracking, dashboard)

**Files:** `src-tauri/src/agents/adapters/usage_store.rs` (add `cached_tokens INTEGER` via an `ALTER TABLE` guarded against "duplicate column" on repeated runs — there's no migration runner for this db today, worth adding a tiny schema-version table now rather than repeating the swallow-the-error hack later; `UsageEntry` gains `cached_tokens: Option<i64>`; `calculate_cost` splits prompt tokens into cached vs. uncached at their respective rates instead of one flat rate), `dashboard/lib/schema.js` (mirror the same column so seeded demo data can exercise the new chart), `dashboard/scripts/seed-demo.js` (extend the per-tag `PROFILES` table with a cache-hit fraction — seed the 6 agents' current sub-1024-token prompts at ~0%, since they're below OpenAI's cache minimum today, plus a couple of higher-token synthetic variants showing the post-cartridge picture), `dashboard/server.js` (`cached_tokens`/`cache_hit_rate` added to `/api/summary`, `/api/by-agent`, `/api/timeline`), `dashboard/public/app.js` (a "Cache hit rate" stat card, a new timeline chart with `spanGaps:false` so pre-threshold buckets render as a gap rather than a misleading flat 0%, two new columns on the existing per-agent table, plus a static explanatory note about the 1024-token minimum).

---

## Workstream E — affect-layer seam (design-only, per your decision)

No model, no prosody extraction, no SER encoder this pass. The only change: `AffectVector` (valence/arousal/dominance/label/confidence) exists as a type in `llm_port.rs`, `ChunkState.affect: Option<AffectVector>` always resolves to `None`, and `routing::decide()` / `ResponseAgent`'s prompt input accept-but-ignore it (a comment marking exactly where a future real value would plug in). This gives Workstream A's `PromptFrame.input` the seam without building the ML pipeline the memo describes in §05 — which the EU AI Act question alone makes worth a separate, deliberate decision later.

---

## Workstream F — cache warm-up + heartbeat

One throwaway `complete()` call per agent (not `complete_json` — sidesteps the strict-schema-cache risk entirely) immediately after compile finishes, then every ~4 minutes during silence (tracked via a "last chunk processed at" timestamp in `SessionStore`, updated from `event_router.rs`'s existing `Final` handler — skip the tick if a real chunk landed more recently than the interval). Spawned from `capture_usecase.rs::start()` alongside the compile task, `.abort()`'d in `stop()`.

**Worth checking before building the heavier half of this:** OpenAI's docs reference a `prompt_cache_retention` option that can extend the default few-minutes cache TTL to 24h — if it's accepted on the Chat Completions endpoint (unconfirmed from this pass; test with a raw request once Workstream B lands), most meetings wouldn't need a periodic heartbeat at all, only the one warm-up call. Build the warm-up call regardless; treat the recurring heartbeat as conditional on that answer.

---

## Sequencing

1. **Workstream A** (PromptFrame/trait/charter) — true prerequisite; every agent call site changes here.
2. **Workstream B** (async-openai swap) — depends on A's frame shape.
3. **Workstream C** (cartridge/compile/upload/role-slug) — depends on A+B for the compile agent itself; the role-slug fix and the upload UI's *mechanics* (plugin, types, command signature) are independently shippable today, verifiable with a Rust-side stub before the real extraction/compile pipeline exists.
4. **Workstream D** (instrumentation) — schema can land any time after A; only becomes meaningful once B produces real `cached_tokens`. Dashboard half is independently shippable now against seeded demo data.
5. **Workstream F** (warm-up/heartbeat) — depends on B (needs `prompt_cache_key`/structured output) and C (needs `SessionStore`'s lifecycle hooks).
6. **Workstream E** (affect seam) — a handful of lines, can land anywhere after A; has no dependents blocking on it.

---

## The full system architecture after this lands

```
 Document (PDF/txt/md)                    MeetingContextModal
        │  picked via                      description + role + ← NEW: document picker
        │  plugin-dialog (path only)             │
        ▼                                        ▼
 start_capture(context, role, role_slug, document_path) ── invoke ──▶ commands/capture.rs
                                                                            │
                              ┌─────────────────────────────────────────────┤
                              ▼                                             ▼
                    capture_usecase.start()                         gateway_client.start_session(
                              │                                       context, role, role_slug)
              ┌───────────────┼────────────────────┐                        │
              ▼               ▼                    ▼                spawn node sidecar.js
   spawn: compile task   spawn: warm-up/      audio capture starts    --role-slug (NEW, fixes
   (background)          heartbeat task       (unchanged)             ROLE_PROFILES lookup)
        │                     │                                              │
        ▼                     │                                     initDB() → stdout:
  document_extract::           │                                     {"type":"MeetingStarted",
  extract_text(path)           │                                      "meetingId": N}   ← NEW
        │                     │                                              │
        ▼                     │                                              ▼
  CompileAgent.compile()       │                                    event_router.rs: new
  (async-openai,               │                                    MeetingStarted arm →
   structured JSON,            │                                    SessionStore.set_meeting_id
   map-reduce if long)         │                                              │
        │                     │                                              │
        ▼                     ▼                                              ▼
  MeetingBrief.to_prefix_block()  ◀── SessionStore (single slot: meeting_id, role,
        │                            cartridge_prefix — patched in-place as async
        ▼                            pieces land; read once per chunk)
  charter.rs::build_prefix()              │
        │                                 │
        ▼                                 │
  persisted → llm_usage.db                │
  new table: meeting_cartridges           │
  (Rust-owned; meeting_history.db         │
   untouched — no gateway migration)      │
                                           │
  ══════════ per finalized transcript chunk ═══════════
                                           │
  gateway sidecar: STT (AssemblyAI/Speechmatics) → diarization
        │ stdout: Final { text, speaker }
        ▼
  event_router.rs: reads SessionStore snapshot, builds ChunkState
  { chunk_text, speaker, meeting_id, role, cartridge_prefix, affect: None }
        │
        ▼
  ChunkGraph::run(chunk, speaker)          ← unchanged signature; ChunkState now
        │                                     carries the cartridge in from event_router
        ▼
  chit_chat_gate (local, 0 LLM calls)
        │ not filler
        ▼
  Stage 1 (parallel):  context_manager ‖ explanation
        │   both build PromptFrame{ prefix: cartridge, instructions: <own>, input: chunk+affect }
        │   → OpenAiAdapter (async-openai) → prompt_cache_key + response_format:json_schema
        │   → OpenAI: cache hits on `prefix` once it's ≥~1024 tokens and byte-identical
        ▼
  routing::decide() — Low / Medium / High (affect is a future soft-prior input; None today)
        │
        ├─ Low:    (done — no response_agent)
        ├─ Medium: + risk DETACHED (off critical path)
        └─ High:   + technical AWAITED, + risk/analyst DETACHED
        ▼
  response_agent (gpt-5.6-luna, sequential, last — skipped entirely on Low)
        │  same PromptFrame discipline; strict-mode flag independently tunable
        │  if cache-hit instrumentation shows strict json_schema kills its cache writes
        ▼
  Tauri events: context_explanation, technical_explanation, meeting_risks,
  meeting_decisions, meeting_action_items, suggested_response
        │
        ▼
  Frontend (main/toolbar/caption windows) renders as today — no event shape changes

  ══════════ side channel: usage & dashboard ═══════════
  every OpenAiAdapter call → usage_store.rs → llm_usage.db.llm_requests
     (+ cached_tokens, from response.usage.prompt_tokens_details.cached_tokens)
        │
        ▼
  dashboard/server.js → /api/summary, /api/by-agent, /api/timeline (+ cache_hit_rate)
        │
        ▼
  dashboard/public/app.js → new "cache hit rate" stat card + timeline chart + per-agent columns
```

Everything below the "per finalized transcript chunk" divider is exactly today's `ChunkGraph` fast-lane/slow-lane structure (chit-chat gate → parallel stage 1 → conditional stage 2 → sequential response) — **unchanged**. The cartridge work only changes *what's in the prompt* each agent sends, not the orchestration shape, which is why `ChunkGraph::run`'s signature doesn't need to change at all.

---

## Latency: research and target budget

**What comparable "real-time" copilots actually deliver**, from current research (not assumed):
- **Parakeet AI** (interview/meeting copilot, closest product comparison): vendor claims sub-2-second median answer surfacing; independent reviews report the more typical **2-5 second end-to-end** latency for this category (audio capture → STT → LLM → render) — consistent enough across sources to treat as the realistic bar for a copilot that reasons with an LLM, not just transcribes. [Sources: interviewchamp.ai, finalroundai.com blog on live-interview-support tools]
- **Pluely** (this repo's closest architectural cousin — desktop overlay, system-audio capture, multiple pluggable STT backends including Deepgram/Whisper/Groq): no published latency numbers found; its design (VAD-triggered response, "answers after every pause") is the same class of pipeline as this app's `chit_chat_gate` + chunk-based triggering, just without a documented number to benchmark against. [Source: docs.pluely.com, pluely.com/features/system-audio-capture]
- **NVIDIA Parakeet (the ASR model family, not the copilot product — easy to conflate)**: an on-device streaming model, ~1.12s algorithmic latency at 13+1 lookahead frames, RTFx >2000 — this is a *self-hosted* model class, a different category from this app's cloud STT providers, cited here only to calibrate what "fast local STT" looks like. [Source: arxiv 2604.14493, HuggingFace nvidia/parakeet-unified-en-0.6b]
- **This app's actual STT providers**: AssemblyAI's streaming API returns partials at **~300ms P50**; Speechmatics delivers **~500ms partials, sub-1s finals**. Both are already fast enough that STT is not this pipeline's bottleneck — the LLM chain is. [Sources: assemblyai.com/blog/real-time-speech-to-text-best-for-voice-agents, speechmatics.com/how-we-compare/assemblyai-alternative]
- **OpenAI prompt caching**: automatic above ~1024 prompt tokens, 128-token match granularity, up to **~80% TTFT reduction** and **~90% input-cost reduction** on the cached portion — this only discounts/speeds up the *input* side of a call, not output-token generation time, which matters because this pipeline's agents mostly emit short structured JSON (generation time, not prompt processing, is close to the floor already for those calls). [Sources: openai.com/index/api-prompt-caching, developers.openai.com/api/docs/guides/prompt-caching]
- **gpt-4o-class TTFT**: cited P50 ~820ms / P95 ~1.9s for the full-size model; `gpt-4o-mini` (what 5 of this app's 6 agents run on) is generally faster on TTFT at the cost of some throughput — treat the 4o figure as a conservative upper bound for mini, not mini's actual number, since no mini-specific P50/P95 was found in this pass. [Source: digitalapplied.com/blog/ai-model-latency-benchmarks-2026-ttft-throughput]

**Target budget for this pipeline** (final transcript chunk → UI-visible output), building on the already-optimized `ChunkGraph` fast-lane/slow-lane structure documented in `chunk_graph.rs`'s own comments (1 sequential LLM hop on Low, 2 on Medium, 3 on High):

| Route | Critical-path LLM hops | Target P50 | Target P95 | Notes |
|---|---|---|---|---|
| Low | 1 (context_manager ‖ explanation, parallel) | < 1.2s | < 2.5s | response_agent skipped entirely |
| Medium | 2 (stage 1 parallel → response_agent) | < 2.0s | < 4.0s | risk runs detached, doesn't add latency |
| High | 3 (stage 1 parallel → technical → response_agent) | < 3.0s | < 6.0s | risk+analyst detached; technical + response both sequential |

Add STT contribution on top (~300-500ms to the final transcript event, already excluded from the table above since it happens before `ChunkGraph::run` is even called). These targets sit at or below the 2-5s "typical copilot" bar the research above establishes, which is the honest comparison point — this app already has a latency-conscious pipeline shape; the cartridge work's job is to keep the High route's 3-hop cost from growing as the cartridge adds prompt bulk, by making sure that bulk is the cached, discounted part of every call rather than paid in full 6 times per chunk. **Instrumentation to verify this against reality, not just estimate it**: add per-hop latency breakdown (already logged via `PipelineTrace`/`AgentSpan`) plus the new `cached_tokens` column to the dashboard so P50/P95 per route can be measured directly once this ships, rather than trusted from the table above.

---

## Verification

- `cd src-tauri && cargo build` and `cargo test routing::` after Workstream A/B land — confirms the trait/adapter rewrite compiles and the existing routing unit tests still pass unmodified (routing logic itself doesn't change).
- Manual end-to-end: `npm run tauri dev`, start a capture session with a real PDF attached via the new picker, confirm (a) the file dialog returns a path and `start_capture` receives it, (b) a compiled cartridge appears in `llm_usage.db`'s new `meeting_cartridges` table, (c) subsequent agent calls' `request_messages` in `llm_requests` show the cartridge as a leading, byte-identical block.
- `npm run dashboard`, confirm the new cache-hit-rate stat/chart/columns render (against `npm run dashboard:seed` first if testing before a real session has run).
- Confirm the role-slug fix independently: start a session picking each of the 5 roles, check `gateway`'s logs (`user_profile_set`) show the correct role each time, not a `tech_lead` fallback.
- Confirm error surfacing: pick a corrupted/oversized file, verify `App.tsx` now shows the new error screen with a real message instead of silently sitting on a non-live shell.
- Once real sessions have run, pull P50/P95 per route from the dashboard/`PipelineTrace` logs and compare against the target budget table above — this is the actual verification of the latency claims in this plan, not the table itself.
