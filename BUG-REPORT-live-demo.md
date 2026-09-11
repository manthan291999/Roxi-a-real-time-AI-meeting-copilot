# Live Demo Readiness — Bug Audit & Fixes

Audited before a live demo, across four areas: the STT provider fallback (AssemblyAI → Speechmatics), the Rust LLM agent pipeline, the app's general startup/runtime stability, and a full review of every uncommitted change on this branch. Everything below was checked against the actual running code, not assumed from comments or docs.

**Bottom line: the app builds clean and all test suites pass.** Six real bugs were found and fixed (three of them would have visibly broken things during a live demo). A handful more were found, are real, but are deliberately left alone for tonight because fixing them would mean activating brand-new, never-before-exercised behavior — documented below with suggested fixes for after the demo.

```
Chatbot tests:  302 / 302 passing
Gateway tests:   60 / 60  passing
Rust tests:      65 / 65  passing
Rust build:     clean (2 pre-existing, harmless dead-code warnings only)
Frontend typecheck (tsc --noEmit): clean
```

---

## 1. Bugs found AND fixed tonight

### 1.1 — STT: a bad/missing API key could silently break transcription with no error shown
**Severity: was blocking for a demo. Fixed.**

`gateway/sidecar.js` had four places that wrote an error message and then called `process.exit(1)` immediately afterward. `stdout` is a pipe here (Rust holds the other end), and pipes are asynchronous — calling `process.exit()` right after a write can truncate that very write before the Rust side ever reads it. `gateway/lifecycle/shutdown.js` already had a comment explaining exactly this danger and a fix for it (wait for the `drain` event, or a 1s timeout, before exiting) — it just wasn't applied to these four spots.

**Concrete failure this caused:** if both `ASSEMBLYAI_API_KEY` and `SPEECHMATICS_API_KEY` are missing/blank, the app would transition to "live" and then just... never transcribe anything. No error banner, nothing — because the error message meant to explain why was getting lost in the pipe on exit.

**Fix:** added a small `exitAfterDrain()` helper (mirrors the existing pattern in `shutdown.js`) and used it at all four exit sites in `gateway/sidecar.js`.

**Verified concretely** — ran the sidecar directly with both keys blanked out:
```
$ ASSEMBLYAI_API_KEY="" SPEECHMATICS_API_KEY="" node sidecar.js < /dev/null
exit code: 1
{"type":"Error","message":"Missing required env vars: ASSEMBLYAI_API_KEY or SPEECHMATICS_API_KEY"}
```
That error line now reliably reaches Rust's `event_router.rs`, which already correctly maps it to a `capture_error` event the UI can show.

### 1.2 — Qdrant was never actually starting (wrong config flag)
**Severity: was blocking for the whole memory/vector-search feature. Fixed.**

`src-tauri/src/adapters/vector_client.rs` was launching the `qdrant` binary with a `--storage-dir` command-line flag. **That flag does not exist** on this binary (confirmed via `qdrant --help`) — Qdrant only accepts a storage path through an environment variable (`QDRANT__STORAGE__STORAGE_PATH`). Passing an unknown flag makes the process exit immediately with a usage error; `Command::spawn()` doesn't consider that a spawn failure (the process *did* start, it just died fast), so the health-check loop just timed out and the app silently continued with no vector store at all — every single time it launched.

**Fix:** switched to the correct env var. Verified live: started Qdrant, ran the backfill script, confirmed 215 chunks + 36 glossary terms landed correctly in the two collections.

### 1.3 — Qdrant binary resolution pointed at the wrong file, and the fallback would have picked an incompatible one
**Severity: real, fixed.**

Same file: binary lookup used `current_dir.join("qdrant")`, but `cargo tauri dev` actually runs with `src-tauri/` as the working directory, so that path never resolved to anything. The fallback path's naming (`qdrant-{arch}`) didn't match the actual bundled filenames (`qdrant-aarch64-apple-darwin`) either.

**While fixing this, found something more important:** the bundled binary at `src-tauri/bin/qdrant-aarch64-apple-darwin` is a much older build (dated Jan 2024) than the one that actually created your existing data (a newer 1.19.1 build sitting at the repo root). Pointed at the same data, the old one **crashes on startup** trying to parse a collection config field the newer engine wrote (`invalid type: null, expected usize`). Confirmed this by actually triggering the crash, then confirmed your data was untouched (it never got that far).

**Fix:** binary resolution now checks the repo-root copy first (the one proven to work with your actual data), with the bundled one as a secondary fallback, and a comment explaining exactly why the order matters so nobody flips it back without knowing.

### 1.4 — `mod commands` was accidentally macOS-only
**Severity: latent, not affecting tonight's demo (you're on macOS), but a real bug. Fixed.**

`src-tauri/src/lib.rs` had `#[cfg(target_os = "macos")]` sitting directly above `mod commands;`. That attribute was written for a *different*, since-deleted module (`macos_overlay`) and got left dangling onto the next line by accident. `commands/` contains ordinary cross-platform command handlers (it already does its own internal `#[cfg(target_os = "macos")]` branching where it actually needs to) — gating the whole module to macOS would fail a Windows/Linux build outright. Doesn't affect tonight since this machine is macOS, but it's a genuine bug, and the fix is a zero-risk one-line deletion. Fixed.

### 1.5 — A background sync error could silently hijack a live "Ask Roxi" answer
**Severity: real, demo-relevant. Fixed.**

Every time a meeting chunk gets saved, Rust sends a `SyncVectors` nudge to the chatbot sidecar to keep its search index fresh. That message carries no `threadId`. Separately, the frontend's `useChatThread.ts` routes any *untagged* reply to "whichever chat thread is currently waiting for an answer" — a reasonable assumption back when only real chat questions produced untagged responses.

**Concrete failure this caused:** if a user asks "Ask Roxi" a question *during a live meeting* (very plausible in a demo) at the same moment a background sync happens to be busy, the sidecar's `{"error": "Memory sync already running"}` reply — meant purely as internal bookkeeping — would land in the user's chat thread and silently replace their real, in-progress answer with that internal error message.

**Fix:** tagged the automatic background push with a sentinel `threadId` (`"__background_sync__"`) that no real chat thread can ever match, and made the sidecar echo back whatever `threadId` it was given. Added 3 regression tests covering the tagged-success, tagged-busy, and untagged-manual-use cases.

### 1.6 — (Found via the same investigation) The near-real-time sync push has been completely dead code, this whole time — fixed the bug, left the feature off
**Severity: real correctness bug; feature intentionally kept OFF for tonight per your call.**

While fixing 1.5, found the actual reason that background push has never done anything: `event_router.rs` was looking up Rust-side application state with the type `Arc<dyn ChatGatewayClient + Send + Sync>`, but `lib.rs` had registered it as `Arc<dyn ChatGatewayClient>` (no explicit `+ Send + Sync`). Those look interchangeable — the trait already requires `Send + Sync` — but **they are not the same type** to Rust's `TypeId` system. Verified this empirically with a standalone test:
```
TypeId Arc<dyn Foo>             = TypeId(0x1298e8...)
TypeId Arc<dyn Foo + Send+Sync> = TypeId(0xe93094...)
equal = false
```
So the lookup always failed, silently, and the "instant refresh" push has never fired even once — the app has been relying entirely on its 60-second polling fallback this whole time, with no visible symptom (the polling path is real and well-tested).

Per your direction: fixed the type mismatch for correctness (so the code isn't misleadingly wrong), but wrapped the actual send behind an explicit `const PUSH_SYNC_ENABLED: bool = false` with a comment explaining why — so nothing new activates for tonight. Flip that one constant to `true` (after the demo, with time to verify it live) to turn the feature on for real.

### 1.7 — Glossary-term citations in "Ask Roxi" answers would render as "Meeting #0"
**Severity: real, demo-visible if you show off the glossary/Ask-Roxi feature. Fixed.**

`chatbot/src/application/graph/evidence.js`'s `sourceTypeOf()` recognized `'meeting'`, `'document'`, and `'live'` hits, but not the newer `'semantic'` (glossary) hit type — so every glossary-term citation fell through to the `'meeting'` default, which tried to build a citation from a `meetingId` that glossary hits don't have (it's always `null`, since a glossary term is cross-meeting knowledge by design). That produced the literal citation ref string `"Mnull"`, and — worse — a source card with `meetingId: Number(null) === 0`, which the frontend renders as **"Meeting #0"**. The code's own comment already called out this exact failure mode; it just wasn't wired up for the new source type.

**Fix:** added `'semantic'` as a real source type end to end — `evidence.js` (ref prefix `G1`/`G2`/...), the frontend's `ChatSource` type, and `SourceChip.tsx` (renders as "Glossary" with a 📖 icon, no fake date/meeting number). Added 4 regression tests. Confirmed with `npm run lint` (tsc) clean and the full chatbot suite green.

---

## 2. STT provider fallback (AssemblyAI ↔ Speechmatics) — what you asked about specifically

Traced the whole path: `provider-manager.js`, both provider adapters, the retry/backoff policy, and the Rust side that reacts to it. Ran the gateway's own test suite (60/60 pass).

**The good news — this mostly already works correctly:**
- A bad/expired AssemblyAI key is correctly detected as an **auth failure** (401/403/"invalid api key" patterns) and fails over to Speechmatics in **under 1 second** — it does not waste time retrying a key that's simply wrong.
- Retries are bounded, not infinite: worst case ~2.5s on the primary provider, ~7.5s on the last-resort provider before giving up.
- No "flapping" — once it switches to Speechmatics, a further failure doesn't bounce back to AssemblyAI and then back again; it stays put.
- Audio is buffered safely during a switchover — nothing gets sent to a dead connection, no duplicate-session errors possible.

**What was actually broken here:** finding 1.1 above — if *both* keys are simply absent (not "one is bad," but "neither exists"), the app used to fail completely silently. That's now fixed.

**Two minor things worth knowing, not bugs, just behavior to be aware of for tonight:**
- If you set `STT_PROVIDER` to force one specific provider, that **disables fallback entirely** — if the forced provider's key is bad, there is no fallback to the other one even if its key is fine. Make sure `STT_PROVIDER` is unset for the demo unless you specifically want to pin one provider.
- A rate-limited key (HTTP 429) isn't currently classified as an "auth failure" the same way an invalid key is — it goes through the normal (still-bounded) retry path rather than failing over instantly. Not likely to matter for a single demo session, just noting it.

**Test coverage gap (not a bug, but worth knowing):** the actual fallback/circuit-breaker logic in `provider-manager.js` has zero dedicated automated tests today — the existing gateway tests check that both providers *emit* correctly, not that switching between them works. Worth adding after the demo.

---

## 3. LLM / Rust agent pipeline — health check

Read every file in `src-tauri/src/agents/`, not just the ones that show up in the current diff. Ran `cargo build` (full, not just `cargo check`) and `cargo test` (65/65 pass).

**Checks out clean:**
- `openai_adapter.rs`'s JSON extraction (the "fragile by design" one the project docs already flag) never panics — a malformed LLM response returns a typed error, which the pipeline handles gracefully everywhere it was checked.
- `usage_store.rs` (the LLM cost-logging code) uses parameterized SQL throughout (no injection risk) and every failure path is caught — a logging hiccup can never take down an actual LLM call.
- `chunk_graph.rs`: one stage-2 agent (Explanation/Technical/Analyst/Risk) failing or timing out never takes down the others or blocks the final response — verified this is true by design, not by luck.
- `routing.rs`'s Low/Medium/High routing logic: all 4 tests pass, covering every branch.
- No `.unwrap()`/`.expect()`/unchecked array indexing anywhere in the agent code that operates on LLM output — untrusted model output can't panic the app.

**One real gap, not demo-blocking but worth knowing:** the `LLM_BUDGET_SOFT`/`LLM_BUDGET_HARD` hard-cap-on-spend that the project's own docs describe for the live meeting pipeline **doesn't actually exist in the Rust code that runs during a live meeting** — those env vars are only read by the separate Node chatbot, which has its own real budget guard. If a demo meeting runs long, LLM calls simply keep happening with no cap — a cost/availability concern, not a crash risk (nothing will break; it just won't stop itself if you forget to end the session).

---

## 4. Bugs found, but deliberately NOT touched tonight

These are real, but each one either requires a design decision, only matters after the demo is long over, or isn't visibly triggered by anything a demo would actually do. Fixing them now would mean testing brand-new behavior with no time to verify it — listed here so you can decide when to act on them.

| # | What | Why it's real | Why it's not urgent for tonight |
|---|---|---|---|
| 1 | `.husky/pre-commit` was deleted from this branch — the hook that blocked `.env` files and API-key-looking strings from being committed, and ran a typecheck | Confirmed: no CI job replaces it before a PR merges to main, so a secret committed to a feature branch sits exposed until someone notices | Doesn't affect the app running; restoring it could add commit-time friction right when you might need to commit quickly. Recommend restoring (`git checkout -- .husky/pre-commit`) once the demo is done. |
| 2 | The window's "click X to hide to tray, don't quit" behavior was removed, and the title bar now has a real native close button | This looks like a deliberate choice (it has its own comment: "Removed custom on_window_event to allow standard close button behavior"), not an accident | Not a bug — just a heads-up: clicking the close button now quits the whole app (ending any live capture), it no longer hides to the tray icon. Worth knowing before you demo, in case you close the window out of habit. |
| 3 | The 90-day episodic-memory purge job compares timestamps that may not be in the exact format Qdrant expects for date filtering | Real: SQLite stores `created_at` as `'YYYY-MM-DD HH:MM:SS'`; Qdrant's datetime filter wants RFC3339 (`...T...Z`). Worst case, the purge job silently deletes nothing. | Only matters 90 days from now. Zero effect on tonight. Flagging so it gets fixed before it's needed. |
| 4 | "Ask Roxi" answers aren't scoped by project for the two new memory search sources (episodic/glossary) — a question in Project A could surface chunks/terms from Project B | Real: the code path that would pass `projectId` through was never wired up | Only visible if you're running multiple distinct projects and demo project-isolation specifically. If tonight's demo is one project, this is invisible. |
| 5 | Several code-quality items (duplicated logic between the Rust and Node sides of the vector-memory feature, a few spots doing sequential work that could run in parallel, one place hashing with MD5 instead of the codebase's usual SHA-256 convention) | All real, all flagged by an independent code-review pass | None of these affect correctness or crash risk — pure maintainability/performance polish, safe to defer entirely. |

---

## 5. What to double-check yourself before going live

- Confirm `STT_PROVIDER` is **unset** in your `.env` (see §2) unless you deliberately want to pin one provider.
- If you want the freshly-fixed Qdrant vector memory to have your existing meeting history in it, run once: `node chatbot/bin/sync-vectors.js --force --episodic --semantic` (a few cents, takes under a minute) — already done once during this audit, so it should already be populated, but re-run if you've captured more meetings since.
- Everything above was verified against real test runs and, where possible, actually triggering the failure and confirming the fix — not just read from the code and assumed correct.
