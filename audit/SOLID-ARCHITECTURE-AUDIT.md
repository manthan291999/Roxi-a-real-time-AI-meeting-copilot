# 🏗️ SOLID & Architecture Audit Report — Meeting Interpreter (Roxi AI)

**Date:** September 8, 2026
**Scope:** All source folders — `src/` (React/TS frontend) · `src-tauri/` (Rust host) · `gateway/` (STT sidecar) · `chatbot/` (RAG sidecar) · `dashboard/` (usage dashboard)
**Focus:** SOLID principles compliance + code and folder decoupling
**Method:** ~90 source files reviewed. All boundary claims verified mechanically (import searches, instantiation searches) — not from comments alone.

---

## 1. Executive Summary

| Module | SOLID | Decoupling | Verdict |
|---|---|---|---|
| `src-tauri/` (Rust core) | ⭐ 9.5/10 | ⭐ 9.5/10 | Textbook hexagonal architecture |
| `chatbot/` (Node RAG) | ⭐ 9/10 | ⭐ 9/10 | Textbook clean architecture |
| `src/` (React frontend) | ⭐ 9/10 | ⭐ 9/10 | Clean DI + feature-sliced design |
| `gateway/` (Node STT) | ⭐ 8/10 | ⭐ 8.5/10 | Good composition, one fat repository |
| `dashboard/` (dev tool) | ⭐ 5.5/10 | ⭐ 6/10 | Pragmatic monolith, duplicated schema |

**Overall: ~8.5/10 — a genuinely well-architected codebase.** Every runtime module has an explicit composition root, dependency inversion is *enforced* (not just intended), and the inter-process boundaries (IPC, stdio framing, SQLite single-writer rule) are documented in the code itself. Weaknesses are concentrated in the dashboard and a handful of localized spots — none of them structural.

---

## 2. Project Topology (how the modules decouple)

```
┌─────────────────┐  Tauri invoke/events   ┌──────────────────┐
│  src/ (React)   │ ◄────────────────────► │ src-tauri (Rust) │
│  UI + hooks     │  (wire types+mappers)  │ use cases + ports│
└─────────────────┘                       └───┬──────────┬───┘
                          framed PCM1/CTL1    │          │ JSON stdio
                          over stdin/stdout   ▼          ▼
                      ┌────────────────┐   ┌────────────────┐
                      │ gateway (STT)  │   │ chatbot (RAG)  │
                      │ sole DB writer │   │ read-only DB   │
                      └───────┬────────┘   └───────┬────────┘
                              │  shared SQLite (WAL) │
                              ▼                     ▼
                    meeting_history.db ◄── llm_usage.db ──► dashboard (read-only)
```

**Zero source-level coupling between modules** — cross-module imports (`require('../../gateway')`, `import from '../../chatbot'`, etc.) were searched: **none exist**. All integration goes through protocols and files, and the ownership rules are written into the module docs (e.g. `gateway/db/index.js`: *"the gateway is the sole writer of meeting_history.db … to avoid WAL write contention"*).

---

## 3. SOLID Analysis — Principle by Principle

### ✅ S — Single Responsibility (strong, with 4 localized exceptions)

**Evidence of discipline:**

- **Frontend:** largest file is 172 lines (`UsagePill.tsx`). Each feature folder splits *components* from *hooks*, and hooks split *concerns*: `useCaptureFlow` (screen sequencing) is deliberately separate from `useCaptureSession` (session lifecycle) — the comment says exactly why. `App.tsx` is only a composition root ("picks the screen… flow rules live in useCaptureFlow, not here").
- **Rust:** `brief_usecase.rs` explicitly separates *"the I/O half of the brain; `agents::brief::compiler` is the pure half"*. `SessionRegistry` is split from `CaptureUseCase` with a documented rationale (identity/state vs. machinery that starts/stops). `lib.rs` is pure composition (188 lines, no logic). Commands are thin adapters calling use cases.
- **Gateway:** `sidecar.js` states *"This file only wires collaborators together"* — and it does. `db/index.js` is a dedicated persistence composition root returning three narrow repositories.
- **Chatbot:** `AnswerQuestionUseCase` = *"the single application entry point the transports depend on"*; nodes are single-purpose graph steps; `sidecar.js` is 39 lines.

**Exceptions found:**

| # | Location | Issue | Severity |
|---|---|---|---|
| F1 | `gateway/db/meeting-repository.js` (378 lines) | One class owns: meeting lifecycle, chunk inserts, risks, decisions, action items, analyses, replies, summaries, speaker-profile upserts, glossary upserts (11 prepared statements). Cohesive around "one meeting's artifacts," but it is the gateway's SRP hotspot. Splitting artifact persistence from meeting lifecycle would help. | 🟡 Medium |
| F2 | `src-tauri/src/sidecar/event_router.rs` (318 lines) | Mixes two concerns: (a) event dispatch (match → `app.emit`) and (b) concurrency policy — two module-level semaphores, permit acquisition, detached-lane shedding. The throttling policy deserves its own module the router calls. | 🟡 Medium |
| F3 | `dashboard/public/app.js` (582 lines) | All views, router, charts, formatters in one vanilla-JS file. Acceptable for a no-build-step dev tool, but it is the largest source file in the repo. | 🟡 Medium |
| F4 | `src-tauri/src/commands/documents.rs` | `upload_document`/`list_documents`/`delete_document` all repeat the identical `start_session(callback) + send(payload)` dance — a small DRY/ISP miss (the chat client's "ensure started" concern leaks into every command). `commands/chat.rs` handles this differently. | 🟢 Low |

### ✅ O — Open/Closed (strong)

- **Frontend `ServicesProvider`:** accepts `services?: Partial<IServices>` overrides — *"harnesses and previews inject fakes without the components knowing the difference."* Extension without modification, implemented literally.
- **Rust `LlmCallMeta` (llm_port.rs):** the comment is an OCP lesson: fields are passed as *one struct* so *"adding the next field — a budget hint, a trace id — does not re-sign every agent and every fake,"* and new methods were avoided because they would *"force every agent's fake in every test to implement something almost none of them call."*
- **Chatbot `CompositeEvidenceSource`:** *"retrieveNode gets one EvidenceSource and cannot tell how many corpora are behind it. Adding a source is one more entry in this array"* (container.js). The RAG graph is extended by registration, not modification.
- **Gateway provider chain:** `buildChain(cfg.stt)` — adding an STT provider means adding a module + registry entry; `ProviderManager` code does not change.

### ✅ L — Liskov Substitution (strong)

- **Rust:** every port has `Arc<dyn Trait>` consumers — `CaptureUseCase` accepts *any* `AudioCapture`, `GatewayClient`, `ProjectRepository`; agents accept *any* `LlmClient`. Fake-vs-real substitution is exercised by inline `#[cfg(test)]` modules (e.g. `session_registry.rs` tests run against pure domain objects, no DB).
- **Chatbot:** **two interchangeable LLM gateways** (`OpenAiLlmGateway` for models with parameter quirks, `LangchainLlmGateway` for standard ones), swapped by config in the container — the port's JSDoc explicitly names this *"Liskov."*
- **Gateway:** `ISttProvider` has a **runtime conformance checker** (`checkSttProvider`/`checkFinalEvent`) plus a contract test suite (`test/stt-provider-contract.test.js`) — the doc explains it exists because two providers silently diverged on the `confidence` field once. This is LSP enforcement done right for a language without interfaces.

### ✅ I — Interface Segregation (strong, one note)

- **Frontend:** **8 narrow interfaces** (`ICaptureService` = 3 methods, `IChatService` = 2, plus `IEventBus`, `IHistoryRepository`, `ISpeakerRepository`, `IProjectRepository`, `IDocumentService`, `IUsageRepository`). Components receive exactly the service they use via `useServices()`.
- **Rust:** ports are tiny and role-named — `AudioCapture` (2 methods), `GatewayClient` (3), `PcmSink` (2), `Agent` (2), `LlmClient` (2 + parameter object).
- **Chatbot:** 9 single-purpose ports (`LlmGateway`, `EmbeddingGateway`, `EvidenceSource`, `DocumentRepository`, `MeetingStore`, `ChatLogger`, `BudgetGuard`, `Retriever`, `DocumentParser`).
- 🟢 **Note:** `IEventBus` carries ~20 subscription methods spanning chat, transcript, documents, capture and usage events. Every feature subscribes to the full bus but uses a slice. Splitting per domain (`IChatEvents`, `ITranscriptEvents`, …) would be textbook ISP; as-is it is a pragmatic hub (Tauri events are global anyway). **Low.**

### ✅ D — Dependency Inversion (excellent — the codebase's best trait)

Verified mechanically, not just by comments:

- **Frontend:** `@tauri-apps/*` imports exist **only** inside `src/services/*` (verified by search). No component or hook ever calls `invoke()` directly (verified). Concrete classes (`new TauriCaptureService()` etc.) appear **only** in `ServicesProvider.tsx`. UI depends on `src/shared/interfaces` + `src/shared/types` only.
- **Wire isolation:** `src/services/wire/wireTypes.ts` (*"must only be referenced by service adapters and their mappers — never by UI"*) + pure mappers (`suggestCardMapper.ts`: *"Pure, so it is unit-testable without Tauri"*) mean a Rust field rename cannot ripple into components. Verified: wire imports exist only under `src/services/`.
- **Rust:** `lib.rs` constructs every `Arc<dyn Trait>` and injects — no `Sqlite…`/`Mac…` concrete type is known above the adapters. Even the **model-tier decision is centralized**: `agent_registry.rs` — *"Every model-tier decision is made here and nowhere else — no agent hardcodes its own model."*
- **Chatbot:** `composition/container.js` — *"the ONLY module that knows concrete implementations… Dependency Injection by hand, no framework needed."* True: grep confirms infrastructure classes are required nowhere else.
- **Gateway:** `sidecar.js` + `db/index.js` as dual composition roots; collaborators receive *narrow slices* ("the diarization layer gets the 4-method speaker repository, not the whole session").

---

## 4. Decoupling & Folder Structure Assessment

### 4.1 What is done exceptionally well

1. **Five modules, five composition roots, zero cross-imports.** Each process entry (`lib.rs`, `sidecar.js` ×2, `ServicesProvider.tsx`, `server.js`) is the only place concrete wiring happens.
2. **Protocol-first inter-process boundaries:** framed PCM (`PCM1` magic + LE length in `streaming.rs` ↔ `gateway/audio/pcm-deframer.js`), control frames on the same pipe (`control_channel.rs` ↔ `command-handler.js`), JSON-lines stdio for the chatbot. Each side documents the other as the source of truth.
3. **Single-writer DB rule** (gateway writes `meeting_history.db`; Rust + chatbot read; dashboard opens read-only with `busy_timeout`) — prevents WAL contention *by design*; Rust's pipeline artifacts are sent back over the control channel (`sidecar/persistence.rs`) rather than written directly.
4. **Domain safety in types:** Rust newtypes (`SessionId`, `ProjectId` — *"at that many call sites an untyped integer is indistinguishable from a meeting id"*) and the `ProjectSelection` sum type (*"both set" is unrepresentable instead of merely unhandled*). Frontend mirrors this with `ChatThreadId` and `SuggestTag` union types.
5. **Feature-sliced frontend:** `features/{capture,chat,history,library,suggest,transcript,usage}` each with barrel `index.ts`, components and hooks; `design-system/` isolated with tokens + barrel; `shared/{types,interfaces,ui}` as the stable bottom layer. Import direction is consistently downward.
6. **Degradation-aware design:** `BriefUseCase`'s graded failure policy, `ChunkGraph`'s per-agent error swallowing, `CaptureUseCase`'s full unwind on failed start — failure paths are engineered, not incidental.

### 4.2 Issues & risks (ranked)

| # | Finding | Location | Severity |
|---|---|---|---|
| D1 | **Duplicated schema DDL + `MODEL_PRICES`** across `dashboard/lib/schema.js`, gateway usage-store, chatbot UsageRecorder. The sync is comment-enforced only ("SCHEMA SYNC: keep identical to…") — a price or column change in one place silently drifts. | `dashboard/lib/schema.js` | 🟡 Medium |
| D2 | **Runtime databases inside source trees** — `gateway/llm_usage.db(+wal/shm)`, `gateway/meeting_history.db(+wal/shm)`, `chatbot/data/*.db(+wal/shm)` sit next to source files. Data belongs in an ignored `data/` path. | `gateway/`, `chatbot/data/` | 🟡 Medium |
| D3 | **No frontend tests at all** — root `package.json` `test` script runs only chatbot; `lint` is `tsc --noEmit`. The DI scaffolding (`ServicesProvider` overrides, pure mappers) was *built* for testability but no harness uses it. | `src/` | 🟡 Medium |
| D4 | `dashboard/server.js` (304 lines) keeps every route inline in one file — no router/controller split, unlike every other module. | `dashboard/` | 🟢 Low |
| D5 | `sqlite.rs` (`Database` port impl) opens a **new SQLite connection per call** rather than holding one — inconsistent with the `busy_timeout`-holding pattern other adapters use; fine for read paths, wasteful at scale. | `src-tauri/src/adapters/sqlite.rs` | 🟢 Low |
| D6 | `TauriEventBus.onApiHealth(cb: (health: any) => void)` — an `any` at a boundary that already has typed siblings. | `src/services/TauriEventBus.ts:90` | 🟢 Low |
| D7 | The Rust `agents/` tree contains a **nested second hexagon** (its own `domain/`, `ports/`, `adapters/`, `orchestrator/`) inside the crate-level one. Well-organized, but a candidate for its own crate if the pipeline grows. | `src-tauri/src/agents/` | ⚪ Info |
| D8 | `SqliteDatabase::get_meeting_details` maps `start_time/end_time` with hardcoded `0.0` — the read model drops timing data the table has. Data fidelity, not coupling. | `src-tauri/src/adapters/sqlite.rs:79` | 🟢 Low |

---

## 5. Module Scorecards (detail)

### 5.1 `src-tauri/` — Rust host (SOLID 9.5, Decoupling 9.5)

- **Structure:** `domain/` (pure types + logic + tests) → `ports/` (10 traits) → `adapters/` (SQLite ×5, mac audio, gateway/chat clients) → `application/` (use cases + registries) → `commands/` (thin Tauri handlers) → `sidecar/` (event routing + persistence commands) → `agents/` (pipeline sub-architecture).
- **Highlights:** every collaborator injected as `Arc<dyn Trait>`; `ChunkGraph` takes `Arc<dyn Agent>` for all six agents (strategy orchestration with fast/slow lanes); `LlmCallMeta` parameter object; inline tests on domain logic; comments document *why* (ownership, ordering, failure policy) — rare and valuable.
- **Docks:** F2 (event_router concurrency policy), F4 (documents command duplication), D5, D8.

### 5.2 `chatbot/` — RAG sidecar (SOLID 9, Decoupling 9)

- **Structure:** `domain/ports` (9) → `application/{useCases,graph,nodes,retrieval}` → `infrastructure/{llm,embedding,persistence,documents,logging,budget,usage}` → `composition/container.js` → `transport/{stdioSidecar,cliRepl}`.
- **Highlights:** factory-injected nodes (`createRetrieveNode({evidenceSource, logger})`); composite pattern over `EvidenceSource` with three corpora behind one port; dual LLM gateways (LSP); `skipLlm` override mode for index-only tooling; 17 test suites including parser/registry/protocol tests; sidecar entry is 39 lines with a documented crash-resilience policy.
- **Docks:** `DocumentRepositorySqlite` (299 lines) and `IndexDocumentUseCase` (265) are the size ceiling but remain single-purpose.

### 5.3 `src/` — React frontend (SOLID 9, Decoupling 9)

- **Structure:** `shared/{types,interfaces,ui}` ← `services/{adapters,mappers,wire}` ← `context` (DI) ← `features/*` ← `shell` ← `app`.
- **Highlights:** dependency direction strictly one-way; wire types quarantined from UI (verified); optimistic-update-with-rollback in `SpeakerRepository`; O(1) dedup in `useSuggestAnswers`; thread-scoped chat events with the `accepts()` guard documenting a real past bug.
- **Docks:** no tests (D3), wide `IEventBus` (ISP note), one `any` (D6).

### 5.4 `gateway/` — STT sidecar (SOLID 8, Decoupling 8.5)

- **Structure:** `interfaces/` (contracts) + `providers/` (AssemblyAI, Speechmatics) + `stt/` (manager, registry, pipeline, diarization, sanitizer) + `db/` (composition root + 4 repositories + migrations) + `audio/`, `control/`, `infrastructure/`, `lifecycle/`.
- **Highlights:** provider failover chain with 5-second replay ring; runtime interface conformance + contract tests; never-throw repositories ("a database failure must not kill the live pipeline"); documented flush-ordering fix in `MeetingSession.close()`.
- **Docks:** F1 (fat meeting repository), runtime `.db` files in tree (D2).

### 5.5 `dashboard/` — usage dashboard (SOLID 5.5, Decoupling 6)

- **Structure:** `server.js` + `lib/schema.js` + `public/` (single-file SPA) + `scripts/`.
- **Highlights:** read-only DB, graceful no-data degradation, query logic isolated in `lib/schema.js` — a *conscious* tradeoff for a dev tool.
- **Docks:** D1 (schema/price duplication — highest real drift risk in the repo), D4 (route monolith), F3 (582-line SPA). No tests.

---

## 6. Recommendations (priority order)

1. **Kill the schema/pricing triple-maintenance (D1):** extract the `llm_requests` DDL and `MODEL_PRICES` into one shared file (a tiny npm package or a JSON both processes read), or generate the dashboard copy from the gateway source in CI. Today a price change in `billing-tracker.js` makes the dashboard's cost math silently wrong.
2. **Move runtime DBs out of source folders (D2):** point `llm_usage.db`/`meeting_history.db`/`chat_index.db` at an ignored `data/` directory and remove the committed `*.db`, `*-wal`, `*-shm` files from the repo.
3. **Split `gateway/db/meeting-repository.js` (F1):** extract an `ArtifactRepository` (chunks/risks/decisions/actions/replies/glossary) from the meeting lifecycle (start/end/summary). Both stay scoped to `meetingId`; each halves in size.
4. **Extract the concurrency policy from `event_router.rs` (F2):** a `pipeline_slots.rs` owning the two semaphores + acquire/shed decisions, leaving the router a pure event→emit dispatcher.
5. **Add a frontend test harness (D3):** the architecture is begging for it — `ServicesProvider` already accepts fakes, mappers are pure. Start with `suggestCardMapper` + `useCaptureSession` (fake `ICaptureService`/`IEventBus`) and `useChatThread`'s `accepts()` guard.
6. **Deduplicate the documents commands (F4):** a `with_chat_session(|chat| …)` helper in `commands/documents.rs`.
7. **Optional:** split `IEventBus` per feature domain; give the dashboard a router split + extract `MODEL_PRICES` per #1.

---

## 7. Final Verdict

The codebase follows SOLID **substantially better than typical production projects** — particularly Dependency Inversion, which is enforced end-to-end in all four runtime modules (verified by import searches, not just comments), and Interface Segregation at the port level. Decoupling is equally strong: five independently deployable processes communicating purely through protocols, with documented data ownership.

The real action items are the **dashboard's duplicated schema/pricing (drift risk)**, **runtime databases committed in source trees**, **the fat meeting repository in the gateway**, and **the missing frontend test harness** — all fixable without touching the core architecture, which needs no restructuring.

---

*Report generated by automated architecture review, September 8, 2026. File inventory at time of audit: 5 runtime modules across 4 stacks (TypeScript/React, Rust, Node.js, vanilla JS) — ~80 Rust source files (~8.2k lines), ~110 frontend TS/TSX files (~5.9k lines), ~30 gateway JS files (~4.5k lines), ~45 chatbot JS source files (~4.6k lines) plus 17 test suites.*
