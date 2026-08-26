use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct SidecarEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub text: Option<String>,
    pub message: Option<String>,
    pub level: Option<String>,
    pub speaker: Option<String>,
    pub provider: Option<String>,
    pub state: Option<String>,
    #[serde(rename = "sttLabel")]
    pub stt_label: Option<String>,
    pub items: Option<serde_json::Value>,
    pub revision: Option<serde_json::Value>,
}

#[derive(serde::Serialize, Clone)]
pub struct TranscriptPayload {
    pub text: String,
    pub speaker: String,
    #[serde(rename = "sttLabel")]
    pub stt_label: Option<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct ExplanationPayload {
    pub text: String,
    pub speaker: String,
}
