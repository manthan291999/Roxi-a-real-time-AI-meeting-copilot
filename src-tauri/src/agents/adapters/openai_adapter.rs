//! OpenAI chat-completions adapter.
//!
//! ## Why this talks HTTP directly
//!
//! It used to go through `rig-core`. Two fields the brain depends on are not
//! reachable that way:
//!
//! * `prompt_cache_key` on the request — the provider routes by prefix hash
//!   anyway, but this raises the odds that a session's calls land on the same
//!   machine, which is what makes a cache hit likely rather than lucky.
//! * `usage.prompt_tokens_details.cached_tokens` on the response — the only
//!   way to know whether any of the caching works. Wrappers routinely drop
//!   unknown usage sub-objects during deserialization, and a silently absent
//!   number is indistinguishable from a cache that never hits.
//!
//! An adapter is the correct place for a provider-specific escape: nothing
//! above it changes, and the `LlmClient` port is unchanged.
//!
//! Note on `temperature`: never sent. The premium tier rejects it outright, and
//! the default is the right value for every agent here.

use crate::agents::adapters::usage_store::{UsageEntry, UsageStore};
use crate::agents::ports::llm_port::{LlmCallMeta, LlmClient};
use anyhow::{anyhow, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

pub struct OpenAiAdapter {
    http: reqwest::Client,
    api_key: String,
    model: String,
    tag: &'static str,
}

impl OpenAiAdapter {
    /// `tag` is the agent's name. It identifies the call on its usage row and,
    /// with the session, forms the prompt cache key — so it must be the same
    /// string `Agent::name()` returns or the dashboard's per-agent panels split
    /// one agent across two rows.
    pub fn with_tag(api_key: &str, model: &str, tag: &'static str) -> Self {
        Self {
            // One client per adapter, built once: a fresh `Client` per call
            // discards the connection pool, and TLS setup is most of the
            // latency of a short completion.
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .unwrap_or_default(),
            api_key: api_key.to_string(),
            model: model.to_string(),
            tag,
        }
    }

    async fn call(&self, system: &str, user: &str, meta: &LlmCallMeta) -> Result<Completion> {
        let mut body = json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user",   "content": user },
            ],
            "response_format": { "type": "json_object" }
        });

        // Same key for the whole session, per agent — the request set whose
        // prefixes are identical is exactly the set that should share a cache.
        if let Some(key) = meta.cache_key() {
            body["prompt_cache_key"] = json!(key);
        }

        let response = self
            .http
            .post(CHAT_COMPLETIONS_URL)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow!("openai request failed: {e}"))?;

        let status = response.status();
        let payload = response
            .text()
            .await
            .map_err(|e| anyhow!("openai response unreadable: {e}"))?;

        if !status.is_success() {
            return Err(anyhow!(
                "openai returned {status}: {}",
                first_chars(&payload, 300)
            ));
        }

        let parsed: ChatResponse = serde_json::from_str(&payload)
            .map_err(|e| anyhow!("openai response was not the expected shape: {e}"))?;

        let text = parsed
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .ok_or_else(|| anyhow!("openai returned no message content"))?;

        Ok(Completion {
            text,
            usage: parsed.usage.unwrap_or_default(),
        })
    }

    /// Assemble a usage row. Centralized because every one of the six exit
    /// paths below writes one, and a row that omits `prefix_hash` or
    /// `cached_tokens` makes the cache panels lie by undercounting.
    fn usage_entry(
        &self,
        system: &str,
        user: &str,
        meta: &LlmCallMeta,
        expect_json: bool,
        latency_ms: i64,
    ) -> UsageEntry {
        UsageEntry {
            tag: Some(self.tag.to_string()),
            model: self.model.clone(),
            expect_json,
            status: "ok".to_string(),
            error_code: None,
            error_message: None,
            latency_ms,
            prompt_tokens: None,
            completion_tokens: None,
            cached_tokens: 0,
            prefix_hash: meta.prefix_hash.clone(),
            brief_tokens: meta.brief_tokens as i64,
            session_id: meta.session_id.map(|s| s.value() as i64),
            meeting_id: meta.meeting_id,
            system_prompt: system.to_string(),
            user_prompt: user.to_string(),
            response_text: None,
        }
    }
}

#[async_trait::async_trait]
impl LlmClient for OpenAiAdapter {
    async fn complete(&self, system: &str, user: &str, meta: &LlmCallMeta) -> Result<String> {
        let start = Instant::now();
        let result = self.call(system, user, meta).await;
        let latency_ms = start.elapsed().as_millis() as i64;
        let mut entry = self.usage_entry(system, user, meta, false, latency_ms);

        match result {
            Ok(completion) => {
                completion.usage.apply_to(&mut entry);
                entry.response_text = Some(completion.text.clone());
                UsageStore::record(entry);
                Ok(completion.text)
            }
            Err(e) => {
                entry.status = "failed".to_string();
                entry.error_code = Some("api_error".to_string());
                entry.error_message = Some(e.to_string());
                UsageStore::record(entry);
                Err(e)
            }
        }
    }

    async fn complete_json(&self, system: &str, user: &str, meta: &LlmCallMeta) -> Result<Value> {
        let start = Instant::now();
        let result = self.call(system, user, meta).await;
        let latency_ms = start.elapsed().as_millis() as i64;
        let mut entry = self.usage_entry(system, user, meta, true, latency_ms);

        let completion = match result {
            Ok(completion) => completion,
            Err(e) => {
                entry.status = "failed".to_string();
                entry.error_code = Some("api_error".to_string());
                entry.error_message = Some(e.to_string());
                UsageStore::record(entry);
                return Err(e);
            }
        };

        completion.usage.apply_to(&mut entry);
        entry.response_text = Some(completion.text.clone());

        match extract_json(&completion.text) {
            Ok(value) => {
                UsageStore::record(entry);
                Ok(value)
            }
            Err(failure) => {
                tracing::error!(
                    "[openai_adapter] {} — response: {}",
                    failure.message,
                    first_chars(&completion.text, 200)
                );
                entry.status = "failed".to_string();
                entry.error_code = Some(failure.code.to_string());
                entry.error_message = Some(failure.message.clone());
                UsageStore::record(entry);
                Err(anyhow!(failure.message))
            }
        }
    }
}

struct Completion {
    text: String,
    usage: Usage,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}

#[derive(Deserialize, Default)]
struct Usage {
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    prompt_tokens_details: Option<PromptTokensDetails>,
}

#[derive(Deserialize, Default)]
struct PromptTokensDetails {
    cached_tokens: Option<i64>,
}

impl Usage {
    /// Real counts, not the 4-chars-per-token estimate. `cached_tokens` is the
    /// number the whole brain design is judged on.
    fn apply_to(&self, entry: &mut UsageEntry) {
        entry.prompt_tokens = self.prompt_tokens;
        entry.completion_tokens = self.completion_tokens;
        entry.cached_tokens = self
            .prompt_tokens_details
            .as_ref()
            .and_then(|d| d.cached_tokens)
            .unwrap_or(0);
    }
}

#[derive(Debug)]
struct JsonFailure {
    code: &'static str,
    message: String,
}

/// Extract a JSON object from a completion.
///
/// Still first-brace-to-last-brace: it tolerates markdown fences, prose
/// wrappers and stray newlines, and it misparses a prompt that can emit nested
/// unrelated braces. Keep JSON-producing prompts constrained to "return only a
/// JSON object" — the extraction is not a parser and cannot become one here.
fn extract_json(response: &str) -> std::result::Result<Value, JsonFailure> {
    let start = response.find('{').ok_or_else(|| JsonFailure {
        code: "json_missing_brace",
        message: "no '{' found in LLM response".to_string(),
    })?;
    let end = response.rfind('}').ok_or_else(|| JsonFailure {
        code: "json_missing_brace",
        message: "no '}' found in LLM response".to_string(),
    })?;
    if start > end {
        return Err(JsonFailure {
            code: "json_invalid_bounds",
            message: "closing brace appears before the opening brace".to_string(),
        });
    }

    serde_json::from_str(&response[start..=end]).map_err(|e| JsonFailure {
        code: "json_parse_error",
        message: format!("JSON parse error: {e}"),
    })
}

/// Truncate for logging on a char boundary — LLM output routinely contains
/// multi-byte characters, and byte-slicing one in half panics.
fn first_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_is_extracted_from_a_fenced_response() {
        let value = extract_json("```json\n{\"a\": 1}\n```").unwrap();
        assert_eq!(value["a"], 1);
    }

    #[test]
    fn a_response_with_no_object_is_an_error_not_a_default() {
        assert!(extract_json("I cannot answer that.").is_err());
        assert!(extract_json("}{").is_err());
    }

    #[test]
    fn cached_tokens_default_to_zero_when_the_provider_omits_the_detail() {
        let usage: Usage = serde_json::from_str(r#"{"prompt_tokens": 10}"#).unwrap();
        let mut entry = UsageEntry::blank();
        usage.apply_to(&mut entry);
        assert_eq!(entry.prompt_tokens, Some(10));
        assert_eq!(entry.cached_tokens, 0);
    }

    #[test]
    fn cached_tokens_are_read_off_the_nested_detail_object() {
        let usage: Usage = serde_json::from_str(
            r#"{"prompt_tokens": 5000, "prompt_tokens_details": {"cached_tokens": 4608}}"#,
        )
        .unwrap();
        let mut entry = UsageEntry::blank();
        usage.apply_to(&mut entry);
        assert_eq!(entry.cached_tokens, 4608);
    }
}
