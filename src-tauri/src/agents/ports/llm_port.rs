use crate::domain::session::SessionId;
use async_trait::async_trait;
use serde_json::Value;

/// Everything an adapter needs to know about a call that is not the prompt.
///
/// Passed as one struct rather than five parameters so adding the next field —
/// a budget hint, a trace id — does not re-sign every agent and every fake.
/// It is also why this is a parameter on the existing methods rather than a new
/// method on the port: a `stream()` or `complete_with_cache()` added alongside
/// would force every agent's fake in every test to implement something almost
/// none of them call.
#[derive(Clone, Debug, Default)]
pub struct LlmCallMeta {
    /// The capture this call belongs to. Absent outside a session — a
    /// standalone or test call.
    pub session_id: Option<SessionId>,
    /// The gateway's `meetings.id`, once it has reported one. Absent for calls
    /// on chunks that arrive before the sidecar's first report.
    pub meeting_id: Option<i64>,
    /// The agent tag, doubling as the cache-key discriminator: each agent's
    /// frozen prefix differs, so each needs its own cache entry.
    pub agent_tag: Option<&'static str>,
    /// Hash of the frozen prefix this call carried, or `None` when it carried
    /// no brief. `COUNT(DISTINCT prefix_hash)` per (session, agent) must be 1;
    /// anything higher is a mutating prefix, which is a bug.
    pub prefix_hash: Option<String>,
    /// Estimated size of the frozen prefix, so cache hit rate can be read
    /// against what was actually cacheable.
    pub brief_tokens: usize,
}

impl LlmCallMeta {
    /// Stable for the whole session, per agent. `None` outside a session, in
    /// which case no key is sent and the provider falls back to routing on the
    /// prefix alone.
    pub fn cache_key(&self) -> Option<String> {
        let session = self.session_id?;
        let tag = self.agent_tag?;
        Some(format!("roxi:{session}:{tag}"))
    }
}

#[async_trait]
pub trait LlmClient: Send + Sync {
    /// Plain-text completion. Every agent currently uses `complete_json`, so
    /// this is unused — kept because removing it would narrow the port, and an
    /// agent that wants prose rather than JSON is a reasonable thing to add.
    #[allow(dead_code)]
    async fn complete(&self, system: &str, user: &str, meta: &LlmCallMeta)
        -> anyhow::Result<String>;

    async fn complete_json(
        &self,
        system: &str,
        user: &str,
        meta: &LlmCallMeta,
    ) -> anyhow::Result<Value>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cache_key_is_stable_per_session_and_agent() {
        let session = SessionId::mint();
        let meta = LlmCallMeta {
            session_id: Some(session),
            agent_tag: Some("explanation"),
            ..Default::default()
        };
        assert_eq!(meta.cache_key(), Some(format!("roxi:{session}:explanation")));
        assert_eq!(meta.cache_key(), meta.cache_key());
    }

    #[test]
    fn two_agents_in_one_session_get_different_keys() {
        let session = Some(SessionId::mint());
        let a = LlmCallMeta { session_id: session, agent_tag: Some("explanation"), ..Default::default() };
        let b = LlmCallMeta { session_id: session, agent_tag: Some("technical"), ..Default::default() };
        assert_ne!(a.cache_key(), b.cache_key());
    }

    #[test]
    fn no_session_means_no_key_rather_than_a_shared_one() {
        assert_eq!(LlmCallMeta::default().cache_key(), None);
    }
}
