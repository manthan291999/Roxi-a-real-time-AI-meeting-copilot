use async_trait::async_trait;
use serde_json::Value;

#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn complete(&self, system: &str, user: &str) -> anyhow::Result<String>;
    async fn complete_json(&self, system: &str, user: &str) -> anyhow::Result<Value>;
}
