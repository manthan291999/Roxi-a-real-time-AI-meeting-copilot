import { listen } from '@tauri-apps/api/event';
import {
  IEventBus,
  IEventHandler,
  UnsubscribeFn,
  TranscriptPayload,
  ProviderStatusPayload,
  TextPayload,
  Decision,
  ActionItem,
  ApiHealthPayload,
  BillingPayload
} from '../interfaces/IEventBus';

export class TauriEventBus implements IEventBus {
  async onTranscriptPartial(handler: IEventHandler<TranscriptPayload>): Promise<UnsubscribeFn> {
    return listen<TranscriptPayload>('transcript_partial', e => handler(e.payload));
  }
  async onTranscriptFinal(handler: IEventHandler<TranscriptPayload>): Promise<UnsubscribeFn> {
    return listen<TranscriptPayload>('transcript_final', e => handler(e.payload));
  }
  async onProviderStatus(handler: IEventHandler<ProviderStatusPayload>): Promise<UnsubscribeFn> {
    return listen<ProviderStatusPayload>('provider_status', e => handler(e.payload));
  }
  async onContextExplanation(handler: IEventHandler<TextPayload>): Promise<UnsubscribeFn> {
    return listen<TextPayload>('context_explanation', e => handler(e.payload));
  }
  async onTechnicalExplanation(handler: IEventHandler<TextPayload>): Promise<UnsubscribeFn> {
    return listen<TextPayload>('technical_explanation', e => handler(e.payload));
  }
  async onChunkSignificance(handler: IEventHandler<string>): Promise<UnsubscribeFn> {
    return listen<string>('chunk_significance', e => handler(e.payload));
  }
  async onMeetingDecisions(handler: IEventHandler<Decision[]>): Promise<UnsubscribeFn> {
    return listen<Decision[]>('meeting_decisions', e => handler(e.payload));
  }
  async onMeetingActionItems(handler: IEventHandler<ActionItem[]>): Promise<UnsubscribeFn> {
    return listen<ActionItem[]>('meeting_action_items', e => handler(e.payload));
  }
  async onSuggestedResponse(handler: IEventHandler<TextPayload>): Promise<UnsubscribeFn> {
    return listen<TextPayload>('suggested_response', e => handler(e.payload));
  }
  async onCircuitBreaker(handler: IEventHandler<any>): Promise<UnsubscribeFn> {
    return listen<any>('circuit_breaker', e => handler(e.payload));
  }
  async onApiHealth(handler: IEventHandler<ApiHealthPayload>): Promise<UnsubscribeFn> {
    return listen<ApiHealthPayload>('api_health', e => handler(e.payload));
  }
  async onCaptureError(handler: IEventHandler<string>): Promise<UnsubscribeFn> {
    return listen<string>('capture_error', e => handler(e.payload));
  }
  async onBilling(handler: IEventHandler<BillingPayload>): Promise<UnsubscribeFn> {
    return listen<BillingPayload>('billing', e => handler(e.payload));
  }
}
