import { ContextItem } from './core';

export interface SuggestBullet {
  text: string;
  isBest: boolean;
}

export interface SuggestCardType {
  /** Content-derived and stable, so re-emitted duplicates collapse. See suggestCardMapper. */
  id: string;
  text: string;
  speaker: string;
  timestamp: number;
  contextItems: ContextItem[];
  replyType?: string;
  bullets?: SuggestBullet[];

  /**
   * The card as it arrived, kept the first time a refinement replaces it.
   *
   * Present means "this card has been refined" — it is both the Undo payload
   * and the flag the card reads to show its refined badge. Only ever written
   * once: refining twice (shorter, then more formal) still restores to the
   * reply the pipeline actually produced, not to the intermediate rewrite,
   * because an Undo that lands on a version the user never chose is worse
   * than no Undo at all.
   */
  original?: { text: string; bullets?: SuggestBullet[] };

  /** Label of the refinement showing, e.g. 'Make it shorter'. */
  refinedWith?: string;
}
