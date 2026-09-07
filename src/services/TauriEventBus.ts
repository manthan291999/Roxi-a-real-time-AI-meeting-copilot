import { listen } from '@tauri-apps/api/event';
import { IEventBus, ProviderStatus } from '../shared/interfaces';
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
} from '../shared/types';
import { SuggestAnswerWire, TranscriptWire } from './wire';
import { toSuggestCard, toTxLine } from './mappers';

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
  
  onTranscriptPartial(cb: (line: TxLine) => void) {
    const unlisten = listen<TranscriptWire>('transcript_partial', (e) => cb(toTxLine(e.payload, true)));
    return () => unlisten.then(f => f());
  }

  onTranscriptFinal(cb: (line: TxLine) => void) {
    const unlisten = listen<TranscriptWire>('transcript_final', (e) => cb(toTxLine(e.payload, false)));
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

}
