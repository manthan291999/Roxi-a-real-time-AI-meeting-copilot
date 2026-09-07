use super::{action_item::ActionItem, agent_error::AgentError, decision::Decision, risk::Risk, context_item::ContextItem};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum Complexity {
    Low,     // filler, single fact, pleasantry — run only explanation
    #[default]
    Medium,  // discussion, question — run explanation + risk  (SAFE FALLBACK)
    High,    // decision, multi-domain technical — run all agents
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChunkState {
    pub chunk_text: String,
    pub speaker: String,
    pub is_chit_chat: bool,
    pub complexity: Complexity,
    pub skipped_agents: Vec<String>,
    pub current_topic: Option<String>,
    pub conversation_summary: Option<String>,
    pub new_technical_terms: HashMap<String, String>,
    pub explanation: Option<String>,
    pub technical_explanation: Option<String>,
    pub decisions: Vec<Decision>,
    pub action_items: Vec<ActionItem>,
    pub risks: Vec<Risk>,
    pub suggested_response: Option<String>,
    pub suggested_response_type: Option<String>,
    pub context_items: Vec<ContextItem>,
    pub errors: Vec<AgentError>,
}

impl ChunkState {
    pub fn merge_from(&mut self, other: ChunkState) {
        self.skipped_agents.extend(other.skipped_agents);
        if other.is_chit_chat {
            self.is_chit_chat = true;
        }
        if other.current_topic.is_some() {
            self.current_topic = other.current_topic;
        }
        if other.conversation_summary.is_some() {
            self.conversation_summary = other.conversation_summary;
        }
        self.new_technical_terms.extend(other.new_technical_terms);
        
        if other.explanation.is_some() {
            self.explanation = other.explanation;
        }
        if other.technical_explanation.is_some() {
            self.technical_explanation = other.technical_explanation;
        }
        
        self.decisions.extend(other.decisions);
        self.action_items.extend(other.action_items);
        self.risks.extend(other.risks);
        
        if other.suggested_response.is_some() {
            self.suggested_response = other.suggested_response;
            self.suggested_response_type = other.suggested_response_type;
        }
        
        self.context_items.extend(other.context_items);
        
        self.errors.extend(other.errors);
    }
}
