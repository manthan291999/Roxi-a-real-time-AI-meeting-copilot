# SOLID + Decoupling Audit — Roxi `gateway/`

**Date:** 2026-09-06
**Scope:** `gateway/` (the Node STT sidecar) — every file, 21 files / 2,729 LOC
**Branch:** `main` @ `66c6b1f`
**Status:** PHASE 2 COMPLETE — findings audited, then remediated. Every claim below was
verified by reading the file and grepping the symbol across the tree; every fix is covered
by a test that fails without it.

**Method:** read all 21 files; grep every exported symbol across the repo to separate live
code from dead; cross-check the stdout wire contract against
`src-tauri/src/sidecar/event_router.rs`; confirm the Rust side writes nothing via
`grep "INSERT INTO" src-tauri/src/`.

---

## A. EXECUTIVE SUMMARY

The folder was not badly designed so much as **half-demolished**. The LLM/agent pipeline
moved from Node to Rust in `66c6b1f`, which removed the *callers* but left the *callees*.
About **40% of the code was unreachable**, and — the crux — the files deleted in that
migration (`infrastructure/retry.js`, `infrastructure/stdout-protocol.js`, `config/`) were
precisely the abstractions that had been enforcing the layering. What remained showed good
intent in a few places and no enforcement anywhere.

That absence of enforcement was not cosmetic. It had already caused **five live defects**,
each of which a SOLID principle exists to prevent:

| Principle violated | Real consequence in the shipped app |
|---|---|
| DIP (interfaces were JSDoc, unenforced) | Providers diverged on `confidence`; the low-confidence filter was silently dead on the fallback provider |
| Decoupling (untyped wire protocol) | Gateway emitted `Connected`, Rust had no arm for it — discarded silently |
| SRP (god module owning its own lifecycle flag) | `endMeeting` set `closed = true` before flushing, so every meeting lost its final transcript batch |
| OCP (no seam for retry policy) | Retry/backoff read a field nothing set — one connect attempt per provider, ever |
| SRP/ISP (caller passed a god object) | Diarization could not be given audio it could attribute, so voice matching never ran |

Score movement, and what earned it:

| Principle | Before | After | What changed |
|---|---:|---:|---|
| SRP | D | A− | `sidecar.js` 142 → 118 lines and now wiring only; `db/index.js` 478 → 4 focused modules; `shutdown.js` stripped of markdown |
| OCP | D | A− | Provider registry + config module; a third provider is one registry entry |
| LSP | C− | A | Both providers emit `confidence`; a conformance test runs against both |
| ISP | C | A | `DiarizationLayer` gets a 4-method repository, not a 17-method module |
| DIP | D+ | A− | Repositories injected; singletons gone; `interfaces/` enforced by tests |
| Decoupling | D | A− | One typed protocol module + a drift test against `event_router.rs` |
| **Test coverage** | **F** | **B+** | **0 → 52 gateway tests** (`TEST-001` retired), plus 6 new Rust tests |

---

## B. FINDINGS — S1: BROKEN BEHAVIOUR

These were defects, not style issues.

### S1-1 — Final transcript batch lost on every meeting *(new; found during remediation)*

`db/index.js:391-396` set `closed = true` and then called `flushBatches()`, whose first
line was `if (!db || !currentMeetingId || closed) return`. The guard was already true, so
**the final flush was a no-op on every single meeting** — up to one flush interval (5s) of
speech silently discarded at shutdown.

*Fixed:* `MeetingSession.close()` flushes transcripts *before* marking the meeting ended,
and `TranscriptRepository.flush()` is not gated on the closed flag.
*Test:* `test/db.test.js` → "closing flushes pending transcripts (regression)".

### S1-2 — MFCC speaker diarization was entirely dead

`DiarizationLayer.pushAudio()` had zero callers, so `audioRing` was always empty, so
`buildEmbedding()` — called on every final turn at `sidecar.js:101` — returned `null` on
its first line every time. `saveSpeakerEmbedding()` never ran, `speaker_embeddings` was
never written, `findClosestKnownSpeaker()` was never called, and all 174 lines of
`providers/mfcc.js` were unreachable.

**Root cause:** the signature was `pushAudio(sttLabel, chunk)`, but the deframer sees raw
PCM *before* STT labels it. The caller could not supply the argument, so no caller existed.

*Fixed:* audio now buffers unattributed and is assigned on turn finalization —
`attributeTurn(sttLabel)` claims everything captured since the previous final. Turn-accurate
and needs no provider timestamps (which the two providers report on different clocks).
Voice matching is wired into `resolveOrCreateSlot`, with unnamed stored voices excluded as
match candidates.
*Tests:* `test/diarization.test.js`, 10 cases.

### S1-3 — Speaker rename had no path at all

`DiarizationLayer.rename()` had no callers; `sidecar.js` had no stdin command handling
(stdin was 100% PCM). `speaker_names` was never written. On the frontend,
`SpeakerRepository.ts` was an in-memory `Map` with no `invoke`, and `SpeakerRenameModal.tsx`
had been deleted.

*Fixed:* a full vertical slice — modal → `ISpeakerRepository.rename` → `rename_speaker`
Tauri command → `CTL1` control frame → `DiarizationLayer.rename()` → `speaker_names`.
Routed through the pipe rather than written to SQLite directly by Rust, because the gateway
holds live in-session speaker state that a direct write would leave stale.

### S1-4 — Retry and backoff were dead by configuration

`ProviderManager.connectWithRetry()` read `descriptor.retryPolicy`, but the chain built at
`sidecar.js:61-64` never set it. The `{maxRetries: 0}` default meant **one connect attempt
per provider, with no backoff** — the documented resilience was inert.

*Fixed:* `infrastructure/retry.js` restored; `stt/provider-registry.js` attaches a policy by
chain position (primary 2 retries / ~2.5s worst case, last-resort 3 / ~7.5s).

### S1-5 — Nine tables were never written by anyone

`saveChunk`, `saveRisks`, `saveDecision`, `saveActionItem`, `saveTechnicalAnalysis`,
`saveSuggestedReply`, `upsertSpeakerProfile`, `upsertGlossary`, `incrementApiCalls` all had
zero callers, and Rust did not fill the gap. The Rust `ChunkGraph` emitted decisions, risks
and action items to the UI and **nothing persisted them**. Knock-on: `buildFallbackSummary()`
read those same empty tables, so every end-of-meeting summary was a stub reading
"Chunks analyzed: 0"; and the chatbot's FTS5 index was built over permanently empty tables,
so "Ask Roxi" could not answer anything about past decisions.

*Fixed:* the host now sends artifacts back over the control channel and the gateway persists
them through those (previously dead) writers. Because the ChunkGraph has two lanes — the
reply path finishes first, the detached risk/analyst lane later or not at all under load —
each chunk carries a host-minted `chunkRef` so the second wave attaches to the row the first
created. The create is sent *before* the detached lane is spawned, so the row always exists
before its artifacts can arrive.

### S1-6 — LSP violation with a functional consequence

`AssemblyAIProvider` emitted `final` with `confidence`; `SpeechmaticsProvider` did not.
`sidecar.js:91` read `sanitize(text, confidence || 1.0)` — so **on failover to Speechmatics,
every turn bypassed the low-confidence filter**. Two implementations behind one contract,
not substitutable, and invisible at the call site.

Compounding it: AssemblyAI's own calculation was `words?.reduce(...) / (words?.length || 1)`,
which yields `NaN` when `words` is absent. `NaN < 0.4` is false, so a missing value passed
the filter by accident rather than by intent.

*Fixed:* Speechmatics averages the per-word `confidence` it already receives; both providers
return 1 explicitly when a turn carries no word-level confidence; the sanitizer now rejects a
non-finite confidence instead of treating it as certainty.
*Test:* `test/stt-provider-contract.test.js` → "both providers report low confidence rather
than omitting it".

---

## C. FINDINGS — S2: DECOUPLING / DIP

### S2-1 — The Rust↔Node wire protocol had no definition on either side

Eight scattered inline `console.log(JSON.stringify({type: …}))` calls (`sidecar.js` ×7,
`shutdown.js` ×1) against a stringly-typed `event_type: String` match in Rust with a silent
`_ => {}` fallback. **Proof it had already failed:** the gateway emitted `{type:"Connected"}`
and Rust had no `"Connected"` arm — silently discarded. In the other direction, ~10 Rust arms
(`Explanation`, `Decisions`, `Risks`, `Billing`, `ApiHealth`, …) were for messages the gateway
no longer sends. A typo in a type string produced no error anywhere.

*Fixed:* `infrastructure/stdout-protocol.js` owns every message; `emit()` refuses an
unregistered type rather than shipping something the router will drop; the orphaned
`Connected` message is gone.
*Test:* `test/protocol.test.js` parses the match arms out of `event_router.rs` and fails if
the gateway can emit a type Rust does not handle — exactly the drift that had already occurred.

### S2-2 — `db/index.js` was a 478-line singleton god-module

Module-level mutable state (`db`, `currentMeetingId`, `closed`, `transcriptBatch`, `stmts`)
mixing connection management, DDL, migrations, four unrelated repositories, batch policy and
lifecycle, with a hardcoded path at line 79 and consumers binding to it statically via
`require`. It could not be mocked, could not open two meetings in one process, and could not
be tested without a real file on disk.

*Fixed:* split into `connection.js` (open + pragmas + migrations), `meeting-repository.js`,
`transcript-repository.js` (the only batching path), `speaker-repository.js`, and an
`index.js` composition root returning a `MeetingSession`. The path comes from config.
*Test:* `test/db.test.js` → "two sessions can be open at once" — impossible before, and the
proof the coupling is gone.

### S2-3 — ISP violated at the one place DI was attempted

`DiarizationLayer`'s constructor already named its parameter `speakerRepository` and accepted
an injected `mfccExtractor` — the seam existed — but `sidecar.js:126` handed it the entire
17-method `db` module. Same shape in `shutdown(reason, status, manager)`, which needed only
`manager.close()`.

*Fixed:* the layer receives the 4-method `SpeakerRepository`; `createShutdown` takes
`{session, providerCloser}`; the deframer's `audioSink` fan-out is an inline object exposing
only `sendAudio`.

### S2-4 — `interfaces/` were decorative

Both files were JSDoc over `module.exports = {}`. Nothing referenced `ISttProvider` at all —
not even an `@implements` tag. This is *how* S1-6 slipped through: an interface nothing checks
cannot prevent implementations from diverging.

*Fixed:* `ISttProvider` now exports `checkSttProvider()` and `checkFinalEvent()`, exercised
against both providers, with the `confidence` term checked explicitly.

### S2-5 — Hidden and singleton dependencies

`diarization-layer.js:34` did `require('../providers/mfcc.js')` *inside the constructor* as a
default argument, hiding a concrete dependency from static analysis.
`transcript-sanitizer.js:61` exported `new TranscriptSanitizer()` — a pre-built instance with
an unconfigurable blocklist.

*Fixed:* the extractor is injected and required (the constructor throws without it); the
sanitizer exports its class and takes `{blocklist, minConfidence}`.

---

## D. FINDINGS — S3: SRP / OCP / LAYERING / HYGIENE

| # | Finding | Resolution |
|---|---|---|
| S3-1 | `sidecar.js` carried six responsibilities: dotenv path resolution, argv parsing, a hardcoded `ROLE_PROFILES` table, env validation, DI, event wiring, and per-turn business logic | Composition only; per-turn logic extracted to `stt/transcript-pipeline.js` |
| S3-2 | Adding an STT provider meant editing `sidecar.js` in three places | `stt/provider-registry.js` — one entry per provider |
| S3-3 | `stt/diarization-layer.js` (domain) depended on `providers/mfcc.js` (a DSP utility misfiled under a folder that otherwise means "STT adapter") | Moved to `infrastructure/mfcc.js` |
| S3-4 | `lifecycle/shutdown.js` mixed teardown, markdown formatting, and persistence | Formatting extracted to `lifecycle/summary-formatter.js`, a pure function |
| S3-5 | The whole `state/` folder was write-only: `setUserProfile` was called once and `meetingState` was never read | Deleted (`meeting-state.js`, `prompt-builder.js`, `speaker-tracker.js`, `text-similarity.js`) |
| S3-6 | 4 of 7 `validate.js` exports and 2 of 4 `logger.js` exports were dead | Removed; `validate.js` gained the control-channel validators |
| S3-7 | PCM frame parsing implemented **three times**; `tools/transcriber.js` also used AssemblyAI's deprecated `realtime.transcriber` API | `transcriber.js` deleted; `pcm-consumer.js` rewritten to consume the production deframer |
| S3-8 | `package.json` `"main"` pointed at a nonexistent path; `openai` dependency had zero imports | Both fixed |
| S3-9 | `logger.js` read `process.env` at import time | `configure(level)`, called once from the composition root |
| S3-10 | Gateway exited if `OPENAI_API_KEY` was missing, though it makes no LLM calls | Requirement dropped — it belongs to the Rust host |
| S3-11 | `provider-manager.js:202` had an unused `failed` binding (blocked the zero-warning lint gate) | Removed |

**Confirmed good, left alone:** `PcmDeframer(audioSink)` was already textbook DI;
`ProviderManager`'s factory-descriptor chain was the right shape (only the policy wiring was
missing); `db/migrate.js` is clean and forward-only; **no circular dependencies anywhere**,
before or after.

---

## E. WHAT WAS BUILT

New seams:

```
gateway/
  config/index.js                    the only reader of env/argv/paths
  infrastructure/stdout-protocol.js  the only writer of the wire format
  infrastructure/retry.js            connect policies (revives dormant backoff)
  infrastructure/mfcc.js             moved out of providers/
  stt/provider-registry.js           data-driven fallback chain
  stt/transcript-pipeline.js         per-turn logic, extracted from the root
  control/command-handler.js         inbound CTL1 commands
  lifecycle/summary-formatter.js     pure presentation
  db/{connection,meeting-repository,transcript-repository,speaker-repository}.js
```

The pipe became bidirectional. `CTL1` frames (same 8-byte header as `PCM1`, JSON payload)
share the audio pipe, so no second transport was needed:

```
Rust  ports/control.rs · adapters/control_channel.rs · sidecar/persistence.rs
      commands/speaker.rs
      streaming.rs + capture_usecase.rs now share the writer via Arc<Mutex<…>>
```

**Design note — why the host does not write the database.** The gateway is the sole writer of
`meeting_history.db`; Rust and the chatbot both read it, the latter read-only, to avoid WAL
write contention. Sending artifacts back down the pipe preserves that invariant, reuses the
writers that already sanitize and already track the schema, and needs no meeting-id plumbing
(the gateway owns the id; Rust never learns it).

---

## F. VERIFICATION

All four runtimes, after the change:

| Check | Result |
|---|---|
| `cd gateway && npm test` | **52 passed**, 0 failed (was: a stub that echoed and exited 0) |
| `cd gateway && npx eslint . --max-warnings=0` | clean |
| `cd src-tauri && cargo build` | success (only pre-existing dead-code warnings) |
| `cd src-tauri && cargo test` | **10 passed** (was 4) |
| `npm run build` (tsc + vite) | success |
| `npm test` (chatbot regression) | **36 passed**, unchanged |

**End-to-end smoke test** — the real sidecar process, spawned against a temp database, fed
`CTL1` frames on stdin:

```
control  chunk_persisted      seq=0 chunkId=1 decisions=1 actionItems=1 risks=0
control  artifacts_persisted  chunkRef=c0 risks=1
diarization speaker_renamed   sttLabel="Speaker A" displayName="Alice Cooper"
sidecar  shutdown_complete    exit 0
```

Resulting rows — every one of these tables was permanently empty before:

```
chunks           id=1 seq=0 speaker=Alice significance=high topic="release planning"
decisions        "ship on friday" confidence=0.92 chunk_id=1
action_items     Bob "cut the release branch" due thursday chunk_id=1
risks            "QA has no time" TIMELINE/high chunk_id=1     <- the second wave, same row
speaker_names    "Speaker A" -> "Alice Cooper"                 <- survives restart
speaker_profiles Alice chunk_count=1 topics=["release planning"]
```

And the closing summary, which previously always read "Chunks analyzed: 0":

```
# Meeting Summary
**Topic:** release planning
**Chunks analyzed:** 1
## Participants
- Alice (1 contributions)
```

**Cross-language contract:** `control_channel.rs::tests::frame_layout_is_stable` and
`control-integration.test.js` → "the exact byte layout the Rust side writes is accepted" pin
the same 60-byte fixture from both sides. Writing them surfaced a real detail: `serde_json`
serializes object keys alphabetically (its `Map` is a `BTreeMap` without `preserve_order`),
so the fixtures encode that order.

---

## G. NOT DONE / STILL OPEN

Honest remainder — none of these were in scope, and none are regressions:

1. **The chatbot's FTS5 index still needs a rebuild** to benefit from newly persisted
   artifacts: `node chatbot/bin/rebuild-index.js`. Until then Ask Roxi still sees the old
   empty index. Nothing rebuilds it automatically, which is arguably its own finding.
2. **Voice matching is proven by unit test, not by two real meetings.** The attribution and
   matching logic is covered with a deterministic fake extractor; the real MFCC path
   (`infrastructure/mfcc.js`, a naive O(N²) DFT) is unchanged and unbenchmarked. Its
   similarity threshold (0.85) has not been tuned against real voices.
3. **`ITranscriptSanitizer` is still a JSDoc stub.** Only `ISttProvider` was made enforceable;
   the sanitizer has one implementation, so there is nothing yet to diverge from.
4. **`commands/overlay.rs` is not in the `invoke_handler!` list** in `lib.rs`, though
   `CLAUDE.md` documents `hide_toolbar` / `toggle_toolbar` / `toggle_caption` as registered
   commands. Noticed in passing, outside this audit's scope, and not touched — but it means
   those calls would fail at runtime.
5. **`transcript-sanitizer.js` blocklist is now injectable but nothing injects a custom one**;
   the default is still hardcoded at the construction site in `sidecar.js`.
