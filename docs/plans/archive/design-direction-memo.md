# Roxi — Design Direction Memo

**Scope:** main window · toolbar · caption overlay
**Direction:** Apple-like / native materials
**Status:** ready for Figma generation
**Prepared:** 2026-09-04

## Thesis

Roxi already has the right bones — real glass materials, a dark listening surface, a floating toolbar and caption overlay that behave like macOS system chrome. The gap to Big-Four-grade polish isn't a new visual language, it's **restraint and precision**: one accent instead of four competing ones, a real type scale instead of ad hoc pixel sizes, and a single motion motif that ties all three windows together.

---

## 1. Color — one accent, not four

Today's tokens spread purple, blue, green and amber across buttons, focus rings and status dots at once. The redesign keeps the semantic tag colors (they carry real meaning: decision, risk, technical) but narrows every *interactive* surface — CTAs, the live indicator, focus states — to one accent.

| Token | Hex | Role |
|---|---|---|
| `ink` | `#0A0A0C` | app / window background |
| `panel` | `#111318` | raised material, session shell |
| `panel-raised` | `#17171D` | elevated card surface |
| `hairline` | `#232329` | borders, dividers — barely visible |
| `hairline-soft` | `#1B1B20` | inner dividers within cards |
| `paper` | `#F5F5F7` | primary text |
| `mute` | `#9A9AA4` | secondary text |
| `mute-dim` | `#6F6F79` | tertiary text / mono labels |
| `signal` | `#7C74F2` | **the one accent** — CTA, live state, focus |
| `signal-dim` | `rgba(124,116,242,0.14)` | accent wash / selection background |
| `signal-line` | `rgba(124,116,242,0.35)` | accent-tinted borders/rings |
| `decision` | `#34D399` | semantic tag only — unchanged |
| `risk` | `#F2B13D` | semantic tag only — unchanged |
| `technical` | `#A78BFA` | semantic tag only — unchanged |

**Radius scale:** chip `8px` · card `14px` · panel `20px` · shell `24px` · pill `999px`
**Spacing scale:** `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64px`
**Motion easing:** `cubic-bezier(.2,.8,.2,1)` ("calm") — used for every transition in the system.

---

## 2. Type — a real scale, system-native

Headings and body both fall back through `-apple-system` first, so on macOS this renders true SF Pro and SF Mono — no substitute font shipped to the one platform this app runs on. (Manrope / JetBrains Mono are the web-preview fallback only.)

| Size / weight | Usage | Sample |
|---|---|---|
| 28 / 700, display | Idle-screen headline | "Ready to capture your meeting" |
| 22 / 700, display | Section headings | — |
| 17 / 600, display | Tab labels | "Suggest · Ask · Listen" |
| 15 / 400, body | Body copy | "Press Start Capture to begin transcribing and interpreting your conversation in real time." |
| 13 / 500, mono | Timestamps, counters | "03:41 · 214 tok · $0.02" |
| 11 / 600, mono, uppercase, +0.08em | Section/category labels | "Decisions" |

---

## 3. Signature motif — the Signal Ring

The one element this redesign should be remembered by. A single ring motif, breathing at the pace of mic input, appears at three scales — so "Roxi is listening" reads identically whether you're looking at the toolbar, the caption bar, or the idle screen.

- **Micro (1×, toolbar):** the status dot becomes a 6px ring that opens into a thin halo when live, replacing the flat colored dot.
- **Meso (4×, caption):** the caption overlay's "Listening…" state gets the same halo behind the placeholder text instead of a plain opacity fade.
- **Macro (12×, idle screen):** the idle screen's waveform is rebuilt as this ring at full size, pulsing with real mic amplitude once permission is granted, ambient breathing before that.

Ring construction: a solid core circle (`signal`) with 2–3 concentric orbit rings (`signal-line` border, no fill), each breathing on a staggered delay (`0s / 0.3s / 0.6s`) between `opacity .35 → .9` and `scale .94 → 1`. Respect `prefers-reduced-motion` — disable the breathing animation entirely.

---

## 4. Layout — three windows, one system

Structural changes are deliberately small — this is a materials-and-precision pass, not a re-architecture.

**Main window** (420×780) — one accent on the active tab; semantic colors (`decision`/`risk`/`technical`) kept only on card content, never on chrome; timestamps set in mono. Structure top to bottom: title bar → segmented tab control (Suggest / Ask / Listen) → stacked content cards (each: colored label chip + 2–3 lines of body copy) → bottom status bar (session label + Signal Ring at 1×).

**Toolbar** (480×52) — pill-shaped floating bar. Signal Ring at 1× on the left, short status label next to it, two icon buttons on the right (mono/settings-style squares).

**Caption overlay** (600×48) — pill-shaped, click-through. Signal Ring halo (dim, 0.6 opacity) on the left, speaker label in accent color, transcript line in muted body text.

---

## 5. Component changes

| Component | Current | Change |
|---|---|---|
| `GlassCard` | Single blur layer, one border | Two-layer material — outer shell blur + inner content glass, matching macOS vibrancy stacking |
| `StatusDot` | Flat colored circle, CSS pulse | Replaced by the Signal Ring at 1× scale — ring, not fill |
| `Waveform` (idle) | Static decorative bars | Signal Ring at 12× scale, breathing ambient / amplitude-reactive once mic permission is live |
| `Badge` / `TagChip` | Correct semantics, inconsistent padding | Locked to the 8/14/20 radius scale and mono numerals where a count appears |
| `IconButton` | No visible hover/focus state | 120ms signal-tinted hover + visible focus ring for keyboard use |
| `AppShell` | Light idle surface vs. dark session shell, jump-cut between them | Shared `ink` background under both; idle screen becomes a dark-native "resting instrument" instead of a light card |

---

## 6. Rollout order (each phase depends on the last)

1. **Tokens & type** — land the narrowed color set and the `-apple-system` type scale in `src/design-system/tokens.ts`. Mechanical, low risk, touches no layout. *No visual regression expected.*
2. **Signal Ring + satellite windows** — toolbar and caption overlay are small surface area but the highest-visibility proof of direction; ship the ring motif here first. *Depends on 1.*
3. **Idle screen & session shell** — unify idle and live surfaces on the dark ground; rebuild the waveform at 12× scale; apply the two-layer `GlassCard` material across Suggest/Ask/Listen. *Depends on 1, 2.*
4. **Motion & accessibility pass** — standardize every transition on the calm easing curve, add visible keyboard focus throughout, verify `prefers-reduced-motion` disables the ring's breathing. *Depends on 1–3.*

---

## For Figma generation

Frames to produce, in order: **Idle screen · Session shell (Suggest/Ask/Listen tabs) · Toolbar · Caption overlay**, plus a component set for the six components in §5. Use the token table in §1 as Figma color styles, the type table in §2 as text styles, and the Signal Ring construction in §3 as a reusable component with the three named scale variants (Micro/Meso/Macro).
