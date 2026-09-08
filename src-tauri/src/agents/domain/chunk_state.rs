use super::{action_item::ActionItem, agent_error::AgentError, decision::Decision, risk::Risk, context_item::ContextItem};
use crate::agents::brief::model::SharedBrief;
use crate::domain::project::ProjectId;
use crate::domain::session::SessionId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// One structured suggestion bullet from the Response Agent.
/// Mirrors `ContextItem` in its placement pattern.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResponseBullet {
    pub text: String,
    pub is_best: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum Complexity {
    Low,     // filler, single fact, pleasantry — run only explanation
    #[default]
    Medium,  // discussion, question — run explanation + risk  (SAFE FALLBACK)
    High,    // decision, multi-domain technical — run all agents
}

/// Everything one finalized transcript turn carries through the pipeline.
///
/// The session fields (`session_id`, `meeting_id`, `project_id`, `brief`,
/// `rolling_window`) are seeded by `ChunkGraph::run` from the live session and
/// are read-only to agents. They are here rather than as extra parameters on
/// `Agent::run` because the alternative is re-signing the trait, every agent and
/// every fake each time the session learns to carry one more thing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChunkState {
    pub chunk_text: String,
    pub speaker: String,
    pub is_chit_chat: bool,
    pub complexity: Complexity,
    pub skipped_agents: Vec<String>,

    // --- session identity (seeded by the orchestrator, never by an agent) ---
    /// The capture. Present from `start_capture`, before any meeting row exists.
    pub session_id: Option<SessionId>,
    /// `meetings.id`, once the gateway has reported it.
    pub meeting_id: Option<i64>,
    pub project_id: Option<ProjectId>,
    /// The last few final turns. Volatile by definition — it belongs below the
    /// frozen prefix and must never be folded into a brief.
    pub rolling_window: String,
    /// This agent's frozen prefix, resolved per agent as the orchestrator
    /// dispatches. `None` degrades to the bare role contract — today's
    /// behaviour — which is also the feature flag and the A/B mechanism.
    ///
    /// Skipped by serde: a `CompiledBrief` is constructed by the compiler and
    /// never reconstituted from JSON, which is what keeps its prefix immutable.
    #[serde(skip)]
    pub brief: Option<SharedBrief>,

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
    pub suggested_bullets: Option<Vec<ResponseBullet>>,
    pub context_items: Vec<ContextItem>,
    pub errors: Vec<AgentError>,
}

impl ChunkState {
    /// Fold an agent's output into this state.
    ///
    /// Deliberately does not touch the session fields: every partial was cloned
    /// from a base that already carries them, so copying them back would be a
    /// no-op at best and would let an agent overwrite the session at worst.
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
            self.suggested_bullets = other.suggested_bullets;
        }
        
        self.context_items.extend(other.context_items);
        
        self.errors.extend(other.errors);
    }
}
