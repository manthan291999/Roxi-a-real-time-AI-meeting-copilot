use serde::{Deserialize, Serialize};

/// LLM spend for one agent tag within a session (e.g. "explanation", "response").
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentUsage {
    pub tag: String,
    pub calls: i64,
    pub cost_usd: f64,
}

/// LLM spend for one capture session, read from `llm_usage.db`.
///
/// Estimated from list pricing at write time (`usage_store.rs::calculate_cost`),
/// same as `dashboard/`'s figures — not a metered bill.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionUsage {
    pub session_id: u64,
    pub cost_usd: f64,
    pub calls: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    /// Timestamp of the first recorded call this session, if any.
    pub first_ts: Option<String>,
    /// Highest-cost tag first.
    pub by_agent: Vec<AgentUsage>,
}

impl SessionUsage {
    /// No calls recorded yet (fresh session, or `llm_usage.db` doesn't exist yet).
    pub fn empty(session_id: u64) -> Self {
        Self {
            session_id,
            cost_usd: 0.0,
            calls: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            first_ts: None,
            by_agent: Vec::new(),
        }
    }
}
