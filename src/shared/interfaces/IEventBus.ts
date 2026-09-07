import {
  SuggestCardType,
  TxLine,
  Significance,
  ChatMessage,
  MeetingDecision,
  MeetingActionItem,
  MeetingRisk,
} from '../types';

export interface ProviderStatus {
  provider: string;
  state: string; // 'connecting' | 'live' | 'unavailable'
}

export interface IEventBus {
  onSuggestAnswer(cb: (card: SuggestCardType) => void): () => void;
  onTranscriptPartial(cb: (line: TxLine) => void): () => void;
  onTranscriptFinal(cb: (line: TxLine) => void): () => void;
  onContextExplanation(cb: (data: {text: string, speaker: string}) => void): () => void;
  onTechnicalExplanation(cb: (data: {text: string, speaker: string}) => void): () => void;
  onMeetingRisks(cb: (risks: MeetingRisk[]) => void): () => void;
  onMeetingDecisions(cb: (decisions: MeetingDecision[]) => void): () => void;
  onMeetingActionItems(cb: (actions: MeetingActionItem[]) => void): () => void;
  onChunkSignificance(cb: (sig: Significance) => void): () => void;
  onProviderStatus(cb: (status: ProviderStatus) => void): () => void;
  onCircuitBreaker(cb: () => void): () => void;
  onCaptureError(cb: (err: string) => void): () => void;
  onApiHealth(cb: (health: any) => void): () => void;
  onChatReply(cb: (msg: any) => void): () => void;
  onChatThinking(cb: (text: string) => void): () => void;
  onChatError(cb: (err: any) => void): () => void;
}
