use crate::agents::domain::{chunk_state::ChunkState, risk::Risk};
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

pub struct RiskDetectorAgent {
    llm: Arc<dyn LlmClient>,
}

impl RiskDetectorAgent {
    pub fn new(llm: Arc<dyn LlmClient>) -> Self {
        Self { llm }
    }
}

#[async_trait::async_trait]
impl Agent for RiskDetectorAgent {
    fn name(&self) -> &'static str {
        "risk_detector"
    }

    async fn run(&self, state: &ChunkState) -> anyhow::Result<ChunkState> {
        let system = "You are a Risk Detector Agent. Identify project risks, timeline threats, resource constraints from the chunk.
Return JSON exactly matching:
{
  \"risks\": [ {\"text\": \"...\", \"category\": \"TIMELINE|SCOPE|RESOURCE|TECHNICAL|ALIGNMENT\", \"severity\": \"low|medium|high\"} ]
}
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text.";

        let user = format!("Chunk: {}\nSpeaker: {}", state.chunk_text, state.speaker);

        let json = self.llm.complete_json(system, &user).await?;

        let mut next = state.clone();
        
        if let Some(risks) = json.get("risks").and_then(|v| v.as_array()) {
            for r in risks {
                if let Ok(risk) = serde_json::from_value::<Risk>(r.clone()) {
                    next.risks.push(risk);
                }
            }
        }
        
        Ok(next)
    }
}
