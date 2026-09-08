use crate::domain::usage::SessionUsage;
use anyhow::Result;

pub trait UsageRepository: Send + Sync {
    /// Spend for one capture session (`SessionId::value()`), scoped by the
    /// `session_id` column in `llm_usage.db`. Returns `SessionUsage::empty`
    /// rather than an error when the session has recorded no calls yet.
    fn session_usage(&self, session_id: u64) -> Result<SessionUsage>;
}
