use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Risk {
    pub text: String,
    pub category: String,
    pub severity: String,
}
