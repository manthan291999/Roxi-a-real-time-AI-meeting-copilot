use crate::agents::domain::chunk_state::ChunkState;
use async_trait::async_trait;

#[async_trait]
pub trait Agent: Send + Sync {
    fn name(&self) -> &'static str;
    async fn run(&self, state: &ChunkState) -> anyhow::Result<ChunkState>;
}
