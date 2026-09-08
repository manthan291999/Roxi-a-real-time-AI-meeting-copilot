import { invoke } from '@tauri-apps/api/core';
import { IUsageRepository } from '../shared/interfaces';
import { SessionUsage } from '../shared/types';

interface RawAgentUsage {
  tag: string;
  calls: number;
  cost_usd: number;
}

interface RawSessionUsage {
  session_id: number;
  cost_usd: number;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  first_ts: string | null;
  by_agent: RawAgentUsage[];
}

function toSessionUsage(raw: RawSessionUsage): SessionUsage {
  return {
    sessionId: raw.session_id,
    costUsd: raw.cost_usd,
    calls: raw.calls,
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    firstTs: raw.first_ts,
    byAgent: raw.by_agent.map((a) => ({ tag: a.tag, calls: a.calls, costUsd: a.cost_usd })),
  };
}

export class TauriUsageRepository implements IUsageRepository {
  async getSessionUsage(sessionId: number): Promise<SessionUsage> {
    const raw = await invoke<RawSessionUsage>('get_session_usage', { sessionId });
    return toSessionUsage(raw);
  }
}
