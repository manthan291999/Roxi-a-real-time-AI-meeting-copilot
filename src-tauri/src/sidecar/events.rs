use serde::Deserialize;

/// One line of the gateway's stdout protocol.
///
/// Every field is optional and the struct is one flat shape rather than an enum
/// per type: the gateway is a separate process on its own release cadence, so a
/// message carrying a field this build does not know must be ignored, not fail
/// to deserialize and take the whole line — including its `type` — with it.
///
/// Changing this is one third of the three-file lockstep: this struct,
/// `event_router.rs`'s match arm, and `gateway/infrastructure/stdout-protocol.js`
/// (whose `EventType` list is asserted against the match by
/// `gateway/test/protocol.test.js`).
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
    /// The STT provider's index for this turn. Carried only so a later
    /// `SpeakerRevision` can be matched back to the turn it corrects.
    #[serde(rename = "turnOrder")]
    pub turn_order: Option<i64>,
    pub items: Option<serde_json::Value>,
    /// Retroactive speaker corrections — an array. The provider revises a batch
    /// of earlier turns at once, once diarization has settled.
    pub revisions: Option<serde_json::Value>,
    pub reply_type: Option<String>,

    // --- MeetingStarted ---
    /// `meetings.id` of the row the gateway just inserted. The gateway is the
    /// sole writer of that table, so this is the only way Rust learns it.
    #[serde(rename = "meetingId")]
    pub meeting_id: Option<i64>,
    /// `ROXI-007` — what the UI shows and what people say out loud.
    #[serde(rename = "displayId")]
    pub display_id: Option<String>,
    #[serde(rename = "projectId")]
    pub project_id: Option<i64>,

    // --- ChunkPersisted ---
    #[serde(rename = "chunkId")]
    pub chunk_id: Option<i64>,

    // --- AudioLevel ---
    // Synthesised by application/capture_usecase.rs, not sent by the gateway:
    // the meter rides this channel because it already exists and is routed.
    // All four are normalised 0.0..=1.0.
    pub rms: Option<f32>,
    pub low: Option<f32>,
    pub mid: Option<f32>,
    pub high: Option<f32>,
}

/// Payload of the `audio_level` Tauri event. Flat and unlabelled on purpose —
/// it is read ~31 times a second by a render loop.
#[derive(serde::Serialize, Clone, Copy)]
pub struct AudioLevelPayload {
    pub rms: f32,
    pub low: f32,
    pub mid: f32,
    pub high: f32,
}

#[derive(serde::Serialize, Clone)]
pub struct ResponseBulletWire {
    pub text: String,
    #[serde(rename = "isBest")]
    pub is_best: bool,
}

#[derive(serde::Serialize, Clone)]
pub struct ResponsePayload {
    pub text: String,
    pub speaker: String,
    #[serde(rename = "type")]
    pub reply_type: Option<String>,
    pub context_items: Vec<crate::agents::domain::context_item::ContextItem>,
    pub bullets: Vec<ResponseBulletWire>,
}

#[derive(serde::Serialize, Clone)]
pub struct TranscriptPayload {
    pub text: String,
    pub speaker: String,
    #[serde(rename = "sttLabel")]
    pub stt_label: Option<String>,
    /// Present on finals from providers that number their turns; the webview
    /// matches incoming speaker revisions against it.
    #[serde(rename = "turnOrder", skip_serializing_if = "Option::is_none")]
    pub turn_order: Option<i64>,
}

#[derive(serde::Serialize, Clone)]
pub struct ExplanationPayload {
    pub text: String,
    pub speaker: String,
}
