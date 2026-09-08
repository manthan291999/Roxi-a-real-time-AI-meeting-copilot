//! Embedding port — one vector for one string.
//!
//! Separate from `LlmClient` rather than a third method on it. `complete` and
//! `complete_json` return text for an agent; embedding returns a vector for a
//! retrieval step, and no agent calls it. Widening `LlmClient` would force
//! every agent's fake in every test to implement a method it never uses.

use anyhow::Result;

#[async_trait::async_trait]
pub trait EmbeddingGateway: Send + Sync {
    /// Embed one string.
    ///
    /// `tag` lands on the usage row so an embedding call is attributable in the
    /// same table and against the same budget as everything else. The brief's
    /// document pre-retrieval is one call per *meeting*; the per-chunk path this
    /// replaces was one call per chunk.
    async fn embed_one(&self, text: &str, tag: &'static str) -> Result<Vec<f32>>;
}
