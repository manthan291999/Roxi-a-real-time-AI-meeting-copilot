export type Status = 'idle' | 'connecting' | 'live' | 'unavailable';
export type Significance = 'none' | 'low' | 'medium' | 'high';

/** Categories the UI has dedicated styling for. See design-system/tagPalette.ts. */
export type SuggestTag = 'technical' | 'decision' | 'risk' | 'clarification';

export interface TxLine {
  id: string;
  /** Display name, already resolved by the gateway's diarization layer. */
  speaker: string;
  /** Raw STT label ("Speaker A"). The stable identity renames are keyed on. */
  sttLabel: string;
  text: string;
  time: number;
  partial: boolean;
  speakerIdx?: number;
  /**
   * The STT provider's index for this turn, when it numbers them.
   *
   * Only used to match retroactive speaker corrections back to the line they
   * correct — the provider re-clusters voices as a meeting goes on and names
   * the turns it got wrong by this index alone.
   */
  turnOrder?: number;
}

/**
 * A retroactive correction to a transcript line's speaker.
 *
 * The STT provider re-clusters voices as the meeting goes on, and once it is
 * confident it names the turns it had attributed to the wrong speaker. It
 * identifies each by the provider's own turn index and nothing else, which is
 * why TxLine carries `turnOrder`.
 */
export interface SpeakerRevision {
  turnOrder: number;
  /** The STT label the turn should have carried, e.g. "Speaker B". */
  sttLabel: string;
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
