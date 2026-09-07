export const tokens = {
  /**
   * Surfaces.
   *
   * The shell (AppShell) is the ONLY layer that carries transparency. Interior
   * surfaces are transparent or a white overlay at <= 0.06 alpha, because
   * transmittance multiplies — see the opacity budget in styles.css. Depth is
   * carried by hairlines and shadows, not by opacity.
   *
   * These four propagate to all 20 consuming files with no edits there.
   */
  ink: '#0A0A0C',
  panel: 'transparent',
  panelRaised: 'rgba(255,255,255,0.04)',
  /** One step stronger, for a control sitting on top of panelRaised. */
  overlay: 'rgba(255,255,255,0.06)',
  hairline: 'rgba(255,255,255,0.10)',
  hairlineSoft: 'rgba(255,255,255,0.05)',

  /**
   * Sheets sit OVER the glass (modals, tooltips), so they cannot derive from
   * --glass-alpha: they need their own readable ground or the text behind
   * them shows through.
   */
  sheet: 'rgba(19,19,27,0.72)',
  sheetInner: 'rgba(0,0,0,0.28)',

  /** Text stays fully opaque — none of the above applies to these. */
  paper: '#F5F5F7',
  /**
   * Lightened from #9A9AA4 when the shell became translucent. Measured over a
   * white desktop it was 3.86:1 on the shell and 3.42:1 on a card — below AA,
   * where the opaque design gave 6.99:1 / 6.40:1. #A5A5AF restores AA
   * (4.94:1 / 4.99:1). Still fully opaque; only the value moved.
   */
  mute: '#A5A5AF',
  /**
   * Micro-copy (timestamps, hints). Below AA at 2.77:1 — but it was also below
   * AA on the opaque design (3.92:1), so this is pre-existing, not a
   * regression from the glass work. Left alone deliberately.
   */
  muteDim: '#6F6F79',

  /** The one interactive accent — CTA, live state, focus. */
  signal: '#7C74F2',
  signalDim: 'rgba(124,116,242,0.14)',
  signalLine: 'rgba(124,116,242,0.35)',

  /** Semantic tag colors — meaning-carrying, kept off interactive chrome. */
  decision: '#34D399',
  decisionBg: 'rgba(52,211,153,0.12)',
  risk: '#F2B13D',
  technical: '#A78BFA',
  technicalBg: 'rgba(139,92,246,0.15)',
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
