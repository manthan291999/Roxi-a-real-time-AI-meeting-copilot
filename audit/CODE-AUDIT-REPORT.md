# Code Audit Report — AI Meeting Interpreter

**Date:** 2026-08-26  
**Scope:** Full codebase review (frontend `src/`, gateway `gateway/`, Rust backend `src-tauri/`, configuration & security posture)  
**Method:** Manual static analysis of all source files, configuration files, and dependency manifests

---

## Executive Summary

The AI Meeting Interpreter is a Tauri desktop application that captures system/microphone audio, streams it to cloud STT providers (AssemblyAI / Speechmatics), runs a multi-agent LLM pipeline (Groq) for real-time meeting analysis, and persists results to SQLite. The architecture is well-structured with clean separation of concerns (hexagonal/ports-and-adapters in Rust, layered pipeline in Node.js).

**Critical findings:** 1 (exposed API keys)  
**High findings:** 4  
**Medium findings:** 8  
**Low / Informational findings:** 9

---

## Findings

### CRITICAL

#### C-1: Live API Keys Stored in Plaintext on Disk

| Field | Value |
|-------|-------|
| **File** | `gateway/.env` |
| **Severity** | Critical |
| **Category** | Secrets Management |

**Description:**  
The file `gateway/.env` contains live API keys for three services in plaintext:

- `ASSEMBLYAI_API_KEY` — real-time STT
- `SPEECHMATICS_API_KEY` — fallback STT
- `GROQ_API_KEY_1`, `GROQ_API_KEY_2`, `GROQ_API_KEY_3` — LLM inference

While `.gitignore` correctly excludes `.env` files from version control, the keys exist unencrypted on the local filesystem. If the machine is compromised, the repository is accidentally shared, or the `.env` is copied into a build artifact, all keys are exposed.

**Risk:**  
An attacker with these keys can consume paid API quotas, access meeting audio transcripts (via AssemblyAI/Speechmatics dashboards), or run arbitrary LLM inference billed to the owner.

**Recommendation:**
1. **Rotate all keys immediately** — treat them as compromised since they have been stored in plaintext.
2. Use OS-level secret storage (macOS Keychain, Windows Credential Manager) via Tauri's `tauri-plugin-stronghold` or similar.
3. At minimum, load keys from environment variables set by the shell profile rather than a `.env` file.
4. Add a pre-commit hook (e.g., `gitleaks`, `trufflehog`) to prevent accidental key commits.

---

### HIGH

#### H-1: Content Security Policy Disabled

| Field | Value |
|-------|-------|
| **File** | `src-tauri/tauri.conf.json` (line 22) |
| **Severity** | High |
| **Category** | Frontend Security |

**Description:**  
```json
"security": {
  "csp": null
}
```
Setting `csp` to `null` disables all Content Security Policy enforcement in the webview. This means any injected script (via XSS in rendered transcript text, for example) can execute freely, access `window.__TAURI__` (enabled via `withGlobalTauri: true`), and invoke Tauri commands.

**Risk:**  
If any user-controlled content (transcript text, LLM output, meeting context) is rendered without proper escaping, an attacker could craft meeting speech that injects JavaScript into the webview, potentially invoking Tauri IPC commands to read the database or control the sidecar.

**Recommendation:**
1. Define a restrictive CSP: `"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"`.
2. Set `withGlobalTauri` to `false` and use explicit `@tauri-apps/api` imports.
3. Ensure all dynamic content is rendered via React's JSX escaping (never `dangerouslySetInnerHTML`).

---

#### H-2: `withGlobalTauri: true` Exposes Full IPC Surface

| Field | Value |
|-------|-------|
| **File** | `src-tauri/tauri.conf.json` (line 13) |
| **Severity** | High |
| **Category** | Frontend Security |

**Description:**  
`"withGlobalTauri": true` injects the entire Tauri API onto `window.__TAURI__`. Combined with the disabled CSP (H-1), any script execution in the webview can call `window.__TAURI__.invoke(...)` to trigger registered commands (`start_capture`, `stop_capture`, `get_meetings`, `get_meeting_details`).

**Recommendation:**  
Set `"withGlobalTauri": false`. Import Tauri APIs explicitly in TypeScript modules.

---

#### H-3: Sidecar Path Derived from `current_dir()` — Predictable & Manipulable

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/adapters/gateway_client.rs` (lines 31–32) |
| **Severity** | High |
| **Category** | Process Security |

**Description:**  
```rust
let current_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
let sidecar_path = current_dir.join("../gateway/sidecar.js");
```
The Node.js sidecar path is constructed relative to the process's current working directory. If an attacker can influence the CWD (e.g., via a symlink, a shortcut with a different "Start in" directory, or a PATH manipulation), they could cause the app to execute an arbitrary `sidecar.js`.

Additionally, the sidecar is spawned with `node` resolved from `PATH` — a PATH hijack could substitute a malicious Node binary.

**Recommendation:**
1. Resolve the sidecar path relative to the application executable (`std::env::current_exe()`) or bundle it as a Tauri resource.
2. Use an absolute path to the Node.js binary or bundle a Node runtime.
3. Validate the sidecar script's integrity (e.g., checksum) before execution.

---

#### H-4: No Authentication or Integrity Check on Stdin Audio Protocol

| Field | Value |
|-------|-------|
| **File** | `gateway/sidecar.js` (line 132), `gateway/audio/pcm-deframer.js` |
| **Severity** | High |
| **Category** | IPC Security |

**Description:**  
The sidecar reads raw PCM audio frames from stdin using a simple magic-byte protocol (`PCM1` + uint32 length + payload). There is no authentication, HMAC, or sequence verification. Any process that can attach to the sidecar's stdin (e.g., if the pipe is exposed or the process is spawned by a malicious parent) can inject arbitrary audio data, which will be transcribed and analyzed as if it were real meeting audio.

**Risk:**  
An attacker could inject fabricated speech to manipulate meeting records, inject prompts for the LLM pipeline, or trigger false risk alerts.

**Recommendation:**
1. Since the sidecar is spawned by the Rust backend with piped stdin, the attack surface is limited to processes that can intercept or inject into the pipe. On a single-user desktop this is acceptable, but document the trust boundary.
2. For defense-in-depth, consider adding a session token passed via `--token` CLI arg and verified in the protocol header.
3. Ensure the sidecar process is not exposed to other users (file permissions on the process).

---

### MEDIUM

#### M-1: Mutex `unwrap()` Calls Will Panic on Poisoned Lock

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/adapters/gateway_client.rs` (lines 26, 78, 101) |
| **Severity** | Medium |
| **Category** | Rust Robustness |

**Description:**  
```rust
let mut sidecar_lock = self.sidecar.lock().unwrap();
```
If any thread panics while holding the mutex, the lock becomes poisoned and subsequent `.unwrap()` calls will panic, crashing the entire Tauri application.

**Recommendation:**  
Use `.lock().unwrap_or_else(|e| e.into_inner())` to recover from poisoned mutexes, or handle the error gracefully.

---

#### M-2: Unbounded `mpsc` Channels for Audio Data

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/adapters/mac_audio.rs` (lines 173–174) |
| **Severity** | Medium |
| **Category** | Resource Management |

**Description:**  
```rust
let (loopback_tx, loopback_rx) = mpsc::channel::<Vec<i16>>();
let (mic_tx, mic_rx) = mpsc::channel::<Vec<i16>>();
```
Standard `mpsc::channel()` is unbounded. If the mixer thread falls behind (e.g., due to a slow sink write or lock contention), audio chunks will accumulate in memory without bound, potentially causing OOM on long meetings.

**Recommendation:**  
Use `std::sync::mpsc::sync_channel(bound)` with a reasonable bound (e.g., 100 chunks ≈ 2.5 seconds of audio) and drop oldest frames on overflow.

---

#### M-3: `Resampler::flush()` Never Called — Audio Tail Lost

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/adapters/mac_audio.rs`, `src-tauri/src/resample.rs` |
| **Severity** | Medium |
| **Category** | Data Integrity |

**Description:**  
The `Resampler` struct has a `flush()` method to process remaining buffered samples, but it is never called in `capture_to_sink_internal()` or `process_and_send()`. Up to 1023 samples (~64ms at 16kHz) of audio are silently dropped at the end of each capture session.

**Recommendation:**  
Call `resampler.flush()` after the capture loop exits and feed the result through the mixer before finalizing the sink.

---

#### M-4: SQLite Connection Opened Per-Query Without Pooling

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/adapters/sqlite.rs` (lines 16–20) |
| **Severity** | Medium |
| **Category** | Performance |

**Description:**  
```rust
fn open_db(&self) -> Result<Connection> {
    let conn = Connection::open(self.get_db_path())?;
    ...
}
```
Every call to `get_meetings()` or `get_meeting_details()` opens a new SQLite connection. While SQLite is lightweight, repeated open/close cycles add latency and can contend with the WAL-mode writer (the Node.js sidecar).

**Recommendation:**  
Maintain a single `Connection` (or a small pool) in `SqliteDatabase`, protected by a `Mutex`. SQLite supports concurrent readers in WAL mode.

---

#### M-5: Fragile DB Path Resolution via `current_dir()` Heuristics

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/adapters/sqlite.rs` (lines 22–30) |
| **Severity** | Medium |
| **Category** | Reliability |

**Description:**  
```rust
fn get_db_path(&self) -> String {
    let mut path = std::env::current_dir()...;
    if path.ends_with("src-tauri") { path.pop(); }
    path.push("gateway");
    path.push("meeting_history.db");
    ...
}
```
The DB path depends on the working directory at runtime. In a packaged Tauri app, the CWD may not be the project root, causing the DB to be created in an unexpected location or not found at all.

**Recommendation:**  
Use Tauri's `app.path().app_data_dir()` to resolve a stable, OS-appropriate data directory. Pass the path to `SqliteDatabase` at construction time.

---

#### M-6: `PcmDeframer` Magic-Byte Scan is O(n) on Corrupted Data

| Field | Value |
|-------|-------|
| **File** | `gateway/audio/pcm-deframer.js` (lines 47–54) |
| **Severity** | Medium |
| **Category** | Performance / DoS |

**Description:**  
When the magic bytes are not found at the start of the buffer, `scanForMagicBytes()` performs a linear scan of the entire buffer. If a large amount of corrupted data arrives (e.g., 64KB), this scan runs on every `append()` call, potentially blocking the Node.js event loop.

**Recommendation:**  
Limit the scan to a reasonable window (e.g., 4KB) and discard data beyond that. Alternatively, use `Buffer.indexOf()` which is optimized in C++.

---

#### M-7: `SemanticBuffer` Flush Timer Can Fire After Shutdown

| Field | Value |
|-------|-------|
| **File** | `gateway/audio/semantic-buffer.js` (lines 63–65) |
| **Severity** | Medium |
| **Category** | Lifecycle Bug |

**Description:**  
The silence-based flush timer (`setTimeout(..., SILENCE_MS)`) is set in `onTranscriptReceived()` but only cleared in `drain()`. If the process receives a shutdown signal between a transcript arrival and the timer firing, the callback may execute after `drain()` has completed, potentially calling `onChunkReady` on a closed pipeline.

**Recommendation:**  
Guard the timer callback with a `this.drained` flag, or clear the timer at the start of `drain()` (already done) and ensure no new timer is set after `drain()` is called.

---

#### M-8: `getTopSpeakers()` Receives Array but Treats Input as Object

| Field | Value |
|-------|-------|
| **File** | `gateway/state/speaker-tracker.js` (lines 33–37) |
| **Severity** | Medium |
| **Category** | Bug |

**Description:**  
```js
function getTopSpeakers(speakerStats, limit = 5) {
  return Object.values(speakerStats)
    .sort((a, b) => b.chunkCount - a.chunkCount)
    .slice(0, limit);
}
```
`getSpeakerStats()` returns an **array** of `{name, chunkCount, topics}` objects. `Object.values()` on an array returns the same elements, so this works by accident. However, the function signature and implementation suggest it was designed for an object/map input, creating confusion and fragility.

**Recommendation:**  
Accept the array directly and use `.sort()` on it, or refactor to consistently use a Map.

---

### LOW / INFORMATIONAL

#### L-1: Misleading Module Name — `mac_audio.rs` Uses WASAPI (Windows)

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/adapters/mac_audio.rs` |
| **Severity** | Low |
| **Category** | Code Clarity |

**Description:**  
The file is named `mac_audio.rs` and the struct is `MacAudioCapture`, but the doc comments reference WASAPI loopback (a Windows API). The code uses `cpal` which is cross-platform, but the naming is confusing. On macOS, native loopback capture is not supported (as noted in the code's fallback message).

**Recommendation:**  
Rename to `audio_capture.rs` / `AudioCapture` or `loopback_capture.rs` to reflect actual behavior.

---

#### L-2: `check_blackhole_installed` Returns `true` on Non-macOS

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/commands/audio_devices.rs` (lines 18–21) |
| **Severity** | Low |
| **Category** | Logic |

**Description:**  
On non-macOS platforms, the command unconditionally returns `Ok(true)`, implying BlackHole is installed. This is semantically incorrect — BlackHole is a macOS-only virtual audio device. The frontend may show misleading status.

**Recommendation:**  
Return a platform-appropriate response or rename the command to be macOS-specific.

---

#### L-3: `ctrlc` Crate Listed as Dependency but Unused

| Field | Value |
|-------|-------|
| **File** | `src-tauri/Cargo.toml` (line 30) |
| **Severity** | Low |
| **Category** | Dependency Hygiene |

**Description:**  
`ctrlc = "3.4.4"` is declared in `Cargo.toml` but never imported or used in any Rust source file. Signal handling is done via the sidecar's `SIGTERM`/`SIGINT` handlers in Node.js.

**Recommendation:**  
Remove the unused dependency to reduce compile time and attack surface.

---

#### L-4: `env_logger` Declared but Never Initialized

| Field | Value |
|-------|-------|
| **File** | `src-tauri/Cargo.toml` (line 32), `src-tauri/src/lib.rs` |
| **Severity** | Low |
| **Category** | Observability |

**Description:**  
`env_logger` is a dependency, and `log` macros (`info!`, `warn!`, `error!`) are used throughout `mac_audio.rs` and `streaming.rs`, but `env_logger::init()` is never called. All log output is silently discarded.

**Recommendation:**  
Add `env_logger::init()` at the start of `run()` in `lib.rs`, or use Tauri's built-in logging plugin.

---

#### L-5: `WavSink` Module Compiled but Unused in Production Path

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/wav_sink.rs` |
| **Severity** | Low |
| **Category** | Dead Code |

**Description:**  
`WavSink` implements `PcmSink` for writing WAV files, but the production path (`CaptureUseCase`) only uses `StreamingSink`. `WavSink` appears to be a development/debugging artifact.

**Recommendation:**  
Gate behind a `#[cfg(debug_assertions)]` or feature flag, or remove if no longer needed.

---

#### L-6: `list_output_devices()` Function Unused

| Field | Value |
|-------|-------|
| **File** | `src-tauri/src/adapters/mac_audio.rs` (lines 71–105) |
| **Severity** | Low |
| **Category** | Dead Code |

**Description:**  
`list_output_devices()` is a public function that prints device info to stdout, but it is never called from any command or use case.

**Recommendation:**  
Remove or expose as a debug command if useful.

---

#### L-7: Hardcoded `MAX_SPEAKERS = 4` for Speechmatics Diarization

| Field | Value |
|-------|-------|
| **File** | `gateway/providers/speechmatics.js` (line 24) |
| **Severity** | Low |
| **Category** | Configurability |

**Description:**  
The maximum number of speakers for diarization is hardcoded to 4. Meetings with more participants will have speakers merged or misidentified.

**Recommendation:**  
Make configurable via environment variable or agent config.

---

#### L-8: `DECISION_LANGUAGE` Regex Exported but Usage Unclear

| Field | Value |
|-------|-------|
| **File** | `gateway/config/agent-config.js` (line 1) |
| **Severity** | Low |
| **Category** | Code Clarity |

**Description:**  
`DECISION_LANGUAGE` is a regex for detecting decision-related keywords, exported alongside `AGENT_CONFIG`. Its usage is not immediately obvious from the config file alone.

**Recommendation:**  
Add a JSDoc comment explaining where and how it's used, or co-locate it with its consumer.

---

#### L-9: `start.sh` Script Not Reviewed for Windows Compatibility

| Field | Value |
|-------|-------|
| **File** | `start.sh` |
| **Severity** | Low |
| **Category** | Portability |

**Description:**  
The project includes a `start.sh` shell script, but the development environment is Windows 11. The script may not work without WSL/Git Bash.

**Recommendation:**  
Provide a `start.ps1` or `start.bat` equivalent, or document the expected shell environment.

---

## Architecture Assessment

### Strengths

| Aspect | Assessment |
|--------|------------|
| **Hexagonal Architecture (Rust)** | Clean ports/adapters separation. `AudioCapture`, `GatewayClient`, `Database` traits enable testability. |
| **Layered Pipeline (Node.js)** | Clear separation: STT providers → deframer → sanitizer → semantic buffer → chunk runner → agents → broadcaster. |
| **Forward-Only Migrations** | `migrate.js` implements transactional, versioned schema evolution. Extend-only rule preserves Rust read-path compatibility. |
| **Provider Fallback Chain** | `ProviderManager` supports ordered STT provider fallback (AssemblyAI → Speechmatics) with status events. |
| **Crash-Safe Persistence** | High-volume transcripts batch-flush every 5s; per-chunk artifacts write immediately. At most one in-flight chunk is lost on crash. |
| **Input Sanitization** | `validate.js` and `sanitizeText()` are applied consistently before DB writes. Parameterized queries prevent SQL injection. |
| **Graceful Shutdown** | `shutdown.js` drains the semantic buffer, attempts an LLM summary with a 12s deadline, falls back to a template summary, and closes the DB. |
| **Key Pool with Health Tracking** | `groq-key-pool.js` rotates multiple API keys and reports health status to the frontend. |

### Areas for Improvement

| Aspect | Recommendation |
|--------|----------------|
| **Testing** | No test files found in any layer. Add unit tests for `SemanticBuffer`, `PcmDeframer`, `mapSpeaker`, `sanitizeText`, and Rust adapters. |
| **Error Propagation** | Many `catch (_) {}` blocks silently swallow errors. At minimum, log at `warn` level. |
| **TypeScript Strictness** | Frontend uses TypeScript but `tsconfig.json` strictness settings should be verified. Enable `strict: true` if not already. |
| **Dependency Auditing** | Run `npm audit` and `cargo audit` regularly. `better-sqlite3` and `cpal` have native compilation requirements. |
| **Logging** | Rust-side logging is effectively disabled (L-4). Enable structured logging for production diagnostics. |

---

## Dependency Summary

### Node.js (gateway)

| Package | Purpose | Notes |
|---------|---------|-------|
| `@assemblyai/sdk` | Primary STT | WebSocket streaming |
| `@speechmatics/real-time-client` | Fallback STT | WebSocket streaming |
| `@speechmatics/auth` | JWT minting for Speechmatics | Short-lived tokens |
| `better-sqlite3` | SQLite persistence | Native module, WAL mode |
| `dotenv` | Env var loading | Keys should move to secure storage |
| `groq-sdk` | LLM inference | Multi-key pool |

### Rust (src-tauri)

| Crate | Purpose | Notes |
|-------|---------|-------|
| `tauri` v2 | Desktop app framework | CSP disabled |
| `cpal` 0.15 | Audio capture | Cross-platform, WASAPI loopback on Windows |
| `rusqlite` 0.31 | SQLite read path | Bundled, no pooling |
| `rubato` 0.16 | Audio resampling | FFT-based sinc interpolation |
| `hound` 3.5 | WAV writing | Debug/unused in production |
| `anyhow` | Error handling | Appropriate for application code |
| `ctrlc` 3.4 | Signal handling | **Unused — remove** |
| `env_logger` 0.11 | Logging | **Never initialized** |

---

## Remediation Priority

| Priority | Finding | Effort |
|----------|---------|--------|
| 🔴 Immediate | C-1: Rotate exposed API keys | Low |
| 🔴 Immediate | H-1: Enable CSP | Low |
| 🔴 Immediate | H-2: Disable `withGlobalTauri` | Low |
| 🟠 This Sprint | H-3: Harden sidecar path resolution | Medium |
| 🟠 This Sprint | H-4: Document stdin trust boundary | Low |
| 🟡 Next Sprint | M-1: Handle poisoned mutexes | Low |
| 🟡 Next Sprint | M-2: Bound audio channels | Low |
| 🟡 Next Sprint | M-3: Call `Resampler::flush()` | Low |
| 🟡 Next Sprint | M-5: Stable DB path via Tauri API | Medium |
| 🟢 Backlog | M-4, M-6, M-7, M-8 | Low–Medium |
| 🟢 Backlog | L-1 through L-9 | Low |

---

## Appendix: Files Reviewed

### Frontend (`src/`)
- `App.tsx`, `main.tsx`, `index.css`
- `features/capture/TopBar.tsx`, `CaptureView.tsx`, `useCapture.ts`
- `features/history/HistoryView.tsx`, `useHistory.ts`
- `hooks/useTauriEvents.ts`
- `services/TauriEventBus.ts`
- `interfaces/IEventBus.ts`

### Gateway (`gateway/`)
- `sidecar.js`
- `audio/pcm-deframer.js`, `audio/semantic-buffer.js`
- `agents/base-agent.js`, `agents/context-manager.js`
- `pipeline/agent-orchestrator.js`, `pipeline/chunk-broadcaster.js`, `pipeline/chunk-runner.js`, `pipeline/chit-chat-gate.js`
- `providers/assemblyai.js`, `providers/speechmatics.js`, `providers/mfcc.js`
- `stt/provider-manager.js`, `stt/diarization-layer.js`, `stt/transcript-sanitizer.js`
- `llm/groq-client.js`, `llm/groq-key-pool.js`, `llm/model-discovery.js`
- `db/index.js`, `db/migrate.js`
- `state/meeting-state.js`, `state/prompt-builder.js`, `state/speaker-tracker.js`
- `config/agent-config.js`
- `infrastructure/logger.js`, `infrastructure/validate.js`, `infrastructure/billing-tracker.js`, `infrastructure/stdout-protocol.js`, `infrastructure/text-similarity.js`
- `lifecycle/shutdown.js`
- `.env`

### Rust Backend (`src-tauri/`)
- `src/main.rs`, `src/lib.rs`
- `src/adapters/gateway_client.rs`, `src/adapters/mac_audio.rs`, `src/adapters/sqlite.rs`
- `src/application/capture_usecase.rs`
- `src/commands/capture.rs`, `src/commands/db.rs`, `src/commands/audio_devices.rs`
- `src/domain/meeting.rs`
- `src/ports/audio_capture.rs`, `src/ports/db.rs`, `src/ports/gateway.rs`
- `src/sidecar/event_router.rs`, `src/sidecar/events.rs`
- `src/streaming.rs`, `src/resample.rs`, `src/wav_sink.rs`
- `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`

### Configuration
- `.gitignore`
- `package.json` (root)
- `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`

---

*End of report.*