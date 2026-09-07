import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { IEventBus, ProviderStatus } from '../shared/interfaces';
import { SuggestCardType, TxLine, Significance } from '../shared/types';
import { SuggestAnswerWire, TranscriptWire } from './wire';
import { toSuggestCard, toTxLine } from './mappers';

export class TauriEventBus implements IEventBus {
  /**
   * Both event names carry the same payload (event_router.rs:55-57). The mapper
   * derives a content-based id so the duplicate delivery collapses downstream
   * instead of showing every suggestion twice.
   */
  onSuggestAnswer(cb: (card: SuggestCardType) => void) {
    const handle = (wire: SuggestAnswerWire) => cb(toSuggestCard(wire));
    // PERF FIX #6: Listen ONLY to 'suggest_answer'. The legacy 'suggested_response'
    // listener was retained for backwards compat when the backend emitted both events,
    // but event_router.rs now emits only 'suggest_answer'. Listening to both caused
    // every suggestion to trigger 2x deduplication and 2x React state updates.
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

  onMeetingRisks(cb: (risks: string[]) => void) {
    const unlisten = listen<string[]>('meeting_risks', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onMeetingDecisions(cb: (decisions: string[]) => void) {
    const unlisten = listen<string[]>('meeting_decisions', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onMeetingActionItems(cb: (actions: string[]) => void) {
    const unlisten = listen<string[]>('meeting_action_items', (e) => cb(e.payload));
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

  onChatReply(cb: (msg: any) => void) {
    const unlisten = listen<any>('chat_reply', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onChatThinking(cb: (text: string) => void) {
    const unlisten = listen<string>('chat_thinking', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  onChatError(cb: (err: any) => void) {
    const unlisten = listen<any>('chat_error', (e) => cb(e.payload));
    return () => unlisten.then(f => f());
  }

  async toggleToolbar(): Promise<void> {
    await invoke('toggle_toolbar');
  }

  async toggleCaption(): Promise<void> {
    await invoke('toggle_caption');
  }
}
