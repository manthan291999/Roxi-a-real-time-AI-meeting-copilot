use async_trait::async_trait;
use serde_json::Value;

#[async_trait]
pub trait LlmClient: Send + Sync {
    /// Plain-text completion. Every agent currently uses `complete_json`, so
    /// this is unused — kept because removing it would narrow the port, and an
    /// agent that wants prose rather than JSON is a reasonable thing to add.
    #[allow(dead_code)]
    async fn complete(&self, system: &str, user: &str) -> anyhow::Result<String>;
    async fn complete_json(&self, system: &str, user: &str) -> anyhow::Result<Value>;
}
