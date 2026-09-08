//! `EmbeddingGateway` over OpenAI's embeddings endpoint.
//!
//! Records a usage row like every other LLM call, so the brief's one call per
//! capture is attributable in the same table and against the same budget as the
//! agents' calls. That matters precisely because this replaces a per-chunk
//! embedding: without a row, the cost that disappeared would be invisible.

use crate::agents::adapters::usage_store::{UsageEntry, UsageStore};
use crate::ports::embedding::EmbeddingGateway;
use anyhow::{anyhow, Result};
use serde::Deserialize;
use serde_json::json;
use std::time::{Duration, Instant};

const EMBEDDINGS_URL: &str = "https://api.openai.com/v1/embeddings";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// 1,536 dimensions, and what the chatbot embedded its document chunks with.
///
/// This must match `chatbot`'s embed model exactly: cosine similarity between
/// vectors from two different models is meaningless, and the failure is silent —
/// plausible-looking scores over unrelated passages.
pub const EMBED_MODEL: &str = "text-embedding-3-small";

pub struct OpenAiEmbeddingAdapter {
    http: reqwest::Client,
    api_key: String,
    model: String,
}

impl OpenAiEmbeddingAdapter {
    pub fn new(api_key: &str) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .unwrap_or_default(),
            api_key: api_key.to_string(),
            model: EMBED_MODEL.to_string(),
        }
    }
}

#[async_trait::async_trait]
impl EmbeddingGateway for OpenAiEmbeddingAdapter {
    async fn embed_one(&self, text: &str, tag: &'static str) -> Result<Vec<f32>> {
        let text = text.trim();
        if text.is_empty() {
            return Err(anyhow!("cannot embed an empty string"));
        }

        let start = Instant::now();
        let result = self.request(text).await;
        let latency_ms = start.elapsed().as_millis() as i64;

        let mut entry = UsageEntry::blank();
        entry.tag = Some(tag.to_string());
        entry.model = self.model.clone();
        entry.latency_ms = latency_ms;
        entry.system_prompt = String::new();
        entry.user_prompt = text.to_string();

        match result {
            Ok((vector, prompt_tokens)) => {
                entry.prompt_tokens = prompt_tokens;
                // Embeddings produce no completion tokens; leaving this None
                // would make the store estimate one from the response text.
                entry.completion_tokens = Some(0);
                entry.response_text = Some(format!("[{} dimensions]", vector.len()));
                UsageStore::record(entry);
                Ok(vector)
            }
            Err(e) => {
                entry.status = "failed".to_string();
                entry.error_code = Some("api_error".to_string());
                entry.error_message = Some(e.to_string());
                entry.completion_tokens = Some(0);
                UsageStore::record(entry);
                Err(e)
            }
        }
    }
}

impl OpenAiEmbeddingAdapter {
    async fn request(&self, text: &str) -> Result<(Vec<f32>, Option<i64>)> {
        let response = self
            .http
            .post(EMBEDDINGS_URL)
            .bearer_auth(&self.api_key)
            .json(&json!({ "model": self.model, "input": text }))
            .send()
            .await
            .map_err(|e| anyhow!("embedding request failed: {e}"))?;

        let status = response.status();
        let payload = response
            .text()
            .await
            .map_err(|e| anyhow!("embedding response unreadable: {e}"))?;

        if !status.is_success() {
            return Err(anyhow!(
                "embeddings returned {status}: {}",
                payload.chars().take(300).collect::<String>()
            ));
        }

        let parsed: EmbeddingResponse = serde_json::from_str(&payload)
            .map_err(|e| anyhow!("embedding response was not the expected shape: {e}"))?;

        let vector = parsed
            .data
            .into_iter()
            .next()
            .map(|d| d.embedding)
            .ok_or_else(|| anyhow!("embeddings returned no vector"))?;

        Ok((vector, parsed.usage.and_then(|u| u.prompt_tokens)))
    }
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingDatum>,
    usage: Option<EmbeddingUsage>,
}

#[derive(Deserialize)]
struct EmbeddingDatum {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbeddingUsage {
    prompt_tokens: Option<i64>,
}
