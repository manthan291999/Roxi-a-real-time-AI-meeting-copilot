# Meeting Interpreter — Full Production Folder & File Structure

> **Architecture goal:** A maintainable Tauri + React + Rust + Node.js AI meeting interpreter with explicit SOLID boundaries, dependency inversion, low coupling, high cohesion, testability, provider interchangeability, and clear ownership for every file.

---

# 1. Architecture Principles

The project follows these rules:

Presentation
    ↓
Application
    ↓
Domain
    ↑
Ports
    ↑
Adapters / Infrastructure
```

More precisely, runtime flow may travel through adapters, but **business/application code must depend on abstractions (ports), not vendor implementations**.

## Dependency Rule

```text
GOOD

Agent
  ↓
LLMProvider
  ↓
GroqAdapter
  ↓
Groq SDK


BAD

Agent
  ↓
Groq SDK
```

```text
GOOD

ChunkRunner
  ↓
STTProvider
  ↓
AssemblyAIAdapter
```

```text
BAD

ChunkRunner
  ↓
AssemblyAI SDK
```

```text
GOOD

ChunkRunner
  ↓
MeetingRepository
  ↓
SQLiteRepository
```

```text
BAD

ChunkRunner
  ↓
better-sqlite3
```

---

# 2. Complete Repository Structure

```text
meeting-interpreter-mac/
│
├── README.md
├── ARCHITECTURE.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
├── LICENSE
├── .gitignore
├── .editorconfig
├── .env.example
│
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── start.sh
│
├── docs/
│   ├── architecture/
│   │   ├── system-overview.md
│   │   ├── dependency-rules.md
│   │   ├── data-flow.md
│   │   ├── event-flow.md
│   │   ├── audio-flow.md
│   │   ├── ai-pipeline.md
│   │   └── failure-strategy.md
│   │
│   ├── decisions/
│   │   ├── ADR-001-tauri-desktop.md
│   │   ├── ADR-002-node-sidecar.md
│   │   ├── ADR-003-provider-abstraction.md
│   │   ├── ADR-004-sqlite-persistence.md
│   │   └── ADR-005-event-protocol.md
│   │
│   └── development/
│       ├── local-setup.md
│       ├── debugging.md
│       ├── testing.md
│       └── release.md
│
├── scripts/
│   ├── dev.js
│   ├── build.js
│   ├── test.js
│   ├── lint.js
│   └── clean.js
│
├── migrations/
│   ├── 001_initial_schema.sql
│   ├── 002_add_meeting_context.sql
│   └── 003_add_agent_results.sql
│
├── tests/
│   ├── fixtures/
│   │   ├── transcripts/
│   │   ├── audio/
│   │   ├── agent-results/
│   │   └── events/
│   │
│   ├── integration/
│   │   ├── stt-provider.integration.test.js
│   │   ├── llm-provider.integration.test.js
│   │   ├── database.integration.test.js
│   │   └── sidecar.integration.test.js
│   │
│   └── e2e/
│       └── meeting-session.e2e.test.ts
│
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   └── providers.tsx
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── TopBar.tsx
│   │   │   ├── MainPanel.tsx
│   │   │   └── StatusBar.tsx
│   │   │
│   │   ├── transcript/
│   │   │   ├── TranscriptPane.tsx
│   │   │   ├── TranscriptItem.tsx
│   │   │   ├── SpeakerLabel.tsx
│   │   │   └── TranscriptToolbar.tsx
│   │   │
│   │   ├── interpretation/
│   │   │   ├── InterpretationPane.tsx
│   │   │   ├── InsightCard.tsx
│   │   │   ├── RiskCard.tsx
│   │   │   ├── DecisionCard.tsx
│   │   │   ├── TopicCard.tsx
│   │   │   └── TechnicalExplanationCard.tsx
│   │   │
│   │   ├── replies/
│   │   │   ├── RepliesPane.tsx
│   │   │   ├── ReplyChip.tsx
│   │   │   └── ReplyDetails.tsx
│   │   │
│   │   ├── history/
│   │   │   ├── HistoryView.tsx
│   │   │   ├── MeetingList.tsx
│   │   │   ├── MeetingListItem.tsx
│   │   │   └── MeetingDetails.tsx
│   │   │
│   │   ├── modals/
│   │   │   ├── ContextModal.tsx
│   │   │   ├── BlackHoleModal.tsx
│   │   │   └── SpeakerRenameModal.tsx
│   │   │
│   │   ├── feedback/
│   │   │   ├── LoadingOverlay.tsx
│   │   │   ├── ErrorBanner.tsx
│   │   │   └── Toast.tsx
│   │   │
│   │   └── shared/
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Badge.tsx
│   │       ├── Dialog.tsx
│   │       └── Spinner.tsx
│   │
│   ├── hooks/
│   │   ├── useCaptureSession.ts
│   │   ├── useTauriEvents.ts
│   │   ├── useSpeakerMap.ts
│   │   ├── useMeetingHistory.ts
│   │   └── useMeetingContext.ts
│   │
│   ├── api/
│   │   ├── captureApi.ts
│   │   ├── meetingApi.ts
│   │   ├── audioApi.ts
│   │   └── eventApi.ts
│   │
│   ├── state/
│   │   ├── captureStore.ts
│   │   ├── transcriptStore.ts
│   │   ├── insightStore.ts
│   │   └── meetingStore.ts
│   │
│   ├── types/
│   │   ├── transcript.ts
│   │   ├── meeting.ts
│   │   ├── insight.ts
│   │   ├── agent.ts
│   │   ├── events.ts
│   │   └── index.ts
│   │
│   ├── constants/
│   │   ├── events.ts
│   │   ├── defaults.ts
│   │   └── index.ts
│   │
│   ├── utils/
│   │   ├── formatTime.ts
│   │   ├── formatTranscript.ts
│   │   └── safeJson.ts
│   │
│   ├── assets/
│   │   ├── icons/
│   │   └── images/
│   │
│   ├── main.tsx
│   ├── main.ts
│   └── styles.css
│
├── src-tauri/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── build.rs
│   ├── tauri.conf.json
│   │
│   ├── capabilities/
│   │   └── default.json
│   │
│   ├── icons/
│   │   └── ...
│   │
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       │
│       ├── domain/
│       │   ├── audio.rs
│       │   ├── meeting.rs
│       │   └── device.rs
│       │
│       ├── application/
│       │   ├── capture_service.rs
│       │   ├── device_service.rs
│       │   └── meeting_service.rs
│       │
│       ├── ports/
│       │   ├── audio_capture.rs
│       │   ├── audio_stream.rs
│       │   ├── meeting_repository.rs
│       │   └── sidecar_gateway.rs
│       │
│       ├── adapters/
│       │   ├── audio/
│       │   │   ├── cpal_capture.rs
│       │   │   ├── resampler.rs
│       │   │   └── wav_sink.rs
│       │   │
│       │   ├── persistence/
│       │   │   └── sqlite_repository.rs
│       │   │
│       │   └── sidecar/
│       │       └── node_sidecar.rs
│       │
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── audio_devices.rs
│       │   ├── capture.rs
│       │   └── meetings.rs
│       │
│       ├── sidecar/
│       │   ├── events.rs
│       │   └── event_router.rs
│       │
│       └── infrastructure/
│           ├── error.rs
│           ├── logging.rs
│           └── config.rs
│
└── gateway/
    ├── package.json
    ├── package-lock.json
    ├── sidecar.js
    ├── .env.example
    │
    ├── config/
    │   ├── index.js
    │   ├── providers.js
    │   ├── agents.js
    │   └── runtime.js
    │
    ├── domain/
    │   ├── meeting/
    │   │   ├── meeting.js
    │   │   ├── meeting-state.js
    │   │   └── speaker.js
    │   │
    │   ├── transcript/
    │   │   ├── transcript.js
    │   │   ├── transcript-segment.js
    │   │   └── transcript-chunk.js
    │   │
    │   └── analysis/
    │       ├── insight.js
    │       ├── agent-result.js
    │       └── recommendation.js
    │
    ├── application/
    │   ├── capture/
    │   │   ├── capture-session.js
    │   │   └── transcript-session.js
    │   │
    │   ├── pipeline/
    │   │   ├── chunk-runner.js
    │   │   ├── agent-orchestrator.js
    │   │   ├── chunk-persister.js
    │   │   └── chunk-broadcaster.js
    │   │
    │   └── services/
    │       ├── meeting-service.js
    │       ├── analysis-service.js
    │       └── context-service.js
    │
    ├── ports/
    │   ├── stt-provider.js
    │   ├── llm-provider.js
    │   ├── database.js
    │   ├── event-bus.js
    │   ├── logger.js
    │   └── speaker-embedding-provider.js
    │
    ├── adapters/
    │   ├── stt/
    │   │   ├── assemblyai-adapter.js
    │   │   ├── speechmatics-adapter.js
    │   │   └── fallback-stt-adapter.js
    │   │
    │   ├── llm/
    │   │   ├── groq-adapter.js
    │   │   └── model-router-adapter.js
    │   │
    │   ├── persistence/
    │   │   └── sqlite-adapter.js
    │   │
    │   ├── events/
    │   │   └── stdout-event-adapter.js
    │   │
    │   └── speaker/
    │       └── mfcc-adapter.js
    │
    ├── agents/
    │   ├── base/
    │   │   ├── base-agent.js
    │   │   └── agent-contract.js
    │   │
    │   ├── analyst/
    │   │   └── analyst-agent.js
    │   │
    │   ├── context/
    │   │   └── context-manager-agent.js
    │   │
    │   ├── explanation/
    │   │   └── explanation-agent.js
    │   │
    │   ├── risk/
    │   │   └── risk-detector-agent.js
    │   │
    │   ├── technical/
    │   │   └── technical-agent.js
    │   │
    │   └── response/
    │       └── response-agent.js
    │
    ├── prompts/
    │   ├── shared/
    │   │   ├── system-rules.js
    │   │   └── output-schema.js
    │   ├── analyst.js
    │   ├── context-manager.js
    │   ├── explanation.js
    │   ├── risk-detector.js
    │   ├── technical.js
    │   └── response.js
    │
    ├── audio/
    │   ├── pcm-deframer.js
    │   └── semantic-buffer.js
    │
    ├── state/
    │   ├── meeting-state-store.js
    │   ├── speaker-tracker.js
    │   └── prompt-context.js
    │
    ├── infrastructure/
    │   ├── logging/
    │   │   └── logger.js
    │   ├── resilience/
    │   │   ├── retry.js
    │   │   └── circuit-breaker.js
    │   ├── validation/
    │   │   └── validate.js
    │   ├── similarity/
    │   │   └── text-similarity.js
    │   ├── protocol/
    │   │   └── stdout-protocol.js
    │   └── errors/
    │       └── error-types.js
    │
    ├── lifecycle/
    │   ├── startup.js
    │   └── shutdown.js
    │
    ├── bootstrap/
    │   ├── container.js
    │   ├── dependencies.js
    │   ├── providers.js
    │   ├── agents.js
    │   └── pipeline.js
    │
    └── tools/
        ├── transcriber.js
        └── pcm-consumer.js
```

---

# 3. Layer Responsibilities

## `domain/`

Contains business concepts only.

It should not import:

- Groq
- AssemblyAI
- Speechmatics
- SQLite
- Tauri
- React
- Node SDKs

Example:

```text
domain/meeting/meeting.js
domain/transcript/transcript.js
domain/analysis/insight.js
```

The domain represents **what the product knows**.

---

# 4. `application/`

Contains use cases and orchestration.

Examples:

```text
application/pipeline/chunk-runner.js
application/pipeline/agent-orchestrator.js
application/services/meeting-service.js
```

Application code coordinates work but should not know vendor implementation details.

Good:

```javascript
constructor({ sttProvider, llmProvider, repository }) {
    this.stt = sttProvider;
    this.llm = llmProvider;
    this.repository = repository;
}
```

Bad:

```javascript
import Groq from "groq-sdk";
import AssemblyAI from "...";
import Database from "better-sqlite3";
```

---

# 5. `ports/`

Ports are contracts.

They define **what the application needs**, not how a vendor provides it.

## `ports/llm-provider.js`

```javascript
export class LLMProvider {
    async generate(request) {
        throw new Error("LLMProvider.generate() must be implemented");
    }
}
```

## `ports/stt-provider.js`

```javascript
export class STTProvider {
    async start() {
        throw new Error("STTProvider.start() must be implemented");
    }

    async sendAudio(audio) {
        throw new Error("STTProvider.sendAudio() must be implemented");
    }

    async stop() {
        throw new Error("STTProvider.stop() must be implemented");
    }
}
```

## `ports/database.js`

```javascript
export class MeetingRepository {
    async saveMeeting(meeting) {
        throw new Error("Not implemented");
    }

    async saveTranscriptChunk(chunk) {
        throw new Error("Not implemented");
    }

    async saveAgentResults(results) {
        throw new Error("Not implemented");
    }

    async getMeetings() {
        throw new Error("Not implemented");
    }
}
```

---

# 6. `adapters/`

Adapters implement the ports.

Examples:

```text
adapters/
├── stt/
│   ├── assemblyai-adapter.js
│   ├── speechmatics-adapter.js
│   └── fallback-stt-adapter.js
│
├── llm/
│   ├── groq-adapter.js
│   └── model-router-adapter.js
│
├── persistence/
│   └── sqlite-adapter.js
│
└── events/
    └── stdout-event-adapter.js
```

This is where vendor-specific code belongs.

---

# 7. Agent Architecture

Every agent must have one clear responsibility.

```text
agents/
├── analyst/
├── context/
├── explanation/
├── risk/
├── technical/
└── response/
```

Each agent should receive dependencies:

```javascript
class RiskDetectorAgent {
    constructor({ llm, logger }) {
        this.llm = llm;
        this.logger = logger;
    }
}
```

Do not create vendor clients inside an agent.

Bad:

```javascript
class RiskDetectorAgent {
    constructor() {
        this.groq = new Groq(...);
    }
}
```

Good:

```javascript
class RiskDetectorAgent {
    constructor({ llm }) {
        this.llm = llm;
    }
}
```

---

# 8. Agent Orchestrator

The orchestrator should work with the agent contract instead of concrete agent classes.

```javascript
class AgentOrchestrator {
    constructor({ agents, logger }) {
        this.agents = agents;
        this.logger = logger;
    }

    async run(context) {
        return Promise.all(
            this.agents.map(agent => agent.analyze(context))
        );
    }
}
```

Adding a new agent should require configuration/container changes, not rewriting orchestration logic.

---

# 9. Dependency Injection / Composition Root

All concrete implementations should be assembled in:

```text
gateway/bootstrap/
├── container.js
├── dependencies.js
├── providers.js
├── agents.js
└── pipeline.js
```

This is the **composition root**.

Example:

```javascript
const llmProvider = new GroqAdapter(config.groq);

const sttProvider = new FallbackSTTAdapter({
    primary: new AssemblyAIAdapter(config.assemblyai),
    secondary: new SpeechmaticsAdapter(config.speechmatics)
});

const database = new SQLiteAdapter(config.database);

const riskAgent = new RiskDetectorAgent({
    llm: llmProvider,
    logger
});

const orchestrator = new AgentOrchestrator({
    agents: [riskAgent, analystAgent, technicalAgent],
    logger
});

const runner = new ChunkRunner({
    sttProvider,
    agentOrchestrator: orchestrator,
    repository: database
});
```

This is where dependencies should be wired.

---

# 10. SOLID Mapping

## S — Single Responsibility Principle

Each component should have one reason to change.

```text
AssemblyAIAdapter      → AssemblyAI integration
RiskDetectorAgent      → risk analysis
SQLiteAdapter           → SQLite persistence
ChunkBroadcaster        → event delivery
SpeakerTracker          → speaker state
```

Avoid:

```text
GodService
```

that handles audio + STT + LLM + database + UI events.

---

## O — Open/Closed Principle

Providers should be extendable without modifying business logic.

Adding:

```text
GeminiAdapter
```

should not require changing:

```text
AgentOrchestrator
RiskDetectorAgent
ChunkRunner
```

---

## L — Liskov Substitution Principle

Any implementation of a port must honor the same contract.

```text
STTProvider
    ↑
    ├── AssemblyAIAdapter
    └── SpeechmaticsAdapter
```

The pipeline should work with either implementation.

---

## I — Interface Segregation Principle

Do not create one giant provider interface.

Bad:

```text
AIProvider
├── generate
├── transcribe
├── embed
├── moderate
├── synthesize
└── streamAudio
```

Better:

```text
LLMProvider
STTProvider
EmbeddingProvider
ModerationProvider
```

Only add ports when the project actually needs them.

---

## D — Dependency Inversion Principle

This is the most important principle for your project.

Bad:

```text
ChunkRunner → GroqAdapter
```

Good:

```text
ChunkRunner → LLMProvider ← GroqAdapter
```

Bad:

```text
ChunkRunner → SQLiteAdapter
```

Good:

```text
ChunkRunner → MeetingRepository ← SQLiteAdapter
```

---

# 11. Coupling Rules

## Rule 1

Application code must not import concrete vendors.

```text
application/ ❌ → groq-sdk
application/ ❌ → assemblyai
application/ ❌ → better-sqlite3
```

## Rule 2

Ports must not import adapters.

```text
ports/ ❌ → adapters/
```

## Rule 3

Domain must stay pure.

```text
domain/ ❌ → infrastructure/
domain/ ❌ → adapters/
domain/ ❌ → SDKs
```

## Rule 4

Adapters may depend on ports.

```text
adapters/groq-adapter.js
    ↓
ports/llm-provider.js
```

## Rule 5

UI must not directly contain backend implementation details.

Bad:

```typescript
component → invoke("internal_command_name")
```

Prefer:

```text
component
   ↓
hook
   ↓
api/
   ↓
Tauri command
```

---

# 12. Frontend Dependency Flow

```text
React Component
      ↓
Custom Hook
      ↓
API Module
      ↓
Tauri Command
      ↓
Rust Application Service
      ↓
Rust Port
      ↓
Rust Adapter
```

Example:

```text
TopBar.tsx
   ↓
useCaptureSession.ts
   ↓
captureApi.ts
   ↓
Tauri "start_capture"
   ↓
capture_service.rs
   ↓
audio_capture.rs
   ↓
cpal_capture.rs
```

This keeps UI independent from the native implementation.

---

# 13. Rust Dependency Flow

```text
commands/
    ↓
application/
    ↓
ports/
    ↓
adapters/
```

Example:

```text
commands/capture.rs
        ↓
application/capture_service.rs
        ↓
ports/audio_capture.rs
        ↓
adapters/audio/cpal_capture.rs
        ↓
cpal
```

The service must not directly instantiate `cpal`.

---

# 14. Audio Pipeline

```text
macOS audio device
        ↓
cpal_capture.rs
        ↓
AudioCapture port
        ↓
CaptureService
        ↓
SidecarGateway port
        ↓
Node sidecar
        ↓
pcm-deframer.js
        ↓
semantic-buffer.js
        ↓
STTProvider
        ↓
AssemblyAI / Speechmatics
```

---

# 15. AI Analysis Pipeline

```text
Transcript Chunk
       ↓
ChunkRunner
       ↓
Context Service
       ↓
Agent Orchestrator
       ↓
┌────────────┬────────────┬────────────┬────────────┐
│ Analyst    │ Risk       │ Technical  │ Explanation│
└────────────┴────────────┴────────────┴────────────┘
       ↓
Response Agent
       ↓
Agent Results
       ↓
Repository + Event Bus
       ↓
SQLite + Tauri
       ↓
React UI
```

---

# 16. Runtime Dependency Graph

```text
                    ┌─────────────────────┐
                    │       React        │
                    └──────────┬──────────┘
                               │
                         Tauri IPC
                               │
                    ┌──────────▼──────────┐
                    │    Rust Application │
                    └──────────┬──────────┘
                               │
                         Sidecar IPC
                               │
                    ┌──────────▼──────────┐
                    │ Node Application    │
                    │     Pipeline        │
                    └──────────┬──────────┘
                               │
                       ┌───────┼────────┐
                       │       │        │
                      STT     LLM      DB
                       │       │        │
                ┌──────┴──┐ ┌──┴──┐ ┌──┴────┐
                │Assembly │ │Groq │ │SQLite │
                │Speech   │ │ ... │ │       │
                └─────────┘ └─────┘ └───────┘
```

---

# 17. File Ownership Rules

Every file should answer one question:

> **"What single responsibility does this file own?"**

Examples:

```text
chunk-runner.js
→ Owns execution of one transcript chunk.

agent-orchestrator.js
→ Owns parallel execution of agents.

chunk-persister.js
→ Owns mapping pipeline results into persistence operations.

chunk-broadcaster.js
→ Owns publishing pipeline events.

groq-adapter.js
→ Owns the Groq SDK integration.

sqlite-adapter.js
→ Owns SQLite persistence.

risk-detector-agent.js
→ Owns risk analysis.

speaker-tracker.js
→ Owns speaker-related state.
```

---

# 18. What Must NOT Happen

## Do not create dependencies like this

```text
RiskDetector
    ↓
Groq
    ↓
SQLite
    ↓
stdout
```

One class should not know the whole system.

## Do not create God classes

Avoid:

```text
MeetingManager
```

that does:

```text
audio
transcription
LLM
database
speaker tracking
events
shutdown
```

Split it.

## Do not make every utility an interface

Do not create abstractions for trivial pure functions.

Example:

```javascript
normalizeText(text)
```

does not need:

```text
NormalizeTextPort
NormalizeTextAdapter
NormalizeTextService
NormalizeTextFactory
```

That would increase complexity without buying useful decoupling.

---

# 19. Testing Structure

```text
gateway/
├── domain/
├── application/
├── ports/
├── adapters/
├── agents/
└── ...

tests/
├── unit/
│   ├── domain/
│   ├── application/
│   ├── agents/
│   └── infrastructure/
│
├── integration/
│   ├── stt/
│   ├── llm/
│   ├── persistence/
│   └── sidecar/
│
└── e2e/
```

The main benefit of decoupling is that application tests can use fakes.

Example:

```javascript
const fakeLLM = {
    generate: async () => ({
        text: "test response"
    })
};

const agent = new RiskDetectorAgent({
    llm: fakeLLM
});
```

No real Groq API is required.

---

# 20. Provider Replacement Test

A good architecture should allow:

```text
                  LLMProvider
                 /          \
                /            \
           GroqAdapter     FakeLLM
                |
          Production API
```

The same agent should work with both.

Likewise:

```text
                  STTProvider
                 /          \
        AssemblyAI       FakeSTT
```

and:

```text
              MeetingRepository
                 /          \
          SQLiteAdapter    InMemoryRepo
```

If swapping these requires changing your business logic, the coupling is too high.

---

# 21. Recommended Import Rules

Use these rules during code review.

```text
domain
  ✅ standard library
  ✅ domain modules
  ❌ adapters
  ❌ infrastructure
  ❌ vendors

application
  ✅ domain
  ✅ ports
  ✅ application modules
  ❌ concrete vendor SDKs

ports
  ✅ types/contracts
  ❌ adapters
  ❌ SDKs

adapters
  ✅ ports
  ✅ vendor SDKs
  ✅ infrastructure

agents
  ✅ domain
  ✅ ports
  ✅ prompts
  ✅ infrastructure helpers
  ❌ vendor SDKs directly

frontend components
  ✅ hooks
  ✅ UI utilities
  ❌ direct native implementation details

bootstrap
  ✅ everything needed to assemble dependencies
```

---

# 22. Recommended Startup Flow

```text
sidecar.js
    ↓
bootstrap/container.js
    ↓
bootstrap/dependencies.js
    ↓
bootstrap/providers.js
    ↓
bootstrap/agents.js
    ↓
bootstrap/pipeline.js
    ↓
application pipeline starts
```

The composition root is where concrete implementations are created.

This keeps object construction out of business logic.

---

# 23. Recommended Shutdown Flow

```text
SIGTERM / SIGINT
       ↓
lifecycle/shutdown.js
       ↓
stop capture
       ↓
flush semantic buffer
       ↓
finish pending STT
       ↓
finish pending agents
       ↓
persist final state
       ↓
publish shutdown event
       ↓
close database
       ↓
close sidecar
```

Shutdown logic must not be spread through unrelated modules.

---

# 24. The Golden Rule

When adding a new technology, ask:

> **"Does business logic really need to know this technology exists?"**

If the answer is no:

```text
Put it behind an adapter.
Expose a port.
Inject it.
```

Example:

```text
New LLM provider
       ↓
New Adapter
       ↓
LLMProvider
       ↑
Existing application code
```

You should ideally add a new provider without rewriting the pipeline.

---

# 25. Final Target

The architecture should eventually have this shape:

```text
                    PRESENTATION
                         │
                         ▼
                     API / IPC
                         │
                         ▼
                    APPLICATION
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
           DOMAIN      PORTS      DOMAIN
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
            STT         LLM         DB
              │          │          │
              ▼          ▼          ▼
           Adapter     Adapter    Adapter
              │          │          │
              ▼          ▼          ▼
         External     External   Storage
          Service      Service
```

The result is:

```text
LOW COUPLING
HIGH COHESION
CLEAR RESPONSIBILITIES
TESTABLE APPLICATION LOGIC
PROVIDER INDEPENDENCE
EASIER MAINTENANCE
EASIER FEATURE DEVELOPMENT
```

---

# 26. Refactoring Order for the Existing Project

Do not rewrite the application all at once.

Use this order:

```text
1. Inventory current imports and dependencies.
2. Identify business logic mixed with vendor code.
3. Create ports.
4. Move vendor-specific code into adapters.
5. Inject dependencies through constructors/factories.
6. Create the bootstrap composition root.
7. Remove direct vendor imports from application/agents.
8. Separate UI API calls from components.
9. Add unit tests using fake ports.
10. Add integration tests for real adapters.
11. Remove abstractions that provide no practical value.
12. Enforce dependency rules in code review.
```

## Priority order for this project

```text
HIGH PRIORITY
─────────────
LLM provider boundary
STT provider boundary
Database boundary
Agent dependency injection
Pipeline dependency injection
Sidecar event boundary

MEDIUM PRIORITY
───────────────
Rust audio abstraction
Rust repository abstraction
React API boundary
Configuration separation

LOW PRIORITY
────────────
Abstractions for tiny utilities
Extra factories with no replacement need
Extra interfaces created only for "SOLID"
```

---

# 27. Definition of "Done"

The refactor is complete only when:

```text
[ ] Agents do not import vendor SDKs.
[ ] Pipeline does not import vendor SDKs.
[ ] Application code does not instantiate concrete providers.
[ ] STT implementations sit behind STTProvider.
[ ] LLM implementations sit behind LLMProvider.
[ ] Persistence sits behind MeetingRepository.
[ ] Event delivery sits behind EventBus.
[ ] Dependencies are created in bootstrap/.
[ ] Components do not contain Tauri implementation details.
[ ] Core business logic is unit-testable without network calls.
[ ] Provider replacement does not require business-logic changes.
[ ] No layer depends upward on an implementation layer.
[ ] Each module has one clear responsibility.
```

---

# 28. Final Dependency Direction

The most important rule in the entire repository:

```text
                    ┌───────────────────┐
                    │     DOMAIN        │
                    └─────────▲─────────┘
                              │
                    ┌─────────┴─────────┐
                    │   APPLICATION     │
                    └─────────▲─────────┘
                              │
                    ┌─────────┴─────────┐
                    │      PORTS        │
                    └─────────▲─────────┘
                              │
                    ┌─────────┴─────────┐
                    │     ADAPTERS      │
                    └─────────▲─────────┘
                              │
                    ┌─────────┴─────────┐
                    │ EXTERNAL SYSTEMS  │
                    └───────────────────┘
```

**Business logic owns the rules.  
Ports define what it needs.  
Adapters provide the implementation.  
Bootstrap wires everything together.**

That is the architectural boundary this project should preserve as it grows.
