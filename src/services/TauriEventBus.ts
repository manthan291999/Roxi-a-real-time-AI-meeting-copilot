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
   * The one place that talks to Tauri's event API.
   *
   * Every method below is "listen to this event, map the payload, hand it to
   * the consumer" — so that mechanic lives here once instead of being retyped
   * per event, and a change to how subscriptions work is a change to this
   * method alone.
   *
   * The `disposed` flag is the load-bearing part. `listen()` resolves its
   * unlisten function asynchronously, so `unlisten.then(f => f())` only takes
   * effect after a round-trip to the host. Until then the handler is still
   * registered and still fires — and every remount (React StrictMode's
   * mount/unmount/mount, a Fast Refresh update, a pane unmounting as a tab
   * changes) leaves a dead subscription sitting in that window alongside its
   * replacement. An event arriving there was delivered to BOTH, which is how
   * one chat answer became two bubbles. The flag closes the window
   * synchronously: the host-side unregistration still happens, but a disposed
   * subscription stops calling its consumer the moment it is disposed.
   */
  private subscribe<T>(event: string, handler: (payload: T) => void): () => void {
    let disposed = false;
    const registration = listen<T>(event, (e) => {
      if (disposed) return;
      handler(e.payload);
    });
    return () => {
      disposed = true;
      // Best-effort: the consumer has already stopped receiving events, and a
      // failed unregistration must not surface as an unhandled rejection.
      registration.then((unlisten) => unlisten()).catch(() => {});
    };
  }

  /**
   * `event_router.rs` emits a suggestion once, on `suggest_answer`. The legacy
   * `suggested_response` listener was removed: subscribing to both made every
   * suggestion arrive twice and cost two dedup passes and two state updates.
   */
  onSuggestAnswer(cb: (card: SuggestCardType) => void) {
    return this.subscribe<SuggestAnswerWire>('suggest_answer', (payload) => cb(toSuggestCard(payload)));
  }

  /**
   * Stamped with the arrival time here rather than in Rust: the two clocks are
   * unrelated, and the only question a consumer asks of it is "how long since
   * the last reading", which is a local one.
   */
  onAudioLevel(cb: (level: AudioLevel) => void) {
    return this.subscribe<AudioLevelWire>('audio_level', (payload) =>
      cb({
        rms: payload.rms ?? 0,
        low: payload.low ?? 0,
        mid: payload.mid ?? 0,
        high: payload.high ?? 0,
        at: performance.now(),
      })
    );
  }

  onTranscriptPartial(cb: (line: TxLine) => void) {
    return this.subscribe<TranscriptWire>('transcript_partial', (payload) => cb(toTxLine(payload, true)));
  }

  onTranscriptFinal(cb: (line: TxLine) => void) {
    return this.subscribe<TranscriptWire>('transcript_final', (payload) => cb(toTxLine(payload, false)));
  }

  onSpeakerRevision(cb: (revisions: SpeakerRevision[]) => void) {
    // Forwarded by the host as raw gateway JSON rather than a typed struct, so
    // the payload may be null or malformed — toSpeakerRevisions filters it.
    return this.subscribe<SpeakerRevisionWire[] | null>('speaker_revision', (payload) => {
      const revisions = toSpeakerRevisions(payload);
      if (revisions.length > 0) cb(revisions);
    });
  }

  onContextExplanation(cb: (data: {text: string, speaker: string}) => void) {
    return this.subscribe<{text: string, speaker: string}>('context_explanation', cb);
  }

  onTechnicalExplanation(cb: (data: {text: string, speaker: string}) => void) {
    return this.subscribe<{text: string, speaker: string}>('technical_explanation', cb);
  }

  onMeetingRisks(cb: (risks: MeetingRisk[]) => void) {
    return this.subscribe<MeetingRisk[]>('meeting_risks', cb);
  }

  onMeetingDecisions(cb: (decisions: MeetingDecision[]) => void) {
    return this.subscribe<MeetingDecision[]>('meeting_decisions', cb);
  }

  onMeetingActionItems(cb: (actions: MeetingActionItem[]) => void) {
    return this.subscribe<MeetingActionItem[]>('meeting_action_items', cb);
  }

  onChunkSignificance(cb: (sig: Significance) => void) {
    return this.subscribe<Significance>('chunk_significance', cb);
  }

  onProviderStatus(cb: (status: ProviderStatus) => void) {
    return this.subscribe<ProviderStatus>('provider_status', cb);
  }

  onCircuitBreaker(cb: () => void) {
    return this.subscribe<unknown>('circuit_breaker', () => cb());
  }

  onCaptureError(cb: (err: string) => void) {
    return this.subscribe<string>('capture_error', cb);
  }

  onApiHealth(cb: (health: any) => void) {
    return this.subscribe<any>('api_health', cb);
  }

  onChatReply(cb: (reply: ChatReplyEvent) => void) {
    return this.subscribe<ChatReplyEvent>('chat_reply', cb);
  }

  onChatThinking(cb: (event: ChatThinkingEvent | string) => void) {
    return this.subscribe<ChatThinkingEvent | string>('chat_thinking', cb);
  }

  onChatError(cb: (err: ChatErrorEvent) => void) {
    return this.subscribe<ChatErrorEvent>('chat_error', cb);
  }

  onDocumentProgress(cb: (progress: DocumentProgress) => void) {
    return this.subscribe<DocumentProgress>('document_progress', cb);
  }

  onDocumentReady(cb: (ready: DocumentReady) => void) {
    return this.subscribe<DocumentReady>('document_ready', cb);
  }

  onDocumentList(cb: (docs: UploadedDocument[]) => void) {
    return this.subscribe<UploadedDocument[]>('document_list', cb);
  }

  onDocumentDeleted(cb: (deleted: DocumentDeleted) => void) {
    return this.subscribe<DocumentDeleted>('document_deleted', cb);
  }
}
