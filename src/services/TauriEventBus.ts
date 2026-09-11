import { listen } from '@tauri-apps/api/event';
import { IEventBus, ProviderStatus } from '../shared/interfaces';
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
  AudioLevel
} from '../shared/types';
import { AudioLevelWire, SpeakerRevisionWire, SuggestAnswerWire, TranscriptWire } from './wire';
import { toSpeakerRevisions, toSuggestCard, toTxLine } from './mappers';

export class TauriEventBus implements IEventBus {
  /**
   * `event_router.rs` emits a suggestion once, on `suggest_answer`. The legacy
   * `suggested_response` listener was removed: subscribing to both made every
   * suggestion arrive twice and cost two dedup passes and two state updates.
   */
  onSuggestAnswer(cb: (card: SuggestCardType) => void) {
    const handle = (wire: SuggestAnswerWire) => cb(toSuggestCard(wire));
    const unlisten = listen<SuggestAnswerWire>('suggest_answer', (e) => handle(e.payload));
    return () => {
      unlisten.then(f => f());
    };
  }
  
  /**
   * Stamped with the arrival time here rather than in Rust: the two clocks are
   * unrelated, and the only question a consumer asks of it is "how long since
   * the last reading", which is a local one.
   */
  onAudioLevel(cb: (level: AudioLevel) => void) {
    const unlisten = listen<AudioLevelWire>('audio_level', (e) =>
      cb({
        rms: e.payload.rms ?? 0,
        low: e.payload.low ?? 0,
        mid: e.payload.mid ?? 0,
        high: e.payload.high ?? 0,
        at: performance.now(),
      })
    );
    return () => {
      unlisten.then((f) => f());
    };
  }

  onTranscriptPartial(cb: (line: TxLine) => void) {
    const unlisten = listen<TranscriptWire>('transcript_partial', (e) => cb(toTxLine(e.payload, true)));
    return () => unlisten.then(f => f());
  }

  onTranscriptFinal(cb: (line: TxLine) => void) {
    const unlisten = listen<TranscriptWire>('transcript_final', (e) => cb(toTxLine(e.payload, false)));
    return () => unlisten.then(f => f());
  }

  onSpeakerRevision(cb: (revisions: SpeakerRevision[]) => void) {
    // Forwarded by the host as raw gateway JSON rather than a typed struct, so
    // the payload may be null or malformed — toSpeakerRevisions filters it.
    const unlisten = listen<SpeakerRevisionWire[] | null>('speaker_revision', (e) => {
      const revisions = toSpeakerRevisions(e.payload);
      if (revisions.length > 0) cb(revisions);
    });
    return () => unlisten.then(f => f());
  }

  onContextExplanation(cb: (data: {text: string, speaker: string}) => void) {
    const unlisten = listen<{text: string, speaker: string}>('context_explanation', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onTechnicalExplanation(cb: (data: {text: string, speaker: string}) => void) {
    const unlisten = listen<{text: string, speaker: string}>('technical_explanation', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onMeetingRisks(cb: (risks: MeetingRisk[]) => void) {
    const unlisten = listen<MeetingRisk[]>('meeting_risks', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onMeetingDecisions(cb: (decisions: MeetingDecision[]) => void) {
    const unlisten = listen<MeetingDecision[]>('meeting_decisions', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onMeetingActionItems(cb: (actions: MeetingActionItem[]) => void) {
    const unlisten = listen<MeetingActionItem[]>('meeting_action_items', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onChunkSignificance(cb: (sig: Significance) => void) {
    const unlisten = listen<Significance>('chunk_significance', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onProviderStatus(cb: (status: ProviderStatus) => void) {
    const unlisten = listen<ProviderStatus>('provider_status', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onCircuitBreaker(cb: () => void) {
    const unlisten = listen('circuit_breaker', () => cb());
    return () => unlisten.then(f => f());
  }

  onCaptureError(cb: (err: string) => void) {
    const unlisten = listen<string>('capture_error', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onApiHealth(cb: (health: any) => void) {
    const unlisten = listen<any>('api_health', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onChatReply(cb: (reply: ChatReplyEvent) => void) {
    const unlisten = listen<ChatReplyEvent>('chat_reply', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onChatThinking(cb: (event: ChatThinkingEvent | string) => void) {
    const unlisten = listen<ChatThinkingEvent | string>('chat_thinking', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onChatError(cb: (err: ChatErrorEvent) => void) {
    const unlisten = listen<ChatErrorEvent>('chat_error', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onDocumentProgress(cb: (progress: DocumentProgress) => void) {
    const unlisten = listen<DocumentProgress>('document_progress', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onDocumentReady(cb: (ready: DocumentReady) => void) {
    const unlisten = listen<DocumentReady>('document_ready', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onDocumentList(cb: (docs: UploadedDocument[]) => void) {
    const unlisten = listen<UploadedDocument[]>('document_list', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onDocumentDeleted(cb: (deleted: DocumentDeleted) => void) {
    const unlisten = listen<DocumentDeleted>('document_deleted', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }
}
