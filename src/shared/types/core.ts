export type Status = 'idle' | 'connecting' | 'live' | 'unavailable';
export type Significance = 'none' | 'low' | 'medium' | 'high';

/** Categories the UI has dedicated styling for. See design-system/tagPalette.ts. */
export type SuggestTag = 'technical' | 'decision' | 'risk' | 'clarification';

export interface TxLine {
  id: string;
  speaker: string;
  text: string;
  time: number;
  partial: boolean;
  speakerIdx?: number;
}

/**
 * A retrieved snippet backing a suggestion.
 *
 * `isVerbatim` / `isTechnical` drive the row's accent color (see ContextLegend),
 * while `tags` drive the category pill — two independent signals, not one.
 */
export interface ContextItem {
  text: string;
  /** 0..1 match strength. */
  confidence: number;
  isVerbatim: boolean;
  isTechnical: boolean;
  tags: SuggestTag[];
}
