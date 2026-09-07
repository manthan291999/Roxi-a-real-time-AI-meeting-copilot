use serde::{Deserialize, Serialize};

/// Mirrors the LLM's `context_items[]` JSON shape. `#[serde(default)]` makes every
/// field optional on deserialize so an LLM schema drift degrades gracefully instead
/// of silently discarding the whole array (see ResponseAgent::run).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct ContextItem {
    pub text: String,
    pub match_confidence: f32,
    /// Derived in ResponseAgent from match_confidence, not read from the LLM response.
    pub is_verbatim: bool,
    pub is_technical: bool,
    pub tags: Vec<String>,
}

/// Confidence above which a context item counts as a verbatim match.
pub const VERBATIM_CONFIDENCE_THRESHOLD: f32 = 0.90;
