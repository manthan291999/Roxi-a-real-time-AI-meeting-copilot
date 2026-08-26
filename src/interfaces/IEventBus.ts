export interface IEventHandler<T> {
  (payload: T): void;
}

export type UnsubscribeFn = () => void;

export interface TranscriptPayload {
  text: string;
  speaker: string;
  sttLabel?: string;
}

export interface ProviderStatusPayload {
  provider: string | null;
  state: string;
}

export interface TextPayload {
  text: string;
  speaker: string;
}

export interface Decision {
  text: string;
  confidence: number;
}

export interface ActionItem {
  text: string;
  assignee: string | null;
  deadline: string | null;
}

export interface ApiKeyHealth {
  index: number;
  state: string;
  cooldownRemainingMs: number;
}

export interface ApiHealthPayload {
  keys: ApiKeyHealth[];
}

export interface BillingSnapshot {
  session_total_usd: number;
  session_prompt_tokens: number;
  session_completion_tokens: number;
  calls_made: number;
  per_agent: Record<string, { calls: number; cost_usd: number; tokens_in: number; tokens_out: number }>;
}

export interface BillingPayload {
  snapshot: BillingSnapshot;
}

export interface IEventBus {
  onTranscriptPartial(handler: IEventHandler<TranscriptPayload>): Promise<UnsubscribeFn>;
  onTranscriptFinal(handler: IEventHandler<TranscriptPayload>): Promise<UnsubscribeFn>;
  onProviderStatus(handler: IEventHandler<ProviderStatusPayload>): Promise<UnsubscribeFn>;
  onContextExplanation(handler: IEventHandler<TextPayload>): Promise<UnsubscribeFn>;
  onTechnicalExplanation(handler: IEventHandler<TextPayload>): Promise<UnsubscribeFn>;
  onChunkSignificance(handler: IEventHandler<string>): Promise<UnsubscribeFn>;
  onMeetingDecisions(handler: IEventHandler<Decision[]>): Promise<UnsubscribeFn>;
  onMeetingActionItems(handler: IEventHandler<ActionItem[]>): Promise<UnsubscribeFn>;
  onSuggestedResponse(handler: IEventHandler<TextPayload>): Promise<UnsubscribeFn>;
  onCircuitBreaker(handler: IEventHandler<any>): Promise<UnsubscribeFn>;
  onApiHealth(handler: IEventHandler<ApiHealthPayload>): Promise<UnsubscribeFn>;
  onCaptureError(handler: IEventHandler<string>): Promise<UnsubscribeFn>;
  onBilling(handler: IEventHandler<BillingPayload>): Promise<UnsubscribeFn>;
}
