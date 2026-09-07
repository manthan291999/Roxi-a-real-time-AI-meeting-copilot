/**
 * Speaker identity colours, assigned round-robin by diarization index.
 *
 * The literals live in `styles.css` with every other colour, so a re-theme
 * does not have to hunt through `utils/`. Values resolve in a CSS context —
 * these are only ever assigned to a `style` property, never to canvas or an
 * SVG presentation attribute, where `var()` would not resolve.
 */
const colors = [
  'var(--t-speaker-1)',
  'var(--t-speaker-2)',
  'var(--t-speaker-3)',
  'var(--t-speaker-4)',
  'var(--t-speaker-5)',
];

export function getSpeakerColor(idx?: number): string {
  if (idx === undefined || idx < 0) return colors[0];
  return colors[idx % colors.length];
}
