# SOLID Folder Structure Blueprint
### Meeting Interpreter — Full Project

> **Principle applied**: Every file has ONE reason to change. Dependencies flow inward (Dependency Inversion). Nothing imports directly from concrete implementations — only from interfaces/abstractions. Decoupling is achieved through **interfaces, dependency injection, services, modules, and APIs**.

---

## 📁 LAYER 1: `src/` — React Frontend (TypeScript)

```
src/
│
├── interfaces/                    ← 🔑 ALL contracts live here (ISP + DIP)
│   ├── ICaptureService.ts         ← interface ICaptureService { start(ctx): Promise<void>; stop(): Promise<void> }
│   ├── IHistoryRepository.ts      ← interface IHistoryRepository { getMeetings(): Promise<Meeting[]>; ... }
│   ├── IEventBus.ts               ← interface IEventBus { on(event, handler): void; off(event, handler): void }
│   └── ISpeakerRepository.ts      ← interface ISpeakerRepository { resolve(label): string; rename(label, name): void }
│
├── services/                      ← 🔧 Implementations of interfaces (DIP)
│   ├── TauriCaptureService.ts     ← implements ICaptureService — wraps invoke('start_capture')
│   ├── TauriHistoryRepository.ts  ← implements IHistoryRepository — wraps invoke('get_meetings')
│   ├── TauriEventBus.ts           ← implements IEventBus — wraps Tauri listen()
│   └── SpeakerRepository.ts       ← implements ISpeakerRepository — in-memory + Tauri rename command
│
├── context/                       ← 💉 Dependency Injection via React Context (DIP)
│   ├── ServicesContext.ts         ← createContext<{ capture: ICaptureService; history: IHistoryRepository; ... }>()
│   └── ServicesProvider.tsx       ← Instantiates concrete services, injects via Context
│
├── features/                      ← 📦 Feature modules (SRP — each feature is self-contained)
│   ├── capture/
│   │   ├── useCaptureSession.ts   ← consumes ICaptureService from context (NOT invoke() directly)
│   │   ├── TopBar.tsx
│   │   └── ContextModal.tsx
│   ├── transcript/
│   │   ├── useTranscript.ts       ← subscribes to IEventBus transcript events
│   │   ├── TranscriptPane.tsx
│   │   └── SpeakerRenameModal.tsx
│   ├── analysis/
│   │   ├── useAnalysis.ts         ← subscribes to IEventBus agent events
│   │   ├── InterpretationPane.tsx
│   │   └── RepliesPane.tsx
│   ├── history/
│   │   ├── useHistory.ts          ← consumes IHistoryRepository from context
│   │   └── HistoryView.tsx
│   └── onboarding/
│       └── BlackHoleModal.tsx
│
├── shared/                        ← ♻️ Reusable across features (OCP)
│   ├── components/
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Spinner.tsx
│   │   └── Overlays.tsx
│   └── hooks/
│       └── useEventSubscription.ts
│
├── types/                         ← 📐 Shared TypeScript types (data shapes, no logic)
│   ├── meeting.ts
│   ├── transcript.ts
│   ├── speaker.ts
│   └── status.ts
│
├── App.tsx                        ← Root: renders <ServicesProvider> + feature layout
└── main.tsx                       ← Bootstrap: renders <App />
```

### Frontend SOLID Map
| Principle | Applied How |
|---|---|
| SRP | Each feature folder owns its own UI + hook only |
| OCP | Services implement interfaces — swap without touching consumers |
| LSP | MockCaptureService replaces TauriCaptureService transparently in tests |
| ISP | ICaptureService only has capture methods — not mixed with history |
| DIP | Hooks consume ICaptureService from Context — never invoke() directly |

---

## 📁 LAYER 2: `src-tauri/src/` — Rust Backend (Tauri Shell)

```
src-tauri/src/
│
├── main.rs                        ← Entry: boot Tauri, call lib::run()
├── lib.rs                         ← DI Root: build AppState, register commands
│
├── domain/                        ← 📐 Pure domain types (no I/O — SRP)
│   ├── audio.rs                   ← struct AudioDevice, AudioFrame, enum AudioFormat
│   ├── meeting.rs                 ← struct Meeting, MeetingDetail, Transcript
│   └── capture.rs                 ← struct CaptureConfig, enum CaptureState
│
├── ports/                         ← 🔑 Rust traits = interfaces (DIP + ISP)
│   ├── audio_capture.rs           ← trait AudioCapture { fn list_devices(); fn start(); fn stop(); }
│   ├── audio_sink.rs              ← trait AudioSink { fn write_frame(frame: &AudioFrame); fn close(); }
│   ├── sidecar_process.rs         ← trait SidecarProcess { fn spawn(); fn send_audio(frame); fn kill(); }
│   └── meeting_repository.rs      ← trait MeetingRepository { fn get_meetings(); fn get_detail(id); }
│
├── adapters/                      ← 🔧 Concrete implementations of ports (OCP)
│   ├── cpal_audio_capture.rs      ← impl AudioCapture — uses cpal for real device capture
│   ├── wav_sink.rs                ← impl AudioSink — writes PCM to WAV (debug)
│   ├── node_sidecar_process.rs    ← impl SidecarProcess — spawns gateway/sidecar.js
│   └── sqlite_meeting_repository.rs ← impl MeetingRepository — reads meeting_history.db
│
├── audio/                         ← 🔊 Audio processing (SRP — only transforms audio)
│   ├── resampler.rs               ← fn resample(frames, from_rate, to_rate) → Vec<AudioFrame>
│   └── frame_streamer.rs          ← fn stream_frames(src: impl AudioCapture, sink: impl SidecarProcess)
│
├── sidecar/                       ← 🔌 Event bridge (SRP — only parses + routes)
│   ├── events.rs                  ← Typed structs: SidecarEvent, TranscriptEvent, AgentEvent
│   ├── event_parser.rs            ← fn parse_event(line: &str) → Option<SidecarEvent>
│   └── event_router.rs            ← fn route_event(event, window) → emits to frontend
│
├── commands/                      ← 📡 Tauri IPC API (ISP — each command is small)
│   ├── mod.rs
│   ├── audio_devices.rs           ← #[tauri::command] list_audio_devices(state)
│   ├── capture.rs                 ← #[tauri::command] start_capture, stop_capture
│   └── db.rs                      ← #[tauri::command] get_meetings, get_meeting_detail
│
└── state/                         ← 💉 Shared state injected via tauri::manage() (DI)
    └── app_state.rs               ← struct AppState { capture: Arc<dyn AudioCapture>, repo: Arc<dyn MeetingRepository> }
```

### Rust SOLID Map
| Principle | Applied How |
|---|---|
| SRP | domain/ has zero I/O; ports/ has zero implementation; adapters/ has zero business logic |
| OCP | Replace CpalAudioCapture with ScreenCaptureKit — zero command changes |
| LSP | WavSink replaces SidecarProcess in test mode (both impl AudioSink) |
| ISP | MeetingRepository only has read methods — never write (writes live in gateway) |
| DIP | Commands depend on Arc<dyn AudioCapture> not CpalAudioCapture — injected via AppState |

---

## 📁 LAYER 3: `gateway/` — Node.js AI Sidecar (SOLID)

```
gateway/
│
├── sidecar.js                     ← DI Root: wire every layer together, start pipeline
│
├── config/                        ← 📌 Configuration only (SRP)
│   └── agent-config.js            ← AGENT_CONFIG: model, timeout, retries per agent
│
├── interfaces/                    ← 🔑 JS contracts (JSDoc @interface — DIP + ISP)
│   ├── ITranscriptSanitizer.js    ← sanitize(text, confidence) → { ok, text, reason }
│   ├── ITranscriptCleaner.js      ← clean(text) → { action, text, reason }
│   ├── ISttProvider.js            ← connect(), sendAudio(buf), close() + EventEmitter events
│   ├── IAgent.js                  ← run(text, speaker) → Promise<{data, latencyMs}>
│   └── IChunkRepository.js        ← save(chunk, artifacts) → chunkId
│
├── infrastructure/                ← 🔧 Cross-cutting utilities (SRP — no domain logic)
│   ├── logger.js
│   ├── validate.js
│   ├── retry.js
│   ├── circuit-breaker.js
│   ├── stdout-protocol.js
│   └── text-similarity.js
│
├── llm/                           ← 🤖 LLM inference (SRP)
│   ├── groq-client.js             ← callGroq(opts) → {data, usage, latencyMs}
│   └── groq-key-pool.js
│
├── stt/                           ← 🎤 Speech-to-Text (SRP)
│   ├── provider-manager.js        ← ISttProvider fallback chain
│   ├── diarization-layer.js       ← Speaker label resolution
│   └── transcript-sanitizer.js    ← [NEW] implements ITranscriptSanitizer
│
├── audio/                         ← 🔊 Raw audio (SRP)
│   ├── pcm-deframer.js
│   └── semantic-buffer.js         ← onChunkReady callback injected — not hardcoded
│
├── agents/                        ← 🧠 AI Agents (OCP — add new agent = new file only)
│   ├── base-agent.js              ← runAgent(agent: IAgent, ...) — shared execution shell
│   ├── transcript-cleaner.js      ← [NEW] implements ITranscriptCleaner — LLM hallucination filter
│   ├── context-manager.js         ← implements IAgent
│   ├── analyst.js                 ← implements IAgent
│   ├── explanation.js             ← implements IAgent
│   ├── risk-detector.js           ← implements IAgent
│   ├── technical.js               ← implements IAgent
│   └── response.js                ← implements IAgent
│
├── pipeline/                      ← ⚙️ Flow orchestration only (SRP — zero business logic)
│   ├── agent-orchestrator.js      ← runs all IAgent instances
│   ├── chunk-runner.js            ← sanitize → clean → analyse → persist → broadcast
│   ├── chunk-persister.js         ← implements IChunkRepository
│   └── chunk-broadcaster.js       ← stdout event emitter
│
├── state/                         ← 💾 In-memory state (SRP — no I/O)
│   ├── meeting-state.js
│   ├── speaker-tracker.js
│   └── prompt-builder.js          ← Agents depend on this, not directly on meeting-state
│
├── providers/                     ← 🔌 STT adapters (OCP — add providers, no pipeline change)
│   ├── assemblyai.js              ← implements ISttProvider
│   ├── speechmatics.js            ← implements ISttProvider
│   └── mfcc.js
│
├── db/                            ← 🗄️ Persistence (SRP)
│   ├── index.js
│   └── migrate.js
│
└── lifecycle/
    └── shutdown.js
```

### Gateway SOLID Map
| Principle | Applied How |
|---|---|
| SRP | pipeline/ has no logic; agents/ have no I/O; state/ has no LLM calls |
| OCP | New agent = new file in agents/ + one line in orchestrator. Nothing else changes. |
| LSP | assemblyai.js and speechmatics.js both implement ISttProvider — provider-manager is unaware |
| ISP | IAgent only has run(). ISttProvider only has audio methods. They never overlap. |
| DIP | chunk-runner depends on ITranscriptSanitizer not on the concrete sanitizer file |

---

## 🔄 Full Decoupling Flow

```
React UI
  ↓ ICaptureService (interface — not invoke() directly)
ServicesProvider (DI container)
  ↓
TauriCaptureService → invoke('start_capture')
  ↓
Rust commands/capture.rs → Arc<dyn AudioCapture> (trait — not CpalAudioCapture)
  ↓
adapters/cpal_audio_capture.rs → PCM frames → impl SidecarProcess
  ↓
gateway/audio/pcm-deframer.js → onDecodedFrame callback (injected)
  ↓
gateway/stt/provider-manager.js (ISttProvider chain — assemblyai or speechmatics)
  ↓
gateway/stt/transcript-sanitizer.js (ITranscriptSanitizer — rule-based filter)
  ↓
gateway/audio/semantic-buffer.js → onChunkReady callback (injected — not hardcoded)
  ↓
gateway/pipeline/chunk-runner.js
  ↓ ITranscriptCleaner.clean(text) — LLM hallucination filter
gateway/agents/transcript-cleaner.js
  ↓ clean text
gateway/pipeline/agent-orchestrator.js → IAgent.run() × 7
  ↓
chunk-persister.js + chunk-broadcaster.js → stdout JSON
  ↓
Rust sidecar/event_router.rs → Tauri emit()
  ↓
React hooks/useTranscript.ts → IEventBus (not listen() directly)
  ↓
React components render
```
