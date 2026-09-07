export const tokens = {
  ink: '#0A0A0C',
  panel: '#111318',
  panelRaised: '#17171D',
  hairline: '#232329',
  hairlineSoft: '#1B1B20',

  paper: '#F5F5F7',
  mute: '#9A9AA4',
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
