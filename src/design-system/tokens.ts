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
   * Code surfaces inside a rendered answer. Inline and block are separate
   * grounds because they do different jobs: inline has to interrupt a
   * sentence without breaking its rhythm, block has to read as a slab you
   * can copy out of.
   */
  codeBg: 'var(--t-code-bg)',
  codeLine: 'var(--t-code-line)',
  codeBlock: 'var(--t-code-block)',
  codeHead: 'var(--t-code-head)',

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

  /**
   * The user's own chat turn. Four tokens rather than one because a glass
   * surface is a recipe, not a colour: tint, edge, gloss and thickness have
   * to change together or it stops reading as one material. Composing them
   * in the component would be exactly the "derive a colour in a component"
   * mistake this file's header warns about.
   */
  bubbleUser: 'var(--t-bubble-user)',
  bubbleUserLine: 'var(--t-bubble-user-line)',
  bubbleUserSheen: 'var(--t-bubble-user-sheen)',
  bubbleUserBevel: 'var(--t-bubble-user-bevel)',

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

  /** Primary button recipe: hover step, depth, and the text on the fill. */
  signalStrong: 'var(--t-signal-strong)',
  signalBevel: 'var(--t-signal-bevel)',
  onSignal: 'var(--t-on-signal)',
} as const;

/**
 * The sign-in brand panel — the only dark, opaque surface, shown before the
 * app opens. Kept apart from `tokens` so nothing inside the app reaches for
 * a dark-ground colour by accident.
 */
export const brandTokens = {
  ink: 'var(--t-brand-ink)',
  text: 'var(--t-brand-text)',
  textMute: 'var(--t-brand-text-mute)',
  textDim: 'var(--t-brand-text-dim)',
  accent: 'var(--t-brand-accent)',
  surface: 'var(--t-brand-surface)',
  line: 'var(--t-brand-line)',
  orbit: 'var(--t-brand-orbit)',
  live: 'var(--t-brand-live)',
  meaning: 'var(--t-brand-meaning)',
  meaningBg: 'var(--t-brand-meaning-bg)',
  action: 'var(--t-brand-action)',
  actionBg: 'var(--t-brand-action-bg)',
  risk: 'var(--t-brand-risk)',
  riskBg: 'var(--t-brand-risk-bg)',
  markBevel: 'var(--t-brand-mark-bevel)',
  markTop: 'var(--t-brand-mark-top)',
  markBottom: 'var(--t-brand-mark-bottom)',
} as const;

export const radius = {
  chip: 8,
  /** Text fields and buttons on the sign-in screens. */
  control: 10,
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

/**
 * Type scale — every text size in the app should resolve to one of these
 * steps instead of a one-off `text-[Npx]`. Each step is derived from a size
 * already in use (26-28px -> display, 20px -> title, 13-15px -> body/label,
 * 9-12px -> caption/micro) so adopting it is a rename, not a redesign — the
 * new part is pairing every size with a considered line-height and tracking
 * instead of leaving those to the browser default.
 */
export const typeScale = {
  display:    { fontSize: 28, lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.02em' },
  title:      { fontSize: 20, lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.01em' },
  headline:   { fontSize: 16, lineHeight: 1.4,  fontWeight: 600, letterSpacing: '-0.005em' },
  body:       { fontSize: 14, lineHeight: 1.55, fontWeight: 400, letterSpacing: '0em' },
  bodyStrong: { fontSize: 14, lineHeight: 1.55, fontWeight: 600, letterSpacing: '0em' },
  label:      { fontSize: 13, lineHeight: 1.4,  fontWeight: 600, letterSpacing: '0em' },
  caption:    { fontSize: 12, lineHeight: 1.4,  fontWeight: 500, letterSpacing: '0.01em' },
  micro:      { fontSize: 11, lineHeight: 1.35, fontWeight: 600, letterSpacing: '0.04em' },
} as const;

/**
 * The one deliberate departure from the system sans — reserved for a single
 * "this is the best one" accent (SuggestCard's best-pick bullet). Never used
 * for a structural heading; that would dilute it into a second body face.
 */
export const signatureSerif = '"New York", "Georgia", ui-serif, serif';

/**
 * Headline face for the screens shown BEFORE the app opens (sign-in, sign-up,
 * the brand panel). Same native stack as `signatureSerif`, but a separate
 * name so the rule above still holds inside the app: no serif headings there.
 * New York ships with macOS, so nothing is fetched at launch.
 */
export const authDisplaySerif = signatureSerif;

/**
 * Elevation ladder. A raised surface picks one of these instead of writing
 * its own one-off `boxShadow`. Built from the shadow tokens already measured
 * for contrast in styles.css — this adds no new colour, just a shared vocabulary
 * for "how raised is this" and a hover step so interactive surfaces can lift.
 */
export const elevation = {
  flat: 'none',
  raised: tokens.cardInset,
  raisedHover: `${tokens.cardInset}, 0 12px 28px rgba(0,0,0,0.12)`,
  sheet: tokens.sheetShadow,
} as const;

/**
 * Motion durations, always paired with `easing.calm`. Replaces the ad hoc
 * 120/150/200/300ms mix that had accumulated one-off per component.
 */
export const durations = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;
