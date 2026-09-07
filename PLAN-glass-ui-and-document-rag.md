# Implementation Plan — Glass UI + Document RAG for "Ask Roxi"

Status: **for review, not yet started**
Date: 2026-09-07
Branch to cut from: `fix/triage-remediation`
Verified against: actual source, not `brain.md` / `README.md`

---

## 0. Corrections to the draft plan (verified in code)

These are things the draft assumed that the code does not support. They change the work, so they are settled up front.

| # | Draft said | Code actually says | Consequence |
|---|---|---|---|
| C-1 | "Glass works on macOS, Windows, Linux" | `src-tauri/Cargo.toml:39-49` puts `serde`, `serde_json`, `anyhow`, `rusqlite`, `cpal`, `hound`, `rubato`, `ctrlc`, `log`, `env_logger` under `[target.'cfg(target_os = "macos")'.dependencies]`. The crate **cannot compile** for Windows or Linux today. Plus `macOSPrivateApi: true`, `macos_overlay.rs`, and BlackHole-only loopback. | Part 1 ships **macOS-only**. The CSS is written cross-platform-correct (with the `@supports` fallback) so a future port needs no UI work, but "all platforms" is not a deliverable here. Porting is a separate, much larger job (per-platform audio loopback). |
| C-2 | "Lower shell opacity 0.97 → 0.35 and you're done" | `AppShell` is one alpha layer, but **20 files** paint opaque surfaces inside it (`tokens.panel` `#111318`, `tokens.panelRaised` `#17171D`, `--color-surface` `#13131b`). Lowering only the shell yields a translucent 1px border ring around a solid black app. | Transparency must be designed as an **opacity budget** across stacked layers (§1.1). Good news: all 20 files reference `tokens.*`, so changing `tokens.ts` propagates without touching call sites. |
| C-3 | "70% transparent, text 100% readable" | Physics: 3 stacked alpha layers at 0.35/0.20/0.45 transmit only `0.65 × 0.80 × 0.55 = 28.6%` of the desktop — not 70%. And at genuine 65% transmittance over a *white* desktop, `paper #F5F5F7` text lands at ~1.3:1 contrast — invisible. | Solved with `backdrop-filter: … brightness()` (§1.2), which dims the *backdrop* before compositing. This is exactly what macOS dark vibrancy does. It keeps 0.35 alpha **and** 12:1 text contrast, at the cost of the desktop looking darker through the glass. That tradeoff is inherent, not a bug. |
| C-4 | "`fastembed` for embeddings" | You want OpenAI. `chatbot/package.json` already has `openai@^4`, and `OPENAI_API_KEY` is already loaded by `chatbot/src/config/envConfig.js:45`. | Use `text-embedding-3-small` via the existing OpenAI dep. No new native/ONNX dependency. §2.2 has the cost math. |
| C-5 | "Qdrant or sqlite-vec" | 10 files × ~200 chunks = ~2,000 vectors. Brute-force cosine over 2,000 × 1,536 floats is ~3M FMAs — single-digit milliseconds in JS. | **Neither.** Plain `better-sqlite3` (already a dep) storing normalized Float32 BLOBs, cosine in-process. Zero new infra, zero new native artifact to bundle. Revisit only past ~50k chunks. |
| C-6 | "`retrieveNode` merge = Low risk, all other nodes unchanged" | `state.searchQueries` are **sanitized FTS5 MATCH expressions** (`ftsQuery.js:43`), not natural language — a vector retriever cannot use them. And `EvidenceHit.meetingId` is load-bearing in `evidence.js:21` (grouping), `evidence.js:50` (source shape) and `prompts.js:56` (`[M<meetingId>]` citations). Documents have no `meetingId`. | The citation/evidence path **must** change: `evidence.js`, `prompts.js`, `generateNode.js`, `constants.js`. Contained and testable, but not "unchanged". §2.4 specifies it. |
| C-7 | "Add a file picker" | No `tauri-plugin-dialog`, no `tauri-plugin-fs`. `src-tauri/capabilities/default.json` grants neither. | New Rust dep + new capability permission + new Tauri commands. §2.6. |
| C-8 | (not mentioned) | `ChatProvider` **and** `HistoryChatProvider` are both mounted in `src/app/App.tsx:72-76`, and both subscribe to the same global `chat_reply` / `chat_thinking` / `chat_error` events. **Every answer is appended to both threads.** | Live bug. Fixed as part of this work by threading `threadId` through the protocol (§2.3) — which is also the mechanism upload progress needs, so it is not scope creep. |
| C-9 | "`RoxiAnswerCard` already renders sources" | It reads `source.meeting_title` / `source.text` (`RoxiAnswerCard.tsx:69-74`), but the sidecar emits `{meetingId, date, speaker, snippet, sourceTable}` (`evidence.js:48-54`) and never emits a title. **Source snippets currently render blank.** | Fixed while we are already in this file. |
| C-10 | Reuse `RoxiAnswerCard` + `ThinkingIndicator` | They use `className="material-symbols-outlined"` but that font is loaded **nowhere** (`index.html` has no font link, no `@font-face`). They also use `animate-fade-in` and `animate-shimmer`, which are **not defined** in `keyframes.css`. | The icons currently render as the literal words `expand_more` / `memory`; the animations silently no-op. Both fixed in Part 1 (§1.4). |

---

## 1. Part 1 — Glassmorphism shell

### 1.1 The opacity budget (the one architectural rule)

> **Exactly one layer carries transparency: the shell. Every interior surface is either fully transparent, or a white overlay at ≤ 0.06 alpha.**

Why: transmittance multiplies. Stacking three dark alpha layers destroys see-through (C-2/C-3). Stacking *white* overlays at ≤0.06 costs almost nothing:

```
shell only:                  T = 1 − 0.35                       = 65.0% desktop visible
shell + white 0.04 + 0.06:   T = 0.65 × 0.96 × 0.94             = 58.7%   ← acceptable
shell + dark 0.20 + 0.45:    T = 0.65 × 0.80 × 0.55             = 28.6%   ← the draft's numbers
```

So: interior "panels" become `transparent`, and "raised" surfaces (cards, header, input bar) become `rgba(255,255,255,0.04)`. Depth comes from **hairlines and shadows**, not from opacity.

### 1.2 Readability: `brightness()` inside `backdrop-filter`

`backdrop-filter` filters run on the backdrop *before* the element's own background composites over it. So `brightness(0.35)` darkens whatever the desktop is showing, and only then does the 0.35 dark layer land on top:

```
white desktop, no brightness:   L ≈ 0.65·1.00 + 0.35·0.04 = 0.66  → #F5F5F7 text contrast ≈  1.3:1  ✗
white desktop, brightness(.35): L ≈ 0.65·0.23 + 0.35·0.04 = 0.16  → #F5F5F7 text contrast ≈ 12.0:1  ✓ AAA
```

Shapes, colours and motion from the desktop still read through — it just reads as *dark* frosted glass. `saturate(150%)` puts the colour back so it does not look like a grey sheet.

Final shell recipe:

```css
background: rgba(10, 10, 12, var(--glass-alpha));
backdrop-filter: blur(32px) saturate(150%) brightness(var(--glass-dim));
-webkit-backdrop-filter: blur(32px) saturate(150%) brightness(var(--glass-dim));
```

### 1.3 Tunables in one place

`src/styles.css` `:root`:

```css
--glass-alpha: 0.35;   /* dark layer alpha — lower = more see-through */
--glass-dim:   0.35;   /* backdrop brightness — lower = more readable text */
--glass-blur:  32px;
```

Two numbers, one file. If you want it glassier later, drop `--glass-alpha` to 0.25 and `--glass-dim` to 0.30 and re-check contrast; nothing else moves.

Linux / no-`backdrop-filter` fallback (correct today, useful only if C-1 is ever addressed):

```css
@supports not (backdrop-filter: blur(1px)) {
  :root { --glass-alpha: 0.88; }   /* no blur ⇒ no legibility guarantee ⇒ go near-opaque */
}
```

### 1.4 Files — Part 1

| File | Change |
|---|---|
| `src/styles.css` | Add the three `--glass-*` vars; `.glass-panel` → white-overlay recipe; add the `@supports not` fallback; **load Material Symbols** (self-hosted woff2 in `public/fonts/`, `@font-face` + the `.material-symbols-outlined` class — no CDN, `security.csp` is `null` but the app is offline-capable and a CDN font would break in a packaged bundle) — fixes C-10 |
| `src/design-system/keyframes.css` | Add `@keyframes fade-in` + `.animate-fade-in`, `@keyframes shimmer` + `.animate-shimmer`, both under the existing `prefers-reduced-motion` guard — fixes C-10 |
| `src/design-system/tokens.ts` | `panel: 'transparent'`, `panelRaised: 'rgba(255,255,255,0.04)'`, `hairline: 'rgba(255,255,255,0.10)'`, `hairlineSoft: 'rgba(255,255,255,0.05)'`. **`ink`, `paper`, `mute`, `muteDim`, `signal`, and every semantic tag colour are untouched** — text stays 100% opaque. Propagates to all 20 consumer files with no edits. |
| `src/shell/AppShell.tsx` | Background → `rgba(10,10,12,var(--glass-alpha))`; `backdropFilter` → the §1.2 recipe; keep the existing shadow stack |
| `src/features/history/MeetingDetailModal.tsx`, `src/features/transcript/SpeakerRenameModal.tsx` | These are sheets *over* the glass — they need their own readable ground. Give them `rgba(19,19,27,0.72)` + `blur(24px)`, not a `--glass-alpha`-derived value. |
| `src/features/capture/IdleScreen.tsx` | Verify the hero/CTA still reads at AA over glass; adjust only if measured below 4.5:1 |

### 1.5 Part 1 acceptance

- Desktop is visibly legible through the window in a screen recording, over **both** a white and a dark desktop background.
- Body text (`paper` on shell), muted text (`mute`), and the signal CTA all measure ≥ 4.5:1 in DevTools' contrast inspector over a **white** desktop (worst case).
- No `expand_more` / `memory` literal words anywhere in the UI.
- `npm run lint` clean.

---

## 2. Part 2 — Document RAG in the Ask tab

### 2.1 Design principle: one new port, three adapters, zero rewrites

The existing `Retriever` port (`chatbot/src/domain/ports/Retriever.js`) takes **FTS MATCH expressions**. A vector search needs **natural language**. Widening `Retriever.search()` would force `FtsRetriever` to accept an argument it does not want — an Interface Segregation violation, and it would break `respondNoDataNode`, which legitimately depends on `Retriever.recentTopics()`.

So: **a new, narrower port** beside it.

```
NEW  domain/ports/EvidenceSource.js
       search({ question, matchExprs, limit }) -> EvidenceHit[]

NEW  infrastructure/persistence/FtsEvidenceSource.js      Adapter over the existing FtsRetriever
                                                          (FtsRetriever.js is NOT modified)
NEW  infrastructure/documents/DocumentEvidenceSource.js   EmbeddingGateway + DocumentRepository
NEW  application/retrieval/CompositeEvidenceSource.js     fan-out (Promise.all) → RRF merge → quota
```

- **Single Responsibility** — parse / chunk / embed / store / search / merge are six classes, not one.
- **Open/Closed** — a fourth source later (Slack, Jira, Notion) is a new adapter registered in `container.js`. `retrieveNode` never changes again.
- **Liskov** — `CompositeEvidenceSource` *is* an `EvidenceSource`; the node cannot tell.
- **Dependency Inversion** — `retrieveNode` receives one `EvidenceSource`; `container.js` stays the only module that names concretes.

`retrieveNode.js` diff is ~4 lines: `retriever.search(state.searchQueries, …)` → `evidenceSource.search({ question: state.question, matchExprs: state.searchQueries, limit: MAX_HITS })`.

`FtsRetriever` stays injected into `respondNoDataNode` for `recentTopics()`, untouched.

### 2.2 Embeddings — OpenAI `text-embedding-3-small`

| | |
|---|---|
| Model | `text-embedding-3-small`, 1,536 dims |
| Price | $0.02 / 1M input tokens |
| **A 100-page PDF** | ~200 chunks × ~512 tok = ~102k tok ≈ **$0.002** (one fifth of one cent) |
| **Per question** | 1 query embedding, ~20 tok ≈ **$0.0000004** — free in practice |
| Batching | 64 chunks per request (API allows 2,048). 200 chunks = 4 HTTP calls. |
| Latency | ~300–600ms per batch ⇒ a 100-page PDF indexes in ~3s |

New port `domain/ports/EmbeddingGateway.js` (`embedBatch(texts) -> Float32Array[]`, `embedOne(text)`, `dimensions()`), adapter `infrastructure/embedding/OpenAiEmbeddingGateway.js`.

Design notes:
- **Normalize to unit length at write time.** Query-time similarity is then a plain dot product — no per-query `sqrt`.
- **Own budget guard.** Embeddings must not consume `CallCountBudgetGuard`'s chat budget, or uploading a doc would starve the chat. New `CHATBOT_EMBED_BUDGET_HARD` (default 400 calls/process).
- **Usage logging reuses `UsageRecorder`** with `tag: 'embed_document' | 'embed_query'`, so the existing `dashboard/` shows document cost with no dashboard change. Add `'text-embedding-3-small': { input: 0.02, output: 0 }` to `MODEL_PRICES` (`UsageRecorder.js:30`) — and to `gateway/infrastructure/billing-tracker.js` + `dashboard/lib/schema.js`, per the SCHEMA/PRICING SYNC comment at `UsageRecorder.js:10-15`.
- **Retry/backoff** mirrors `OpenAiLlmGateway` (429/5xx, 2 retries, exponential).

### 2.3 Protocol — additive, with thread correlation

Every message gains an optional `threadId`, echoed on every response. This is what fixes C-8 and routes upload progress.

**stdin (new):**
```jsonc
{ "type": "UploadDocument", "docId": "uuid", "filePath": "/abs/path/spec.pdf", "fileName": "spec.pdf" }
{ "type": "ListDocuments" }
{ "type": "DeleteDocument", "docId": "uuid" }
```
**stdout (new):**
```jsonc
{ "type": "DocumentProgress", "docId": "…", "phase": "parse|chunk|embed|store", "done": 128, "total": 200 }
{ "type": "DocumentReady",    "docId": "…", "fileName": "spec.pdf", "chunkCount": 200, "pageCount": 42 }
{ "type": "DocumentList",     "docs": [ { "docId": "…", "fileName": "…", "chunkCount": 200, "uploadedAt": "…", "bytes": 1048576 } ] }
{ "type": "DocumentDeleted",  "docId": "…" }
```
**stdout (changed — breaking, three-file lockstep per CLAUDE.md):**
```jsonc
{ "type": "ChatThinking", "threadId": "ask", "node": "retrieve" }   // was: node only
{ "type": "ChatReply",    "threadId": "ask", "payload": { … } }     // threadId added
{ "type": "Error",        "threadId": "ask", "message": "…", "code": "…" }
```

**Concurrency:** the current single `busy` flag (`stdioSidecar.js:39`) would make a 3-second upload reject questions with `BUSY`. Split into two independent lanes — `askBusy` and `docBusy` — so you can ask while a document indexes. `better-sqlite3` is synchronous, so there is no write interleaving hazard; the doc store is a separate DB file anyway (§2.5).

### 2.4 Generalizing evidence and citations (the real risk, contained)

`meetingId` is load-bearing in three places. Rather than faking a `meetingId` for documents, introduce an explicit **reference label** on every hit and cite *that*.

`EvidenceHit` gains:
```js
sourceType: 'meeting' | 'document'
ref:        'M3' | 'D2'          // stable within one answer; the citation token
docId?:     string               // documents only
fileName?:  string               // documents only
pageNumber?: number              // documents only
groupKey:   'meeting:3' | 'doc:abc'   // replaces meetingId for grouping
```

Changes:
- **`evidence.js`** — `boundEvidence` groups by `groupKey`, not `meetingId`. New **source quota**: when both source types have hits, guarantee ≥1 group from each, so a 200-chunk PDF cannot crowd out every meeting. `toSources` emits `sourceType`, `fileName`, `pageNumber` alongside the existing fields.
- **`prompts.js`** — `formatEvidenceBlock` prints `[M3] Meeting #3 · 2026-08-14 · transcripts · Ana` or `[D2] spec.pdf · page 4`. `GENERATE_SYSTEM` rule 6 becomes `citedRefs: ["M3","D2"]` (was `citedMeetingIds`). Rule 1's example is updated to show both.
- **`generateNode.js`** — reads `data.citedRefs`, **falls back to `data.citedMeetingIds`** mapped through `M<id>` so an in-flight model response of the old shape still works. `digestFallback` prints `[D2 spec.pdf p4]` for document hits.
- **`constants.js`** — `MAX_EVIDENCE_MEETINGS` → `MAX_EVIDENCE_GROUPS` (same value 4); add `MIN_GROUPS_PER_SOURCE_TYPE: 1`.
- **`gradeDocumentsNode.js`** — candidate lines use `h.ref` instead of `Meeting #${h.meetingId}`. Grading logic and prompt otherwise unchanged.

`clarifyNode` and `respondNoDataNode` are unchanged (they never touch `meetingId` for citation).

This is the part to review hardest: it is the only change to a shipped, working answer path.

### 2.5 Storage — own DB, own schema

`chatbot/data/doc_store.db`, **not** `chat_index.db`. `chat_index.db` is opened `readonly` by `FtsRetriever` and wholesale-rebuilt by `FtsIndexBuilder`; putting user documents in there couples their lifetime to an index rebuild. Separate file = separate ownership = the document module is deletable in one move.

```sql
CREATE TABLE IF NOT EXISTS documents (
  doc_id       TEXT PRIMARY KEY,
  file_name    TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  byte_size    INTEGER NOT NULL,
  page_count   INTEGER,
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  embed_model  TEXT NOT NULL,          -- provenance: re-embed if the model changes
  dimensions   INTEGER NOT NULL,
  status       TEXT NOT NULL,          -- indexing | ready | failed
  error_message TEXT,
  uploaded_at  TEXT NOT NULL,
  content_hash TEXT NOT NULL           -- sha256; dedupes re-uploads of the same file
);

CREATE TABLE IF NOT EXISTS document_chunks (
  chunk_id    TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  page_number INTEGER,
  char_start  INTEGER NOT NULL,
  char_end    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  embedding   BLOB NOT NULL            -- Float32LE[dimensions], L2-normalized
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(doc_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_hash ON documents(content_hash);
```

Every column name is self-explanatory. Forward-only migrations in `chatbot/src/infrastructure/documents/migrations.js`, matching the `gateway/db/migrate.js` convention — never edit a shipped one.

### 2.6 Rust + frontend wiring

**File picking:** native dialog, path only. The alternative (`<input type="file">` → bytes → base64 over IPC) would push 20MB through the webview bridge. Rejected.

```
frontend  → invoke("pick_document")   → tauri-plugin-dialog native picker → returns { path, fileName, bytes }
frontend  → invoke("upload_document") → Rust validates ext + size + existence
                                      → forwards { type:"UploadDocument", … } over the EXISTING
                                        ChatGatewayClient::send port (no port change)
sidecar   → DocumentProgress / DocumentReady
Rust      → chat_events.rs new arms → Tauri events document_progress / document_ready / …
```

Validation lives in Rust (fail fast, before spawning work) **and** in the sidecar (defence in depth): extension allowlist `pdf|txt|md|docx`, `MAX_DOCUMENT_BYTES = 20 MiB`, `MAX_DOCUMENTS = 10` (both env-overridable).

| Layer | File | Change |
|---|---|---|
| Rust | `src-tauri/Cargo.toml` | `+ tauri-plugin-dialog = "2"` |
| Rust | `src-tauri/capabilities/default.json` | `+ "dialog:allow-open"` |
| Rust | `src-tauri/src/lib.rs` | register the plugin; register 4 new commands in `invoke_handler!` |
| Rust | **[NEW]** `src-tauri/src/commands/documents.rs` | `pick_document`, `upload_document`, `list_documents`, `delete_document` — thin: validate, then `chat.send(json)` |
| Rust | `src-tauri/src/sidecar/chat_events.rs` | 4 new match arms; add `thread_id` passthrough on `ChatThinking`/`ChatReply`/`Error` |
| TS | **[NEW]** `src/shared/interfaces/IDocumentService.ts` | `pick()`, `upload(file)`, `list()`, `remove(docId)` |
| TS | **[NEW]** `src/services/TauriDocumentService.ts` | the four `invoke` calls |
| TS | **[NEW]** `src/shared/types/document.ts` | `UploadedDocument`, `DocumentPhase`, `DocumentProgress` |
| TS | `src/context/ServicesContext.ts` + `ServicesProvider.tsx` | 6th service registered (override-able for fakes, same as the other five) |
| TS | `src/shared/interfaces/IEventBus.ts` + `src/services/TauriEventBus.ts` | `onDocumentProgress`, `onDocumentReady`, `onDocumentList`, `onDocumentDeleted`; `onChatReply/Thinking/Error` callbacks gain `threadId` |
| TS | `src/shared/types/chat.ts` | `ChatSource` → `{ sourceType, meetingId?, docId?, fileName?, pageNumber?, date?, speaker?, snippet, sourceTable? }` — **snippet, matching the wire format** (fixes C-9) |

### 2.7 Frontend — de-duplicate, then extend

There are currently three near-identical pairs: `useChat`/`useHistoryChat`, `ChatInput`/`HistoryChatInput`, `ChatPane`/`HistoryChatPane`. The only real difference is `threadId` (`'default'` vs `'history'`) and some polish. Building the document UI twice would make it four pairs.

Collapse to one parameterized set first:

```
src/features/chat/
  useChatThread.ts          (threadId param; filters events by threadId — fixes C-8)
  ChatThreadProvider.tsx    (replaces ChatContext.tsx + HistoryChatContext.tsx)
  ChatPane.tsx              (one pane, used by both the ask tab and history)
  ChatInput.tsx             (the polished HistoryChatInput: rotating placeholder, focus ring, ⌘↵)
  components/
    RoxiAnswerCard.tsx      moved from history-chat/, + document source rendering
    ThinkingIndicator.tsx   moved from history-chat/
    UserBubble.tsx          extracted from the inline JSX in HistoryChatPane
    DocumentTray.tsx    [NEW]  horizontal pill strip above the input
    DocumentPill.tsx    [NEW]  filename + status ring + × delete
    DocumentUploadButton.tsx [NEW]  paperclip; calls documentService.pick() then upload()
    useDocumentLibrary.ts [NEW]  list/upload/delete + progress state; the ONLY consumer of IDocumentService
```

`src/features/history-chat/` is deleted; `src/features/history/HistoryPane.tsx` renders `<ChatPane threadId="history" />`.

`RoxiAnswerCard` source chips: 🎙️ + meeting date for `sourceType: 'meeting'`, 📄 + `fileName · p{pageNumber}` for `'document'`. Uses `snippet` (C-9 fix).

**Also:** `src/app/App.tsx:64` renders `<InputBar>` at the bottom *and* `ChatPane` renders its own `ChatInput` — two input boxes stacked on the ask tab. Hide `InputBar` when `activeTab === 'ask'`.

### 2.8 Retrieval quality — RRF, not score addition

BM25 gives `score = -bm25` (unbounded, negative); cosine gives 0…1. Adding or min-max normalizing them is unstable across queries. Use **Reciprocal Rank Fusion** — rank-based, scale-free, the standard hybrid-search merge:

```
rrf(hit) = Σ over sources  1 / (RRF_K + rank_in_that_source)      RRF_K = 60
```

Lives in a pure, unit-tested `application/retrieval/rrf.js`, mirroring how `orchestrator/routing.rs` and `graph/routing.js` are kept pure and tested.

Vector search additionally applies `MIN_COSINE_SIMILARITY = 0.25` before ranking — otherwise every query returns its top-k chunks regardless of relevance, and `grade_documents` burns tokens rejecting noise.

### 2.9 Chunking

No tokenizer dependency. `~4 chars/token` ⇒ **2,000-char chunks with 256-char overlap**, split on paragraph → sentence → hard-cut, in that order of preference. Page number is carried from the parser so citations can say `p4`.

Parsers behind one port (`domain/ports/DocumentParser.js`, `parse(filePath) -> { pages: [{ pageNumber, text }] }`), one adapter per format, selected by a small registry keyed on extension — adding `.pptx` later is one file:

| Format | Library | Note |
|---|---|---|
| `.txt`, `.md` | none | single synthetic page |
| `.pdf` | `pdf-parse` with a custom `pagerender` hook | pure JS, no native binary; gives **real page numbers**. If fidelity disappoints on your actual PDFs, swap the adapter for `pdfjs-dist` — the port makes that a one-file change. |
| `.docx` | `mammoth` (`extractRawText`) | pure JS; DOCX has no page concept, so `pageNumber` is null |

New chatbot deps: `pdf-parse`, `mammoth`. Both pure JS. Run `npm run audit:all` after adding.

### 2.10 Complete file list — Part 2

**New — chatbot (12)**
```
src/domain/ports/EvidenceSource.js
src/domain/ports/EmbeddingGateway.js
src/domain/ports/DocumentParser.js
src/domain/ports/DocumentRepository.js
src/infrastructure/embedding/OpenAiEmbeddingGateway.js
src/infrastructure/documents/DocumentRepositorySqlite.js
src/infrastructure/documents/migrations.js
src/infrastructure/documents/parsers/{TextParser,PdfParser,DocxParser,parserRegistry}.js
src/infrastructure/documents/chunker.js
src/infrastructure/documents/DocumentEvidenceSource.js
src/infrastructure/persistence/FtsEvidenceSource.js
src/application/retrieval/{CompositeEvidenceSource,rrf}.js
src/application/useCases/{IndexDocumentUseCase,ManageDocumentsUseCase}.js
```
**Modified — chatbot (9)**
```
src/composition/container.js        wire the new graph (composition root, as designed)
src/config/envConfig.js             + docStorePath, embedModel, embedBudgetHard, maxDocumentBytes, maxDocuments
src/transport/stdioSidecar.js       3 new handlers; askBusy/docBusy lanes; threadId echo
src/application/nodes/retrieveNode.js       ~4 lines
src/application/nodes/gradeDocumentsNode.js  candidate label uses h.ref
src/application/nodes/generateNode.js        citedRefs (+ legacy fallback)
src/application/graph/evidence.js            groupKey + source quota + new source fields
src/application/graph/constants.js           MAX_EVIDENCE_GROUPS, MIN_GROUPS_PER_SOURCE_TYPE, RRF_K, MIN_COSINE_SIMILARITY
src/infrastructure/llm/prompts.js            formatEvidenceBlock + GENERATE_SYSTEM
src/infrastructure/usage/UsageRecorder.js    + embedding model price
package.json                                 + pdf-parse, mammoth
```
**Untouched — chatbot:** `FtsRetriever.js`, `FtsIndexBuilder.js`, `SqliteMeetingStore.js`, `ftsQuery.js`, `buildChatGraph.js`, `routing.js`, `state.js`, `analyzeQueryNode.js`, `rewriteQueryNode.js`, `clarifyNode.js`, `respondNoDataNode.js`, `AnswerQuestionUseCase.js`, `OpenAiLlmGateway.js`, `LangchainLlmGateway.js`, `prompts` for analyze/grade/rewrite/clarify, `chat_index.db`.

**Untouched entirely:** the whole `gateway/` sidecar, all of `src-tauri/src/agents/`, audio capture, `meeting_history.db` schema, `llm_usage.db` schema (one price row added, no DDL).

---

## 3. Work order

Each phase ends green (`npm run lint`, `npm run test:all`, `cargo build`) and is one commit. Part 1 ships independently of Part 2 — you can review and merge it alone.

| Phase | Scope | Commit |
|---|---|---|
| **1** | Material Symbols font + `fade-in`/`shimmer` keyframes (C-10) | `fix(ui): load icon font, define missing keyframes` |
| **2** | Glass tokens, `--glass-*` vars, `AppShell`, modal sheets, contrast pass | `feat(ui): frosted-glass shell with tunable opacity budget` |
| **3** | Frontend chat de-duplication: `useChatThread` + `ChatThreadProvider`, delete `history-chat/`, fix the double input bar, fix `ChatSource.snippet` (C-8, C-9) | `refactor(chat): one parameterized chat thread; fix cross-thread bleed` |
| **4** | `threadId` through the protocol: sidecar echo → `chat_events.rs` → `IEventBus` → hook filter | `feat(chat): thread-correlated chat protocol` |
| **5** | Document domain: ports, chunker, parsers, `DocumentRepositorySqlite`, migrations. **Unit-tested, no wiring yet.** | `feat(docs): document parsing, chunking and vector store` |
| **6** | `OpenAiEmbeddingGateway` + embed budget + usage/pricing rows | `feat(docs): OpenAI embeddings gateway` |
| **7** | `EvidenceSource` port, `FtsEvidenceSource`, `DocumentEvidenceSource`, `rrf.js`, `CompositeEvidenceSource`; `retrieveNode` swap; wire in `container.js` | `feat(chat): hybrid meeting + document retrieval` |
| **8** | Citation generalization: `evidence.js`, `prompts.js`, `generateNode`, `gradeDocumentsNode`, `constants.js` (§2.4 — the risky one, isolated in its own commit so it can be reverted alone) | `feat(chat): ref-based citations across meetings and documents` |
| **9** | Sidecar handlers + `IndexDocumentUseCase`/`ManageDocumentsUseCase`; two busy lanes | `feat(docs): upload/list/delete over the chat sidecar protocol` |
| **10** | Rust: dialog plugin, capability, `commands/documents.rs`, event arms, `lib.rs` | `feat(docs): native file picker and document commands` |
| **11** | UI: `DocumentUploadButton`, `DocumentTray`, `DocumentPill`, `useDocumentLibrary`, document source chips in `RoxiAnswerCard`, new empty state | `feat(docs): document upload UI in the Ask tab` |
| **12** | End-to-end pass with a real PDF; README + `CLAUDE.md` updates | `docs: document RAG architecture` |

---

## 4. Tests

`chatbot/test/` already holds 6 `node --test` files — same style, no new framework.

| New file | Covers |
|---|---|
| `chunker.test.js` | boundaries, overlap, page-number carry, empty/1-char/no-paragraph input, a chunk longer than the limit with no sentence break |
| `rrf.test.js` | pure merge: single source = identity order; a hit ranked #1 in both sources outranks a #1-in-one; ties are deterministic |
| `evidence-groups.test.js` | `groupKey` grouping; source quota reserves a meeting group when documents dominate; `toSources` emits document fields |
| `document-repository.test.js` | round-trip write/read of a normalized vector (bit-exact Float32); cosine ranking on a hand-built 4-dim corpus; `ON DELETE CASCADE`; `content_hash` dedupe |
| `parser-registry.test.js` | extension → adapter; unknown extension throws a typed `ChatbotError` |
| `document-evidence-source.test.js` | `MIN_COSINE_SIMILARITY` floor; `EvidenceHit` shape (`ref`, `groupKey`, `sourceType`) with a **fake** `EmbeddingGateway` — no network |

Extend `graph.test.js` with a fake `EvidenceSource` returning one meeting hit + one document hit, asserting `generate` produces both `[M…]` and `[D…]` citations and the matching `sources` entries.

Every OpenAI-touching class is behind a port, so **no test makes a network call**.

---

## 5. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The citation change (§2.4) regresses meeting-only answers | Medium | Isolated in commit 8; legacy `citedMeetingIds` fallback retained; `graph.test.js` asserts the meeting-only path unchanged |
| Glass is unreadable on some desktop wallpaper | Medium | `--glass-alpha` / `--glass-dim` are two numbers in one file; AA verified against a white desktop (worst case) before merge |
| `pdf-parse` mangles a real-world PDF | Medium | `DocumentParser` port ⇒ swapping to `pdfjs-dist` is one new adapter file |
| A large document floods evidence and drowns meeting context | Medium | `MIN_GROUPS_PER_SOURCE_TYPE` quota + `MIN_COSINE_SIMILARITY` floor |
| Embedding spend surprise | Low | ~$0.002 per 100-page PDF; separate hard budget; every call logged to `llm_usage.db` and visible in `dashboard/` |
| `material-symbols` woff2 bloats the bundle | Low | Subset to the ~12 glyphs actually used (~8KB) |
| Two Node processes writing `llm_usage.db` | Low | Already the case today (gateway + chatbot); WAL + `busy_timeout` per the existing `UsageRecorder` design |

---

## 6. Open questions — these change the work, so please answer before phase 5

1. **Document scope.** Are uploaded documents (a) **global** — searchable in every conversation forever, or (b) **per-meeting** — attached to the meeting that was live when uploaded? The plan above assumes **(a) global**, which is simpler and matches "during a meeting OR any time" in your draft. (b) means a `meeting_id` column on `documents` and a scope filter in `DocumentEvidenceSource`, roughly +1 day.

2. **Document persistence across app restarts.** `doc_store.db` keeps documents forever until explicitly deleted. Assumed: **yes, persistent**. Confirm you do not want them cleared on app exit.

3. **Limits.** 20 MiB/file and 10 files, both env-overridable — confirm, or give different numbers. (10 files × 100 pages ≈ 2,000 vectors ≈ 12 MB on disk and ~5ms per query, so 10 is conservative; 50 would still be fine.)

4. **Token-level streaming.** Your draft says "answer streams in real-time", but the current pipeline is **not** token-streaming: `generateNode` requests `response_format: json_object` and awaits the whole object, so `ChatReply` arrives complete (`AnswerQuestionUseCase.js:38-51`). What streams today is **node progress** (`ChatThinking`). Real token streaming would mean dropping the JSON response format on `generate`, re-deriving citations from the streamed prose, and a new `ChatToken` protocol message — a meaningful redesign of the answer contract, ~2 days. **This plan keeps node-progress streaming** with a better `ThinkingIndicator`. Say the word if you want true token streaming and I will plan it as a separate phase.

5. **Windows/Linux (C-1).** Confirm macOS-only for now. Making the app actually build elsewhere is its own project (`Cargo.toml` target gating + per-platform loopback audio), not a UI change.
