import {
  SuggestCardType,
  TxLine,
  SpeakerRevision,
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
  DocumentDeleted,
  AudioLevel,
  TrialStatus
} from '../types';

export interface ProviderStatus {
  provider: string;
  state: string; // 'connecting' | 'live' | 'unavailable'
}

export interface IEventBus {
  onSuggestAnswer(cb: (card: SuggestCardType) => void): () => void;
  /**
   * Loudness of the capture mix, ~31 Hz while a session runs.
   *
   * Far higher frequency than every other event here: a subscriber must not
   * route this into React state. See features/capture/useAudioLevel.
   */
  onAudioLevel(cb: (level: AudioLevel) => void): () => void;
  onTranscriptPartial(cb: (line: TxLine) => void): () => void;
  onTranscriptFinal(cb: (line: TxLine) => void): () => void;
  /**
   * Retroactive speaker corrections for turns already on screen.
   *
   * The STT provider re-clusters voices as it hears more of the meeting, and
   * sends a batch naming the turns it had attributed to the wrong speaker.
   * Each entry identifies its turn by `turnOrder` — the only handle it gives.
   */
  onSpeakerRevision(cb: (revisions: SpeakerRevision[]) => void): () => void;
  onContextExplanation(cb: (data: {text: string, speaker: string}) => void): () => void;
  onTechnicalExplanation(cb: (data: {text: string, speaker: string}) => void): () => void;
  onMeetingRisks(cb: (risks: MeetingRisk[]) => void): () => void;
  onMeetingDecisions(cb: (decisions: MeetingDecision[]) => void): () => void;
  onMeetingActionItems(cb: (actions: MeetingActionItem[]) => void): () => void;
  onChunkSignificance(cb: (sig: Significance) => void): () => void;
  onProviderStatus(cb: (status: ProviderStatus) => void): () => void;
  onCircuitBreaker(cb: () => void): () => void;
  onCaptureError(cb: (err: string) => void): () => void;
  /** The free trial ran out mid-capture; the backend has already stopped it. */
  onTrialEnded(cb: (status: TrialStatus) => void): () => void;
  onApiHealth(cb: (health: any) => void): () => void;
  onChatReply(cb: (reply: ChatReplyEvent) => void): () => void;
  onChatThinking(cb: (event: ChatThinkingEvent | string) => void): () => void;
  onChatError(cb: (err: ChatErrorEvent) => void): () => void;
  
  onDocumentProgress(cb: (progress: DocumentProgress) => void): () => void;
  onDocumentReady(cb: (ready: DocumentReady) => void): () => void;
  onDocumentList(cb: (docs: UploadedDocument[]) => void): () => void;
  onDocumentDeleted(cb: (deleted: DocumentDeleted) => void): () => void;
}
