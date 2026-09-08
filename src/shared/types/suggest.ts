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
}
