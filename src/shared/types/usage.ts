/** LLM spend for one agent tag within a session (e.g. "explanation", "response_agent"). */
export interface AgentUsage {
  tag: string;
  calls: number;
  costUsd: number;
}

/**
 * LLM spend for the current capture session, as the `get_session_usage`
 * command reports it — mirrors `src-tauri/src/domain/usage.rs::SessionUsage`.
 *
 * Estimated from list pricing at write time, same as `dashboard/`'s figures —
 * not a metered bill.
 */
export interface SessionUsage {
  sessionId: number;
  costUsd: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** ISO timestamp of the first recorded call this session, if any. */
  firstTs: string | null;
  /** Highest-cost tag first. */
  byAgent: AgentUsage[];
}
