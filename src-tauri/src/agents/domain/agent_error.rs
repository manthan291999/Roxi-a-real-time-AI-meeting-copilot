use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentError {
    pub agent: String,
    pub code: String,
    pub message: String,
}
