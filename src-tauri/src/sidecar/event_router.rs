use tauri::{AppHandle, Emitter};
use super::events::{SidecarEvent, TranscriptPayload, ExplanationPayload, ResponsePayload};

pub fn route_sidecar_event(app: &AppHandle, text: &str) {
    if let Ok(event) = serde_json::from_str::<SidecarEvent>(text) {
        match event.event_type.as_str() {
            "Partial" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Speaker A".to_string());
                    let _ = app.emit("transcript_partial", TranscriptPayload { text: t, speaker: s, stt_label: event.stt_label });
                }
            }
            "Final" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Speaker A".to_string());
                    let _ = app.emit("transcript_final", TranscriptPayload { text: t, speaker: s, stt_label: event.stt_label });
                }
            }
            "Explanation" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Unknown".to_string());
                    let _ = app.emit("context_explanation", ExplanationPayload { text: t, speaker: s });
                }
            }
            "TechnicalExplanation" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Unknown".to_string());
                    let _ = app.emit("technical_explanation", ExplanationPayload { text: t, speaker: s });
                }
            }
            "Significance" => {
                if let Some(l) = event.level {
                    let _ = app.emit("chunk_significance", l);
                }
            }
            "Decisions" => {
                if let Some(items) = event.items {
                    let _ = app.emit("meeting_decisions", items);
                }
            }
            "ActionItems" => {
                if let Some(items) = event.items {
                    let _ = app.emit("meeting_action_items", items);
                }
            }
            "Risks" => {
                if let Some(items) = event.items {
                    let _ = app.emit("meeting_risks", items);
                }
            }
            "Response" => {
                if let Some(t) = event.text {
                    let s = event.speaker.unwrap_or_else(|| "Unknown".to_string());
                    let _ = app.emit("suggested_response", ResponsePayload { text: t, speaker: s, reply_type: event.reply_type });
                }
            }
            "CircuitBreaker" => {
                let _ = app.emit("circuit_breaker", event.items);
            }
            "ApiHealth" => {
                let _ = app.emit("api_health", event.items);
            }
            "Billing" => {
                let _ = app.emit("billing", event.items);
            }
            "SpeakerRevision" => {
                let _ = app.emit("speaker_revision", event.revision);
            }
            "MeetingSummary" => {
                if let Some(t) = event.text {
                    let _ = app.emit("meeting_summary", t);
                }
            }
            "ProviderStatus" => {
                let payload = serde_json::json!({
                    "provider": event.provider,
                    "state": event.state,
                });
                let _ = app.emit("provider_status", payload);
            }
            "Error" => {
                let msg = event.message.unwrap_or_else(|| "Unknown".into());
                let _ = app.emit("capture_error", msg);
            }
            _ => {}
        }
    } else {
        eprintln!("[sidecar log] {}", text);
    }
}
