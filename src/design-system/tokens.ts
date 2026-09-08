/**
 * Design tokens — the vocabulary components use to talk about colour.
 *
 * Every value here resolves to a CSS custom property declared in `styles.css`.
 * That indirection is the point: components depend on a token NAME, the name
 * depends on a variable, and only the variable holds a literal. Re-theming is
 * therefore an edit to one block of `styles.css` and nothing else — no
 * component, hook or feature folder is touched.
 *
 * Two rules keep it that way:
 *   1. Never put a colour literal in a component. Add a token instead.
 *   2. Never derive a colour from another colour in a component (string
 *      concatenation, alpha suffixes). `var()` cannot be manipulated as text,
 *      and a component that computes colour has silently taken on design
 *      authority. Add the derived value as its own token — see `signalFocus`.
 */
export const tokens = {
  /**
   * Surfaces.
   *
   * The shell (AppShell) is the ONLY layer that carries transparency. Interior
   * surfaces are transparent or an overlay at <= 0.06 alpha, because
   * transmittance multiplies — see the opacity budget in styles.css. Depth is
   * carried by hairlines and shadows, not by opacity.
   */
  ink: 'var(--t-ink)',
  /**
   * The shell recipe. Composed in styles.css, not here and not in AppShell:
   * the background, the backdrop filter and the shadow have to change together
   * or the glass stops being legible, so they belong in one place next to the
   * contrast measurements that justify them.
   */
  shell: 'var(--t-shell)',
  shellBackdrop: 'var(--t-shell-backdrop)',
  shellShadow: 'var(--t-shell-shadow)',
  panel: 'var(--t-panel)',
  panelRaised: 'var(--t-panel-raised)',
  /** One step stronger, for a control sitting on top of panelRaised. */
  overlay: 'var(--t-overlay)',
  hairline: 'var(--t-hairline)',
  hairlineSoft: 'var(--t-hairline-soft)',

  /**
   * Sheets sit OVER the glass (modals, tooltips), so they cannot derive from
   * --glass-alpha: they need their own readable ground or the text behind
   * them shows through.
   */
  sheet: 'var(--t-sheet)',
  sheetInner: 'var(--t-sheet-inner)',

  /** Text stays fully opaque — none of the above applies to these. */
  paper: 'var(--t-paper)',
  mute: 'var(--t-mute)',
  /** Micro-copy (timestamps, hints). Contrast is documented in styles.css. */
  muteDim: 'var(--t-mute-dim)',

  /** The one interactive accent — CTA, live state, focus. */
  signal: 'var(--t-signal)',
  signalDim: 'var(--t-signal-dim)',
  signalLine: 'var(--t-signal-line)',
  /** The focus ring. Its own token because a component must not build it. */
  signalFocus: 'var(--t-signal-focus)',

  /** Semantic tag colors — meaning-carrying, kept off interactive chrome. */
  decision: 'var(--t-decision)',
  decisionBg: 'var(--t-decision-bg)',
  decisionLine: 'var(--t-decision-line)',
  risk: 'var(--t-risk)',
  riskBg: 'var(--t-risk-bg)',
  riskLine: 'var(--t-risk-line)',
  technical: 'var(--t-technical)',
  technicalBg: 'var(--t-technical-bg)',
  technicalLine: 'var(--t-technical-line)',
  
  bulletBestBg: 'var(--t-bullet-best-bg)',
  bulletBestDot: 'var(--t-bullet-best-dot)',

  /** Interaction chrome — focus, hover, and the dim behind a modal. */
  focusRing: 'var(--t-focus-ring)',
  overlayHover: 'var(--t-overlay-hover)',
  scrim: 'var(--t-scrim)',

  /** Destructive / stop. */
  danger: 'var(--t-danger)',
  dangerBg: 'var(--t-danger-bg)',
  dangerBgHover: 'var(--t-danger-bg-hover)',

  /** A raised card with its own ground (GlassCard, modal bodies). */
  card: 'var(--t-card)',
  cardSheen: 'var(--t-card-sheen)',
  cardInset: 'var(--t-card-inset)',
  sheetShadow: 'var(--t-sheet-shadow)',
  sheetShadowUp: 'var(--t-sheet-shadow-up)',

  /** Fallback accent for a tag the UI has no styling for. */
  neutralBg: 'var(--t-neutral-bg)',
  neutralLine: 'var(--t-neutral-line)',
} as const;

export const radius = {
  chip: 8,
  card: 14,
  panel: 20,
  shell: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const easing = {
  calm: 'cubic-bezier(.2,.8,.2,1)',
} as const;
