# Roxi — Full Frontend UI/UX Deep Architecture

## Target UI — Visual Reference

![Roxi UI Mockup](/Users/manthan/.gemini/antigravity-ide/brain/d6b1fa9f-5bed-452c-8bc1-5df381a2d06b/roxi_ui_mockup_1788352410164.jpg)

> This image is the **single source of truth** for every component, color, spacing, and interaction in this plan. Every component spec below maps directly to what you see here.

---

## What This Does
**Full replacement** of the current light-glass frontend with the exact dark-glass UI from the screenshot.  
Every existing `*.tsx` / `*.ts` / `*.css` UI file is either **deleted** or **rewritten from scratch**. Zero old code survives. Every file has one job. Every dependency flows inward through interfaces.

---

## Phase 0 — FULL DELETION (Do This First)

Run this command to wipe the entire current UI layer before writing a single new line:

```bash
# Wipe all UI source files (keeps interfaces, services, types, constants — rewrites everything else)
rm -rf src/App.tsx \
       src/styles.css \
       src/components/Shared.tsx \
       src/components/TabBar.tsx \
       src/components/Overlays.tsx \
       src/design-system/components/IconButton.tsx \
       src/design-system/components/Pill.tsx \
       src/design-system/components/ShortcutBadge.tsx \
       src/design-system/components/StatusDot.tsx \
       src/design-system/components/TagChip.tsx \
       src/design-system/components/ThumbFeedback.tsx \
       src/design-system/components/Waveform.tsx \
       src/design-system/tokens.ts \
       src/features/analysis/InterpretationPane.tsx \
       src/features/analysis/RepliesPane.tsx \
       src/features/analysis/useAnalysis.ts \
       src/features/caption/CaptionExpanded.tsx \
       src/features/caption/CaptionRoot.tsx \
       src/features/caption/CaptionStrip.tsx \
       src/features/caption/WaveformIcon.tsx \
       src/features/caption/useCaptionState.ts \
       src/features/capture/ContextModal.tsx \
       src/features/capture/TopBar.tsx \
       src/features/capture/useCaptureSession.ts \
       src/features/chat/ChatPanel.tsx \
       src/features/chat/useChat.ts \
       src/features/history/HistoryView.tsx \
       src/features/history/useHistory.ts \
       src/features/onboarding/BlackHoleModal.tsx \
       src/features/shortcuts/ShortcutSettings.tsx \
       src/features/shortcuts/ShortcutStore.ts \
       src/features/shortcuts/defaultShortcuts.ts \
       src/features/shortcuts/useGlobalShortcuts.ts \
       src/features/shortcuts/useShortcuts.ts \
       src/features/suggest/ConfidenceBadge.tsx \
       src/features/suggest/ContextBullet.tsx \
       src/features/suggest/FollowUpChips.tsx \
       src/features/suggest/SuggestAnswersPane.tsx \
       src/features/suggest/SuggestCard.tsx \
       src/features/suggest/SuggestLatestAllToggle.tsx \
       src/features/suggest/useSuggestAnswers.ts \
       src/features/toolbar/CaptureControls.tsx \
       src/features/toolbar/DragHandle.tsx \
       src/features/toolbar/FloatingToolbar.tsx \
       src/features/toolbar/OverflowMenu.tsx \
       src/features/toolbar/ToolbarButton.tsx \
       src/features/toolbar/ToolbarRoot.tsx \
       src/features/toolbar/useToolbarState.ts \
       src/features/transcript/SpeakerRenameModal.tsx \
       src/features/transcript/TranscriptPane.tsx \
       src/features/transcript/useTranscript.ts
```

### Files Kept (NOT deleted — will be extended, not rewritten)

| File | Reason kept |
|---|---|
| `src/main.tsx` | Only adding HashRouter — 5 line change |
| `src/interfaces/IEventBus.ts` | Contract — only add `onSuggestAnswer` |
| `src/interfaces/ICaptureService.ts` | No change |
| `src/interfaces/IChatService.ts` | No change |
| `src/interfaces/IHistoryRepository.ts` | No change |
| `src/interfaces/IShortcutStore.ts` | No change |
| `src/interfaces/ISpeakerRepository.ts` | No change |
| `src/services/TauriEventBus.ts` | Add `onSuggestAnswer` method only |
| `src/services/TauriCaptureService.ts` | No change |
| `src/services/TauriChatService.ts` | No change |
| `src/services/TauriHistoryRepository.ts` | No change |
| `src/services/SpeakerRepository.ts` | No change |
| `src/context/ServicesContext.ts` | No change |
| `src/context/ServicesProvider.tsx` | No change |
| `src/constants/index.ts` | No change |
| `src/hooks/useSpeakerMap.ts` | No change |
| `src/hooks/useTauriEvents.ts` | No change |
| `src/types/index.ts` | Add suggest exports |
| `src/types/suggest.ts` | Already has new types |

### Old vs New File Map

| Old File (deleted) | New File (written from scratch) |
|---|---|
| `components/Shared.tsx` | `components/RoxiLogo.tsx` + atoms moved to `design-system/` |
| `components/TabBar.tsx` | `components/TabBar.tsx` — full dark rewrite |
| `components/Overlays.tsx` | `components/Overlays.tsx` — full dark rewrite |
| `design-system/tokens.ts` | `design-system/tokens.ts` — dark tokens |
| `design-system/components/TagChip.tsx` | Same name — colour map rewritten |
| `design-system/components/*.tsx` (7 files) | Same names — dark style rewrite |
| `features/suggest/SuggestCard.tsx` | Exploded into `SuggestCard.tsx` + `SuggestCard.parts.tsx` |
| `features/suggest/SuggestLatestAllToggle.tsx` | Renamed `LatestAllToggle.tsx` |
| `features/suggest/FollowUpChips.tsx` | Stays, full rewrite |
| `features/suggest/ContextBullet.tsx` | Full rewrite to match screenshot exactly |
| `features/suggest/useSuggestAnswers.ts` | Full rewrite |
| `features/suggest/SuggestAnswersPane.tsx` | Full rewrite + adds `InputBar.tsx` + `ScreenContextChip.tsx` + `EmptySuggestState.tsx` |
| `features/capture/TopBar.tsx` | Rewrite dark + extract to `TopBar.parts.tsx` |
| `features/transcript/TranscriptPane.tsx` | Rewrite dark + extract `TranscriptLine.tsx` |
| `features/analysis/InterpretationPane.tsx` | Rewrite dark |
| `features/analysis/RepliesPane.tsx` | **DELETED permanently** (replaced by Suggest tab) |
| `features/chat/ChatPanel.tsx` | Rewrite dark — extract `MessageBubble.tsx` + `SourceCard.tsx` |
| `features/history/HistoryView.tsx` | Rewrite dark — extract `MeetingList.tsx` + `MeetingDetail.tsx` |
| `features/toolbar/*` | All 7 files full dark rewrite |
| `features/caption/*` | All 5 files full dark rewrite |
| `App.tsx` | Full rewrite — wires all new components |
| `styles.css` | Full rewrite — dark token CSS vars + new keyframes |

---

## Design Tokens (from screenshot analysis)

```
Background:   #0D0E14 (near-black)
Card bg:      #16171F (surface-1)
Card border:  rgba(255,255,255,0.06)
Header bg:    #12131A
Tab active:   white, underline accent
Tab inactive: rgba(255,255,255,0.4)
Accent blue:  #5B6EF5   (tab underline, "Ready to say" chip)
Green:        #22C55E   (verbatim bullet dot + legend)
Purple:       #9B6EF5   (technical border + bullet dot)
Amber:        #F59E0B   (risk tag)
Red:          #EF4444   (danger)

Font:         Inter (all UI) + DM Mono (timestamps, labels)
Border-r:     14px cards, 9999px pills/chips, 8px small chips
```

---

## Folder Structure After Replacement

```
src/
├── main.tsx                         # Entry + providers + HashRouter routes
├── App.tsx                          # Main window shell (tabs + modals)
├── styles.css                       # Global tokens, keyframes, utilities
│
├── design-system/                   # Pure visual atoms — NO business logic
│   ├── tokens.ts                    # Typed CSS token map
│   ├── keyframes.css                # All @keyframes only
│   └── components/
│       ├── Badge.tsx                # Status/tag badge (ok|warn|error|live|neutral)
│       ├── GlassCard.tsx            # Base dark card wrapper
│       ├── IconButton.tsx           # 32x32 icon button with active state
│       ├── Pill.tsx                 # Dark glass pill container
│       ├── ShortcutBadge.tsx        # ⌘K monospace badge
│       ├── StatusDot.tsx            # Pulsing live/connecting/offline dot
│       ├── TagChip.tsx              # technical|decision|risk|action|clarification chip
│       ├── ThumbFeedback.tsx        # 👍 👎 pair
│       ├── Tooltip.tsx              # Dark floating tooltip
│       └── Waveform.tsx             # Animated equalizer bars
│
├── components/                      # App-level shell (no feature logic)
│   ├── TabBar.tsx                   # Ask | Listen | Suggest tabs
│   ├── Overlays.tsx                 # ConnectingOverlay, ErrorOverlay
│   └── RoxiLogo.tsx                 # ✦ Roxi logo + wordmark
│
├── types/                           # Pure TypeScript — no imports
│   ├── index.ts                     # Re-exports all types
│   ├── core.ts                      # Status, Significance, TxLine, SCard, TCard, RCard
│   └── suggest.ts                   # ContextItem, SuggestTag, SuggestCardData
│
├── interfaces/                      # Contracts only — no implementations
│   ├── IEventBus.ts
│   ├── ICaptureService.ts
│   ├── IChatService.ts
│   └── ISpeakerRepo.ts
│
├── services/                        # Tauri adapter implementations
│   ├── TauriEventBus.ts
│   ├── TauriCaptureService.ts
│   └── TauriChatService.ts
│
├── context/
│   ├── ServicesContext.ts           # React context type
│   └── ServicesProvider.tsx         # Wires concrete services
│
├── constants/
│   └── index.ts                     # SPEAKER_COLORS, SIG_CONFIG
│
├── hooks/
│   └── useSpeakerMap.ts
│
└── features/
    ├── capture/
    │   ├── TopBar.tsx               # Header bar — pure rendering
    │   ├── TopBar.parts.tsx         # StatusPill, BillingBadge, WindowControls, ApiHealthStrip
    │   ├── ContextModal.tsx         # Start capture modal
    │   ├── IdleScreen.tsx           # "Ready to capture" empty state
    │   └── useCaptureSession.ts     # Start/stop logic only
    │
    ├── transcript/
    │   ├── TranscriptPane.tsx       # Container + scroll controller
    │   ├── TranscriptLine.tsx       # Single utterance row (memoized)
    │   ├── SpeakerRenameModal.tsx   # Speaker name editing
    │   └── useTranscript.ts         # Subscribes to transcript events
    │
    ├── suggest/                     # PRIMARY FEATURE — matches screenshot
    │   ├── SuggestAnswersPane.tsx   # Tab root: section header + Latest/All toggle + card list
    │   ├── SuggestCard.tsx          # Full answer card
    │   ├── SuggestCard.parts.tsx    # ReadyToSayLabel, CardHeader, CardFooter, FollowUpChips
    │   ├── ContextSection.tsx       # "Context ⓘ" collapsible rail
    │   ├── ContextBullet.tsx        # Single bullet row (green/purple/neutral)
    │   ├── LatestAllToggle.tsx      # Latest | All switch
    │   ├── InputBar.tsx             # "Ask anything..." text input + screen chip
    │   ├── ScreenContextChip.tsx    # "Your screen · Use image ✕" chip
    │   ├── EmptySuggestState.tsx    # "AI is listening..." idle
    │   └── useSuggestAnswers.ts     # Subscribes to suggest_answer, manages card list
    │
    ├── analysis/
    │   ├── InterpretationPane.tsx   # Ask tab: summaries + technical
    │   └── useAnalysis.ts           # Subscribes to analysis events
    │
    ├── chat/
    │   ├── ChatPanel.tsx            # Slide-in drawer shell
    │   ├── MessageBubble.tsx        # User/AI bubble (memoized)
    │   ├── SourceCard.tsx           # Meeting citation card
    │   └── useChat.ts               # Chat session logic
    │
    ├── history/
    │   ├── HistoryView.tsx          # Full-screen slide-in panel
    │   ├── MeetingList.tsx          # Left column: meeting rows
    │   ├── MeetingDetail.tsx        # Right column: selected meeting
    │   └── useHistory.ts
    │
    ├── onboarding/
    │   └── BlackHoleModal.tsx       # BlackHole setup guide
    │
    ├── shortcuts/
    │   ├── useGlobalShortcuts.ts    # OS-level shortcut registration
    │   ├── ShortcutSettings.tsx     # Settings modal
    │   └── defaultShortcuts.ts      # Pure data
    │
    ├── toolbar/                     # Separate Tauri window (#/toolbar)
    │   ├── ToolbarRoot.tsx          # Window root
    │   ├── FloatingToolbar.tsx      # Pill orchestrator
    │   ├── DragHandle.tsx
    │   ├── CaptureControls.tsx
    │   ├── ToolbarButton.tsx
    │   ├── OverflowMenu.tsx
    │   └── useToolbarState.ts
    │
    └── caption/                     # Separate Tauri window (#/caption)
        ├── CaptionRoot.tsx          # Window root
        ├── CaptionStrip.tsx         # Collapsed pill
        ├── CaptionExpanded.tsx      # Expanded utterance view
        ├── WaveformIcon.tsx
        └── useCaptionState.ts
```

---

## Screen-by-Screen Spec (annotated from reference image)

![Roxi UI Mockup — annotated](/Users/manthan/.gemini/antigravity-ide/brain/d6b1fa9f-5bed-452c-8bc1-5df381a2d06b/roxi_ui_mockup_1788352410164.jpg)

### Zone 1 — Header Bar (top strip, bg `#12131A`)
```
[✦ Roxi]   [Ask]  [Listen]  [Suggest*]         [● Live]  [🕑]  [⚙]
```
- Background: `#12131A`
- Logo: `✦ Roxi` in white (bold), star in `#5B6EF5`  
- Tabs: inactive = `rgba(255,255,255,0.4)`, active = white + bold + `#5B6EF5` underline 2px
- Right cluster: `● Live` green pill, History icon, Settings icon

### Main Window — Suggest Tab Body
```
SUGGEST ANSWERS                            [Latest] [All]
┌─────────────────────────────────────────────────────┐
│  Ready to say →                                      │
│                                                      │
│  The Q3 migration should be scoped to the            │
│  authentication service first, then the data         │
│  layer — that gives us a stable rollback point.      │
│                                                      │
│  👍  👎                              2:14 PM        │
│                                                      │
│  Context ⓘ                                          │
│  ● Q3 deadline is September 30th    97% [decision]  │
│  ╷ authentication service rollback  84% [technical] │
│  ● We agreed to scope migrations    71% [clarif.]   │
│      incrementally                                   │
│                                                      │
│  ● Verbatim match  ● Technical content              │
└─────────────────────────────────────────────────────┘
Tags    [technical] [decision] [risk]
Follow-ups  [Make it shorter] [More formal] [+ Custom]

[Ask anything or paste a screenshot...          ➤]
[Your screen · Use image ✕]
```

---

## Pixel-Perfect Component Specs

### `SuggestCard.tsx`
```
bg: #16171F
border: 1px solid rgba(255,255,255,0.06)
border-radius: 14px
padding: 20px
animation: card-enter 0.28s cubic-bezier(0.16,1,0.3,1)
```

### `ReadyToSayLabel` (inside SuggestCard)
```
bg: rgba(91,110,245,0.2)
color: #5B6EF5
border: 1px solid rgba(91,110,245,0.3)
border-radius: 8px
padding: 4px 10px
font-size: 12px
text: "Ready to say →"
```

### `ContextBullet` — Verbatim (green)
```
bullet dot: #22C55E
bg: rgba(34,197,94,0.08)
border-left: none
confidence badge: "97%" right-aligned, rgba(255,255,255,0.5)
tag: [decision] blue chip
```

### `ContextBullet` — Technical (purple)
```
bullet dot: #9B6EF5
border-left: 3px solid rgba(155,110,245,0.5)
bg: rgba(155,110,245,0.06)
confidence badge: "84%"
tag: [technical] purple chip
```

### `TagChip` colour map
```
technical:    bg rgba(155,110,245,0.2), border rgba(155,110,245,0.4), text #9B6EF5
decision:     bg rgba(91,110,245,0.2),  border rgba(91,110,245,0.4),  text #5B8DEF
risk:         bg rgba(245,158,11,0.2),  border rgba(245,158,11,0.4),  text #F59E0B
action:       bg rgba(239,68,68,0.2),   border rgba(239,68,68,0.4),   text #EF4444
clarification:bg rgba(255,255,255,0.08),border rgba(255,255,255,0.15),text rgba(255,255,255,0.6)
```

### `FollowUpChip`
```
bg: rgba(255,255,255,0.08)
border: 1px solid rgba(255,255,255,0.12)
border-radius: 9999px
padding: 6px 14px
text: 13px white
hover: bg rgba(255,255,255,0.15)
```

### `InputBar`
```
bg: rgba(255,255,255,0.05)
border: 1px solid rgba(255,255,255,0.1)
border-radius: 10px
padding: 12px 16px
placeholder: rgba(255,255,255,0.3)
send button: ➤ accent-blue on dark bg
```

### `ScreenContextChip`
```
bg: rgba(255,255,255,0.08)
border-radius: 9999px
text: "Your screen · Use image ✕"
dismiss: ✕ on right
```

### `LatestAllToggle`
```
wrapper bg: rgba(255,255,255,0.06), border-radius: 9999px
active pill: rgba(255,255,255,0.15), text white
inactive: text rgba(255,255,255,0.4)
```

### `TabBar`
```
height: 44px
bg: #12131A
border-bottom: 1px solid rgba(255,255,255,0.06)
active underline: 2px solid #5B6EF5, border-radius 1px
active text: white 600 weight
inactive text: rgba(255,255,255,0.4)
gap between tabs: 32px
```

---

## Keyframes to Add

```css
@keyframes card-enter {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes new-badge-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}

@keyframes typing-dot {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40%           { transform: scale(1);   opacity: 1;   }
}

@keyframes waveform-bar {
  0%, 100% { height: 4px; }
  50%      { height: 16px; }
}
```

---

## SOLID Enforcement

| Principle | Rule |
|---|---|
| **S — Single Responsibility** | `SuggestCard.tsx` renders one card. `useSuggestAnswers.ts` manages card list. `InputBar.tsx` handles one input. Never combined. |
| **O — Open/Closed** | New tags → add to `SuggestTag` union + `TagChip` color map. No other file changes. New follow-up chips → array in `SuggestCard.parts`. |
| **L — Liskov** | Every `onX` in `IEventBus` returns `Promise<UnsubscribeFn>`. New events follow same contract. |
| **I — Interface Segregation** | `IEventBus` split from `ICaptureService` from `IChatService`. Components import only what they need. |
| **D — Dependency Inversion** | `useSuggestAnswers` depends on `ServicesContext → IEventBus`, not on `TauriEventBus` directly. Fully testable. |

---

## Execution Order

| Step | Files | What happens |
|---|---|---|
| 1 | `styles.css` | Token overhaul + new keyframes |
| 2 | `design-system/tokens.ts` + `components/*` | 10 atomic components rebuilt dark |
| 3 | `types/core.ts` + `types/suggest.ts` | Clean type layer |
| 4 | `components/TabBar.tsx`, `RoxiLogo.tsx`, `Overlays.tsx` | Dark shell |
| 5 | `features/capture/TopBar.tsx` + parts | Dark header |
| 6 | `features/capture/IdleScreen.tsx` + `ContextModal.tsx` | Start screen |
| 7 | `features/suggest/*` (9 files) | **Primary feature — full screenshot match** |
| 8 | `features/transcript/*` | Dark transcript pane |
| 9 | `features/analysis/InterpretationPane.tsx` | Dark analysis pane |
| 10 | `features/chat/*` (4 files) | Dark chat drawer |
| 11 | `features/history/*` | Dark history panel |
| 12 | `features/toolbar/*` | Floating toolbar window |
| 13 | `features/caption/*` | Caption strip window |
| 14 | `App.tsx` | Wire all tabs + modals |
| 15 | `tsc --noEmit` | Zero error verification |
