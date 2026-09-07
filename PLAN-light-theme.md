# Implementation Plan — Light ("white") theme for the Roxi widget

> Scope: change the app's visual theme from dark to light. Written 2026-09-08 against the
> code at `43be9ea`. No behaviour, data or protocol changes — this is presentation only.

---

## 0. The one thing to decide before any code is written

This is **not** a palette swap. The widget is a transparent Tauri window whose readability
comes from a `backdrop-filter` recipe, and that recipe does not invert symmetrically.

Today (`src/shell/AppShell.tsx`):

```
background:       rgba(10,10,12, 0.35)      // dark layer, 65% see-through
backdrop-filter:  blur(32px) saturate(150%) brightness(0.25)
```

`brightness(0.25)` **darkens the backdrop before the shell composites over it**. That is what
makes light text readable over a bright desktop: white × 0.25 = mid-grey, which is dark enough
for `#F5F5F7` to sit on at 12.65:1.

**Multiplication toward zero works. Multiplication away from zero does not.** A light theme
needs the mirror trick — lighten the backdrop so dark text reads — but `brightness(k > 1)`
applied to a black desktop is still black:

```
brightness(1.6) applied to #000000  ->  #000000
brightness(2.5) applied to #000000  ->  #000000
```

So over a dark wallpaper there is no filter value that rescues a light theme. The only lever
left is the shell's own alpha, and that trades away the transparency the design is built on.

### What the numbers say

White shell at alpha, over a **pure black desktop** (the worst case for a light theme, exactly
as a white desktop is the worst case for the current dark one):

| `--glass-alpha` | See-through | ink `#1A1A1F` | mute `#5A5A66` | mute darkened to `#3A3A44` |
|---|---|---|---|---|
| 0.35 *(today's value)* | 65% | 2.48:1 ❌ | 1.03:1 ❌ | 1.61:1 ❌ |
| 0.50 | 50% | 4.36:1 ❌ | 1.71:1 ❌ | 2.83:1 ❌ |
| **0.65** | **35%** | **7.10:1 ✅** | 2.78:1 ❌ | **4.60:1 ✅** |
| 0.75 | 25% | 9.45:1 ✅ | 3.71:1 ❌ | 6.13:1 ✅ |
| 0.85 | 15% | 12.25:1 ✅ | 4.80:1 ✅ | 7.94:1 ✅ |

**Recommendation: `--glass-alpha: 0.65` plus a darkened text ramp.** That holds AA for both
body and muted text over any wallpaper, and keeps the widget visibly glassy at 35%
transmittance. It is about half as see-through as today. There is no setting that is both as
transparent as today *and* as readable; that trade is inherent, not a tuning failure.

> If the goal is "white and readable" rather than "white and glassy", `0.85` is the safe
> choice and most of the contrast work below disappears. If the goal is maximum
> transparency, `0.5` is possible but muted labels and timestamps stop meeting AA over dark
> wallpapers. **Confirm which of the three you want before Phase 2.**

---

## 1. What stays exactly as it is

The architecture already anticipated a re-skin, so most of the codebase needs no edits:

- **37 files import from `design-system/`** and consume token *names*, not values. Changing
  `tokens.ts` propagates to all of them for free.
- The **opacity budget rule** (`styles.css`) still holds verbatim — one transparent layer,
  interiors ≤ 0.06 alpha, transmittance multiplies. Only the *colour* of the interior overlay
  flips from white to black.
- `tagPalette.ts` remains the single source of tag colour; only its values move.
- No component logic, no hooks, no services, no Rust, no protocol.

The blast radius is genuinely small: **9 files** carry hard-coded colour, and **6 files** use
Tailwind colour utilities (8 occurrences total).

---

## 2. Phases

Each phase ends with `npm run lint` clean and the app launched over both a white and a black
desktop background. One commit per phase.

### Phase 1 — Make the theme addressable (no visual change)

Nothing in the codebase can currently express "the other theme". Before changing values,
give them somewhere to live.

- `styles.css`: keep every current value, but move the surface/ink/accent literals out of
  `tokens.ts` into CSS custom properties on `:root`, and have `tokens.ts` read them
  (`ink: 'var(--t-ink)'`, etc.).
- Why first: it makes Phase 2 a values-only diff, makes a future toggle a one-line class
  swap, and — importantly — makes this whole change **revertable by editing one block**.
- Acceptance: the app is pixel-identical to today. `git diff` shows no colour value changed.

**Commit:** `refactor(ui): route design tokens through CSS custom properties`

### Phase 2 — Invert the glass recipe

The load-bearing phase. `AppShell.tsx` + `styles.css` only.

| | Today | Light |
|---|---|---|
| Shell layer | `rgba(10,10,12, 0.35)` | `rgba(255,255,255, 0.65)` |
| Backdrop filter | `brightness(0.25)` | `brightness(1.35)` *(helps mid-tone wallpapers; a no-op on black, saturates on white)* |
| No-`backdrop-filter` fallback | `--glass-alpha: 0.88` | `0.95` |
| Shell border | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.10)` |
| Inset highlight | `inset 0 1px 0 rgba(255,255,255,0.06)` | `inset 0 1px 0 rgba(255,255,255,0.5)` *(a light shell's highlight is still white — it reads as a bevel)* |
| Drop shadow | `0 48px 96px rgba(0,0,0,0.75)` | `0 24px 64px rgba(0,0,0,0.28)` *(a heavy black shadow under a white shell reads as dirt)* |

Also rewrite the long comment block at the top of `styles.css`. It documents measured ratios
against a white desktop; every one of those numbers becomes wrong. Replace with the table
from §0 and state that **the worst case is now a dark desktop**.

**Commit:** `feat(ui): invert the glass recipe for a light shell`

### Phase 3 — Text ramp and interior surfaces

`tokens.ts` (via the Phase 1 variables):

| Token | Today | Light | Note |
|---|---|---|---|
| `ink` | `#0A0A0C` | `#FFFFFF` | The shell's base colour |
| `paper` | `#F5F5F7` | `#1A1A1F` | Primary text |
| `mute` | `#A5A5AF` | `#3A3A44` | **Must** be this dark — `#5A5A66` fails AA (2.78:1) |
| `muteDim` | `#6F6F79` | `#5A5A66` | Still below AA, as today. Pre-existing, documented |
| `panelRaised` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.035)` | Interior overlay flips to black |
| `overlay` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.055)` | |
| `hairline` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.12)` | |
| `hairlineSoft` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.07)` | |
| `sheet` | `rgba(19,19,27,0.72)` | `rgba(252,252,254,0.88)` | Modals need their own ground |
| `sheetInner` | `rgba(0,0,0,0.28)` | `rgba(0,0,0,0.05)` | |

Same file: `.glass-panel`, `.inner-glass`, `.emerald-highlight`, `.amethyst-highlight` and the
scrollbar thumb in `styles.css` all flip from white overlays to black.

**Commit:** `feat(ui): light text ramp and interior surfaces`

### Phase 4 — Accents, tags and speaker colours

Every saturated colour in the system was chosen for a dark ground and is too light for a white
one. All of these need re-picking against the new shell, not merely darkening by feel:

- `tokens.ts`: `signal` (`#7C74F2`), `decision` (`#34D399`), `risk` (`#F2B13D`),
  `technical` (`#A78BFA`) and their `*Bg` / `*Dim` / `*Line` variants.
  `#34D399` on a white shell is ≈1.6:1 — invisible. Expect to move roughly two Tailwind
  steps darker (e.g. `#34D399` → `#047857`, `#F2B13D` → `#B45309`, `#A78BFA` → `#6D28D9`).
- `tagPalette.ts`: the three hard-coded `rgba(...)` borders and the two
  `rgba(255,255,255,...)` neutrals.
- `utils/speakerColors.ts`: all five are Tailwind 400-level, designed for dark. Move to
  600-level (`#2563eb`, `#7c3aed`, `#0891b2`, `#059669`, `#ea580c`).
- The signal colour is used as a CTA *background* with light text on it — check that pairing
  survives, since darkening the accent while keeping white label text is the safe direction.

**Commit:** `feat(ui): re-derive accent, tag and speaker colours for a light ground`

### Phase 5 — The stragglers

The files that bypass the token system. Small, mechanical, but the theme looks broken until
they are done:

- Raw hex literals: `IconButton.tsx`, `StatusDot.tsx`, `icons.tsx`, `AnalysisPane.tsx`,
  `DescriptionField.tsx`, `ChatInput.tsx`, `HistoryPane.tsx`, `SuggestFilterToggle.tsx`,
  `RoxiLogo.tsx`, `StopButton.tsx`.
- Tailwind colour utilities (8 occurrences across 6 files): `text-white` ×3, `bg-white/10` ×2,
  `bg-white/5`, `border-white/20`, `bg-black/60`.
- Prefer replacing each with the matching token rather than swapping the literal — that is
  what stops the next theme change from needing a Phase 5 at all.

**Commit:** `feat(ui): move the last hard-coded colours onto tokens`

---

## 3. Verification

Contrast cannot be eyeballed on this design — the shell composites over an arbitrary desktop,
so a screenshot on one wallpaper proves nothing.

1. **Re-run the contrast model** for the final chosen values, over both `#000000` and
   `#FFFFFF` backdrops. Body text ≥ 4.5:1 and muted text ≥ 4.5:1 in *both* cases, or the
   value is not shippable.
2. **Launch over a black desktop and a white desktop.** These are the two worst cases and
   they now sit at opposite ends from where they used to.
3. Check the three surfaces that carry their own ground: `SpeakerRenameModal`,
   `MeetingDetailModal`, and `Tooltip`.
4. Check the live states, which are easy to forget: the recording pulse, `Waveform`,
   `SignalRing`, `StatusDot`, the cost-limit state, and the `ThinkingIndicator`.
5. `npm run lint`.

---

## 4. Cost and risk

| | |
|---|---|
| Effort | Roughly a day. Phases 1–3 are half of it; Phase 4 is judgement, not typing. |
| Risk | **Low blast radius, high visibility.** Nothing outside `src/` is touched, and no logic changes — but every screen changes at once, so a bad accent choice is obvious everywhere. |
| Reversibility | Total, after Phase 1: revert the `:root` block. |
| The real cost | **Transparency.** 65% see-through today → ~35%. This is the design consequence to accept up front, and it is why §0 asks you to pick a point on that curve first. |

---

## 5. If you want a toggle instead of a replacement

Everything above replaces dark with light. Supporting *both* is a superset, not a different
plan — Phase 1 already creates the seam:

- Add `darkMode: 'class'` to `tailwind.config.js` and a `data-theme` attribute on `<html>`.
- Phase 1's `:root` block becomes two blocks: `:root` (light) and `[data-theme="dark"]`.
- Every phase above then edits values inside those two blocks rather than replacing them.
- Plus: a persisted preference (`localStorage`), a control somewhere in `WidgetHeader`, and a
  decision about whether to follow the macOS system appearance.
- Cost: roughly +half a day on top, and every future colour decision has to be made twice.

**Recommendation: build the single light theme first.** Phase 1 makes the toggle cheap to add
later, and doing it now doubles the design work in Phase 4 — the phase that is judgement
rather than mechanics.

---

## 6. Open question — please answer before Phase 2

Which point on the transparency/readability curve do you want?

| | `--glass-alpha` | See-through | Muted text over a dark wallpaper |
|---|---|---|---|
| **Glassy** | 0.50 | 50% | Fails AA (1.71:1) — timestamps and hints get hard to read |
| **Balanced** *(recommended)* | 0.65 | 35% | AA (4.60:1) with the darkened ramp |
| **Readable** | 0.85 | 15% | AA comfortably (4.80:1), but barely reads as glass |

Everything else in this plan is unchanged by the answer; only the numbers in Phase 2 and the
`mute` value in Phase 3 depend on it.
