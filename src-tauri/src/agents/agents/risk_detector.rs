use crate::agents::agents::prompt;
use crate::agents::domain::{chunk_state::ChunkState, risk::Risk};
use crate::agents::ports::{agent_port::Agent, llm_port::LlmClient};
use std::sync::Arc;

/// See `explanation::ROLE_CONTRACT` for why this is public and `const`.
pub const ROLE_CONTRACT: &str = "You are a Risk Detector Agent. Identify project risks, timeline threats, resource constraints from the chunk.
Weigh the risks the brief lists as already open: a turn that makes one of them worse is a higher-severity signal than a new unrelated worry.
Do not re-report an open risk unless this turn changes it.
Return JSON exactly matching:
{
  \"risks\": [ {\"text\": \"...\", \"category\": \"TIMELINE|SCOPE|RESOURCE|TECHNICAL|ALIGNMENT\", \"severity\": \"low|medium|high\"} ]
}
CRITICAL: Output ONLY raw JSON. No markdown, no ```json fences, no explanation text.";

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
        let built = prompt::build(ROLE_CONTRACT, self.name(), state)
            .with("Speaker", &state.speaker);

        let json = self
            .llm
            .complete_json(&built.prompt.system, &built.prompt.user, &built.meta)
            .await?;

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
