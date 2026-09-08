import {
  SuggestCardType,
  TxLine,
  Significance,
  MeetingDecision,
  MeetingActionItem,
  MeetingRisk,
  ChatReplyEvent,
  ChatThinkingEvent,
  ChatErrorEvent,
  DocumentProgress,
  DocumentReady,
  UploadedDocument,
  DocumentDeleted
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
  onChatReply(cb: (reply: ChatReplyEvent) => void): () => void;
  onChatThinking(cb: (event: ChatThinkingEvent | string) => void): () => void;
  onChatError(cb: (err: ChatErrorEvent) => void): () => void;
  
  onDocumentProgress(cb: (progress: DocumentProgress) => void): () => void;
  onDocumentReady(cb: (ready: DocumentReady) => void): () => void;
  onDocumentList(cb: (docs: UploadedDocument[]) => void): () => void;
  onDocumentDeleted(cb: (deleted: DocumentDeleted) => void): () => void;
}
