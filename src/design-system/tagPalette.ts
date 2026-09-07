import { SuggestTag } from '../shared/types';
import { tokens } from './tokens';

export interface AccentColors {
  fg: string;
  bg: string;
  border: string;
}

/**
 * Single source of truth for tag color. Adding a category means adding one entry
 * here — the chips, filter row and context pills all read from this map, so no
 * component needs editing.
 */
export const TAG_PALETTE: Record<SuggestTag, AccentColors> = {
  technical: {
    fg: tokens.technical,
    bg: tokens.technicalBg,
    border: 'rgba(167, 139, 250, 0.30)',
  },
  decision: {
    fg: tokens.decision,
    bg: tokens.decisionBg,
    border: 'rgba(52, 211, 153, 0.30)',
  },
  risk: {
    fg: tokens.risk,
    bg: 'rgba(242, 177, 61, 0.15)',
    border: 'rgba(242, 177, 61, 0.30)',
  },
  clarification: {
    fg: tokens.mute,
    bg: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.15)',
  },
};

const NEUTRAL_ACCENT: AccentColors = {
  fg: tokens.mute,
  bg: 'rgba(255, 255, 255, 0.05)',
  border: 'rgba(255, 255, 255, 0.15)',
};

/** Tolerates unknown tags so an LLM tag the UI has no styling for still renders. */
export function getTagColors(tag: string): AccentColors {
  return TAG_PALETTE[tag as SuggestTag] ?? NEUTRAL_ACCENT;
}

/**
 * How a context row is accented. Independent of the row's tag pill: green marks a
 * near-exact quote from the meeting, purple marks technical content, and rows that
 * are neither stay neutral. ContextLegend renders the key for this.
 */
export const MATCH_ACCENTS = {
  verbatim: { fg: tokens.decision, bg: tokens.decisionBg, border: 'rgba(52, 211, 153, 0.30)' },
  technical: { fg: tokens.technical, bg: tokens.technicalBg, border: 'rgba(167, 139, 250, 0.30)' },
  neutral: NEUTRAL_ACCENT,
} as const satisfies Record<string, AccentColors>;

export type MatchKind = keyof typeof MATCH_ACCENTS;

/** Verbatim wins over technical when an item is both, matching the legend's order. */
export function getMatchKind(item: { isVerbatim: boolean; isTechnical: boolean }): MatchKind {
  if (item.isVerbatim) return 'verbatim';
  if (item.isTechnical) return 'technical';
  return 'neutral';
}
