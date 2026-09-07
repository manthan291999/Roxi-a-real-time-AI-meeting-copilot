# Roxi Overlay UI — Final Implementation Plan

## Confirmed Decisions

| Decision | Answer |
|---|---|
| Window Strategy | ✅ **Separate Tauri windows** — Toolbar + Caption as independent OS windows |
| Suggest Answers trigger | ✅ **Auto-fire** from pipeline, manually dismissible |
| Shortcut storage | ✅ **`tauri-plugin-store`** JSON file |

---

## UI Mockups

### 1. Floating Toolbar (always-on-top pill bar)

![Floating Toolbar](file:///Users/manthan/.gemini/antigravity-ide/brain/d6b1fa9f-5bed-452c-8bc1-5df381a2d06b/toolbar_mockup_1788335297383.jpg)

Slim dark glassmorphism pill. Left-to-right: drag handle → Recording dots → Answer `⌘↵` → Screenshot `⌘⇧↵` → Chat `⌘⇧⌫` → ⋮ overflow → collapse → red **End** button.

---

### 2. Live Caption Strip (collapsed + expanded states)

![Caption Strip](file:///Users/manthan/.gemini/antigravity-ide/brain/d6b1fa9f-5bed-452c-8bc1-5df381a2d06b/caption_strip_mockup_1788339340003.jpg)

**Collapsed:** live waveform + rolling partial transcript + Clear + expand arrow.
**Expanded:** full utterance text + `⌘←` / `⌘→` navigation arrows + utterance counter `3 / 7`.

---

### 3. Main Panel — Suggest Answers Tab

![Suggest Answers Panel](file:///Users/manthan/.gemini/antigravity-ide/brain/d6b1fa9f-5bed-452c-8bc1-5df381a2d06b/suggest_answers_panel_mockup_1788339387293.jpg)

Key visual elements visible:
- **"Ready to say →"** label — the user can read this aloud directly
- **Green row** = verbatim match (97% confidence — exact speaker words)
- **Purple left border** = technical content (84% — jargon/specs)
- **Tags** pulled directly from agents: `technical` (purple), `decision` (blue), `risk` (amber)
- **Follow-up chips**: "Make it shorter" | "More formal" | "+ Custom"
- **Input bar** with active context chip "Your screen · Use image ✕"

---

## Workstream 0 — Dead Code Deletion (Do This First)

Full audit complete. These files/dirs are **confirmed dead** — zero imports anywhere in the codebase:

| File | Why Dead |
|---|---|
| `gateway/config/agent-config.js` | `AGENT_CONFIG` and `DECISION_LANGUAGE` — **zero imports** in the entire gateway. Never required by any active file. |
| `gateway/llm/` (entire dir) | Directory is **empty** — was `openai-client.js` and `llm-port.js`, already deleted previously. Empty folder remains. |
| `gateway/infrastructure/usage-store.js` | **Zero imports** anywhere. Node.js usage tracking replaced by Rust `tracing` + SQLite dashboard. |
| `gateway/infrastructure/stdout-protocol.js` | **Zero imports** anywhere. Replaced by the binary `PCM1` framer in Rust. |
| `gateway/infrastructure/retry.js` | **Zero imports** from any active file. `provider-manager.js` implements its own inline retry logic without using this module. |
| `gateway/interfaces/ITranscriptCleaner.js` | **Zero imports** outside of itself. No cleaner implementation uses it. |
| `gateway/sidecar.js` line 105 (commented block) | Dead comment `// semanticBuffer.accept(...)` — remove the entire comment, it's noise. |

> [!CAUTION]
> **Do NOT delete:** `gateway/infrastructure/text-similarity.js` — imported by `gateway/state/meeting-state.js` (still live).
> **Do NOT delete:** `gateway/interfaces/ITranscriptSanitizer.js` — referenced by `transcript-sanitizer.js` (still live).
> **Do NOT delete:** `gateway/infrastructure/logger.js` — imported by `sidecar.js` and other active files.
> **Do NOT delete:** `gateway/infrastructure/validate.js` — imported by `sidecar.js`.

---

## Workstream 1 — Rust: `ChunkState` Extension

### [NEW] `src-tauri/src/agents/domain/context_item.rs`
Pure domain value object — no I/O, no logic:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContextItem {
    pub text: String,
    pub match_confidence: f32,  // 0.0–1.0
    pub is_verbatim: bool,      // true if confidence > 0.90
    pub is_technical: bool,     // flagged by TechnicalAgent
    pub tags: Vec<String>,      // ["technical","risk","decision","action","clarification"]
}
```

### [MODIFY] `src-tauri/src/agents/domain/chunk_state.rs`
Add one field (additive, no breaking change):
```rust
pub context_items: Vec<ContextItem>,
```

### [MODIFY] `src-tauri/src/agents/agents/response_agent.rs`
Extend LLM prompt to return structured JSON including `context_items[]` with `match_confidence` per item.

### [MODIFY] `src-tauri/src/sidecar/event_router.rs`
Emit new `suggest_answer` event alongside existing `suggested_response`.

### [NEW] `src-tauri/src/commands/overlay.rs`
```rust
#[tauri::command] pub async fn show_toolbar(app: AppHandle) -> Result<(), String>
#[tauri::command] pub async fn hide_toolbar(app: AppHandle) -> Result<(), String>
#[tauri::command] pub async fn show_caption(app: AppHandle) -> Result<(), String>
#[tauri::command] pub async fn hide_caption(app: AppHandle) -> Result<(), String>
```

---

## Workstream 2 — TypeScript: Types & Event Bus

### [NEW] `src/types/suggest.ts`
```typescript
export interface ContextItem {
  text: string;
  match_confidence: number;
  is_verbatim: boolean;
  is_technical: boolean;
  tags: SuggestTag[];
}
export type SuggestTag = 'technical' | 'risk' | 'decision' | 'action' | 'clarification' | 'off-topic';
export interface SuggestCard { id: string; suggested_response: string; context_items: ContextItem[]; speaker: string; timestamp: string; feedback?: 'up' | 'down'; }
```

### [MODIFY] `src/types/index.ts` — re-export `suggest.ts`
### [MODIFY] `src/interfaces/IEventBus.ts` — add `onSuggestAnswer()`

---

## Workstream 3 — Tauri: 2 New Windows

### [MODIFY] `src-tauri/tauri.conf.json`
Add after `main` window:
```json
{ "label": "toolbar", "url": "index.html#/toolbar", "width": 480, "height": 52,
  "transparent": true, "decorations": false, "alwaysOnTop": true, "resizable": false, "visible": false },
{ "label": "caption", "url": "index.html#/caption", "width": 600, "height": 48,
  "transparent": true, "decorations": false, "alwaysOnTop": true, "resizable": false, "visible": false }
```

### [MODIFY] `src-tauri/src/lib.rs`
Apply `set_content_protected`, `set_always_on_top`, `make_overlay` to all three windows. Register overlay commands.

---

## Workstream 4 — React: Shared Design System

### [NEW] `src/design-system/tokens.ts`
```typescript
export const DS = {
  colors: {
    surface: 'rgba(20,20,28,0.88)',
    accent: '#5B6EF5',
    danger: '#EF4444',
    verbatimHighlight: 'rgba(99,230,182,0.18)',   // green — exact speaker match
    technicalHighlight: 'rgba(147,112,219,0.18)', // purple — technical content
  },
  radii: { pill: '9999px', card: '12px', chip: '6px' },
  blur: 'blur(20px)',
} as const;
```

### [NEW] `src/design-system/components/`
`Pill`, `IconButton`, `ShortcutBadge`, `StatusDot`, `TagChip`, `ThumbFeedback`, `Waveform` — each single-file, zero Tauri/business logic.

---

## Workstream 5 — Floating Toolbar Feature

### [NEW] `src/features/toolbar/`
```
FloatingToolbar.tsx      # Pure rendering — orchestrator only, zero logic
useToolbarState.ts       # All Tauri IPC + dispatch — zero JSX
ToolbarButton.tsx        # icon + label + ShortcutBadge
CaptureControls.tsx      # Screen dot + Mic dot + Record toggle
OverflowMenu.tsx         # ⋮ popover
DragHandle.tsx           # data-tauri-drag-region element
```

---

## Workstream 6 — Caption Strip Feature

### [NEW] `src/features/caption/`
```
CaptionStrip.tsx         # Root — collapsed pill
useCaptionState.ts       # Subscribes to transcript_partial + transcript_final
CaptionExpanded.tsx      # Full text + ⌘← ⌘→ navigation
WaveformIcon.tsx         # Animated equalizer bars
```

---

## Workstream 7 — Suggest Answers Feature

### [NEW] `src/features/suggest/`
```
SuggestAnswersPane.tsx      # New "Suggest" tab in main panel
useSuggestAnswers.ts        # Subscribes to suggest_answer — auto-fires, manually dismissible
SuggestCard.tsx             # Answer card with "Ready to say →" label
ContextBullet.tsx           # Bullet: green tint (verbatim) + purple border (technical) + confidence %
ConfidenceBadge.tsx         # 0–100% pill
SuggestLatestAllToggle.tsx  # Latest / All switch
```

**Tag → Agent mapping:**

| Tag | Source agent |
|---|---|
| `technical` | `TechnicalAgent` ran + item is_technical |
| `risk` | `RiskDetectorAgent` produced output |
| `decision` | `AnalystAgent` produced a decision |
| `action` | `AnalystAgent` produced an action item |
| `clarification` | `ExplanationAgent` only (Low complexity) |
| `off-topic` | `is_chit_chat: true` on chunk |

---

## Workstream 8 — Keyboard Shortcut System

### [NEW] `src/features/shortcuts/`
```
defaultShortcuts.ts     # Pure data — zero imports
ShortcutStore.ts        # tauri-plugin-store ISP wrapper: get/set/subscribe only
useShortcuts.ts         # Hook: provides shortcut map
ShortcutSettings.tsx    # Remappable settings UI
```

Default macOS shortcuts:
```
Answer:        ⌘↵      Screenshot: ⌘⇧↵
Chat:          ⌘⇧⌫    Toggle:     ⌥Space
Push-to-talk:  Space   Hide:       ⌘\
Caption next:  ⌘→      Caption prev: ⌘←
```

---

## Execution Order

```
Step 1:  Delete dead code (7 files/dirs confirmed above)
Step 2:  Add context_item.rs + extend chunk_state.rs  (Rust, additive)
Step 3:  Extend response_agent.rs LLM prompt + event_router.rs emit
Step 4:  Add 2 windows to tauri.conf.json + lib.rs setup
Step 5:  Add react-router hash routes to main.tsx
Step 6:  Build design-system tokens + 7 atomic components
Step 7:  Build Floating Toolbar feature folder
Step 8:  Build Caption Strip feature folder
Step 9:  Build Suggest Answers feature folder
Step 10: Build Shortcut system + Settings UI
Step 11: cargo check + tsc --noEmit  (verify no regressions)
```

---

## SOLID at a Glance

| Principle | Enforcement |
|---|---|
| **S** | Each hook/file has one job. `useSuggestAnswers` = card list only. `ContextBullet` = one bullet only. |
| **O** | Toolbar buttons added via props. New agent tags added to union type. Neither requires modifying existing files. |
| **L** | `onSuggestAnswer` follows same `Promise<UnsubscribeFn>` contract as all IEventBus methods. |
| **I** | `IShortcutStore` exposes only `get/set/subscribe`. `IEventBus` adds only `onSuggestAnswer`. |
| **D** | Components depend on `IEventBus`/`IShortcutStore` interfaces — never on Tauri directly. Fully testable. |
