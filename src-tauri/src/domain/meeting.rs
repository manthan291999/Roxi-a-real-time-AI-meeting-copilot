use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Meeting {
    pub id: i64,
    pub start_time: String,
    pub end_time: Option<String>,
    pub context: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Decision {
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActionItem {
    pub description: String,
    pub assignee: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TechnicalAnalysis {
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SuggestedReply {
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptLine {
    pub speaker: String,
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MeetingDetails {
    pub meeting: Meeting,
    pub decisions: Vec<Decision>,
    pub action_items: Vec<ActionItem>,
    pub technical_analyses: Vec<TechnicalAnalysis>,
    pub suggested_replies: Vec<SuggestedReply>,
    pub transcripts: Vec<TranscriptLine>,
}
