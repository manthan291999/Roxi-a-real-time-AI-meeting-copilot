use crate::agents::adapters::usage_store::{UsageEntry, UsageStore};
use crate::agents::ports::llm_port::LlmClient;
use rig::{
    completion::Prompt,
    providers::openai::Client as OpenAiClient,
};
use serde_json::Value;
use std::time::Instant;

pub struct OpenAiAdapter {
    client: OpenAiClient,
    model: String,
    tag: Option<String>,
}

impl OpenAiAdapter {
    pub fn new(api_key: &str, model: &str) -> Self {
        Self {
            client: OpenAiClient::new(api_key),
            model: model.to_string(),
            tag: None,
        }
    }

    pub fn with_tag(api_key: &str, model: &str, tag: &str) -> Self {
        Self {
            client: OpenAiClient::new(api_key),
            model: model.to_string(),
            tag: Some(tag.to_string()),
        }
    }
}

#[async_trait::async_trait]
impl LlmClient for OpenAiAdapter {
    async fn complete(&self, system: &str, user: &str) -> anyhow::Result<String> {
        let start = Instant::now();
        let agent = self.client.agent(&self.model)
            .preamble(system)
            .build();
        
        match agent.prompt(user).await {
            Ok(response) => {
                let latency_ms = start.elapsed().as_millis() as i64;
                UsageStore::record(UsageEntry {
                    tag: self.tag.clone(),
                    model: self.model.clone(),
                    expect_json: false,
                    status: "ok".to_string(),
                    error_code: None,
                    error_message: None,
                    latency_ms,
                    prompt_tokens: None,
                    completion_tokens: None,
                    system_prompt: system.to_string(),
                    user_prompt: user.to_string(),
                    response_text: Some(response.clone()),
                });
                Ok(response)
            }
            Err(e) => {
                let latency_ms = start.elapsed().as_millis() as i64;
                let err_msg = e.to_string();
                UsageStore::record(UsageEntry {
                    tag: self.tag.clone(),
                    model: self.model.clone(),
                    expect_json: false,
                    status: "failed".to_string(),
                    error_code: Some("api_error".to_string()),
                    error_message: Some(err_msg.clone()),
                    latency_ms,
                    prompt_tokens: None,
                    completion_tokens: None,
                    system_prompt: system.to_string(),
                    user_prompt: user.to_string(),
                    response_text: None,
                });
                Err(anyhow::anyhow!(err_msg))
            }
        }
    }

    async fn complete_json(&self, system: &str, user: &str) -> anyhow::Result<Value> {
        let start = Instant::now();
        let agent = self.client.agent(&self.model)
            .preamble(system)
            .build();
        
        let prompt_result = agent.prompt(user).await;
        let latency_ms = start.elapsed().as_millis() as i64;

        match prompt_result {
            Ok(response) => {
                // Robustly extract JSON by finding the first '{' and last '}'
                // This handles markdown code fences, prose wrappers, and stray newlines
                let start_idx = response.find('{').ok_or_else(|| {
                    tracing::error!("[openai_adapter] No '{{' found in response: {}", &response[..response.len().min(200)]);
                    UsageStore::record(UsageEntry {
                        tag: self.tag.clone(),
                        model: self.model.clone(),
                        expect_json: true,
                        status: "failed".to_string(),
                        error_code: Some("json_missing_brace".to_string()),
                        error_message: Some("No '{' found in LLM response".to_string()),
                        latency_ms,
                        prompt_tokens: None,
                        completion_tokens: None,
                        system_prompt: system.to_string(),
                        user_prompt: user.to_string(),
                        response_text: Some(response.clone()),
                    });
                    anyhow::anyhow!("No JSON object found in LLM response")
                })?;

                let end_idx = response.rfind('}').ok_or_else(|| {
                    tracing::error!("[openai_adapter] No '}}' found in response: {}", &response[..response.len().min(200)]);
                    UsageStore::record(UsageEntry {
                        tag: self.tag.clone(),
                        model: self.model.clone(),
                        expect_json: true,
                        status: "failed".to_string(),
                        error_code: Some("json_missing_brace".to_string()),
                        error_message: Some("No '}' found in LLM response".to_string()),
                        latency_ms,
                        prompt_tokens: None,
                        completion_tokens: None,
                        system_prompt: system.to_string(),
                        user_prompt: user.to_string(),
                        response_text: Some(response.clone()),
                    });
                    anyhow::anyhow!("No closing '}}' found in LLM response")
                })?;
                
                let extracted = &response[start_idx..=end_idx];
                let json: Value = match serde_json::from_str(extracted) {
                    Ok(val) => val,
                    Err(e) => {
                        let err_msg = format!("JSON parse error: {} — extracted: {}", e, &extracted[..extracted.len().min(300)]);
                        tracing::error!("[openai_adapter] {}", &err_msg);
                        UsageStore::record(UsageEntry {
                            tag: self.tag.clone(),
                            model: self.model.clone(),
                            expect_json: true,
                            status: "failed".to_string(),
                            error_code: Some("json_parse_error".to_string()),
                            error_message: Some(err_msg),
                            latency_ms,
                            prompt_tokens: None,
                            completion_tokens: None,
                            system_prompt: system.to_string(),
                            user_prompt: user.to_string(),
                            response_text: Some(response.clone()),
                        });
                        return Err(anyhow::anyhow!(e));
                    }
                };

                UsageStore::record(UsageEntry {
                    tag: self.tag.clone(),
                    model: self.model.clone(),
                    expect_json: true,
                    status: "ok".to_string(),
                    error_code: None,
                    error_message: None,
                    latency_ms,
                    prompt_tokens: None,
                    completion_tokens: None,
                    system_prompt: system.to_string(),
                    user_prompt: user.to_string(),
                    response_text: Some(response),
                });

                Ok(json)
            }
            Err(e) => {
                let err_msg = e.to_string();
                UsageStore::record(UsageEntry {
                    tag: self.tag.clone(),
                    model: self.model.clone(),
                    expect_json: true,
                    status: "failed".to_string(),
                    error_code: Some("api_error".to_string()),
                    error_message: Some(err_msg.clone()),
                    latency_ms,
                    prompt_tokens: None,
                    completion_tokens: None,
                    system_prompt: system.to_string(),
                    user_prompt: user.to_string(),
                    response_text: None,
                });
                Err(anyhow::anyhow!(err_msg))
            }
        }
    }
}
