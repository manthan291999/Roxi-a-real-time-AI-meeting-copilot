use serde::Deserialize;
use tauri::{AppHandle, Emitter};

/// Protocol messages emitted by chatbot/sidecar.js (line-delimited JSON).
#[derive(Deserialize, Debug)]
pub struct ChatEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub node: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub message: Option<String>,
    pub code: Option<String>,
    pub stats: Option<serde_json::Value>,
}

/// Route one chat-sidecar stdout line to frontend Tauri events.
/// Non-protocol lines (should not happen; logs go to stderr) are printed.
pub fn route_chat_event(app: &AppHandle, text: &str) {
    if let Ok(event) = serde_json::from_str::<ChatEvent>(text) {
        match event.event_type.as_str() {
            "Ready" => {
                let _ = app.emit("chat_ready", ());
            }
            "ChatThinking" => {
                let node = event.node.unwrap_or_default();
                let _ = app.emit("chat_thinking", node);
            }
            "ChatReply" => {
                if let Some(p) = event.payload {
                    let _ = app.emit("chat_reply", p);
                }
            }
            "IndexRebuilt" => {
                let _ = app.emit("chat_index_rebuilt", event.stats);
            }
            "Error" => {
                let payload = serde_json::json!({
                    "message": event.message.unwrap_or_else(|| "Unknown chat error".into()),
                    "code": event.code.unwrap_or_else(|| "UNKNOWN".into()),
                });
                let _ = app.emit("chat_error", payload);
            }
            "Bye" => {
                let _ = app.emit("chat_closed", ());
            }
            _ => {}
        }
    } else {
        tracing::warn!("[chat sidecar log] {}", text);
    }
}
