use serde::Deserialize;
use tauri::{AppHandle, Emitter};

/// Protocol messages emitted by chatbot/sidecar.js (line-delimited JSON).
#[derive(Deserialize, Debug)]
pub struct ChatEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    /// Which chat thread this response belongs to. Absent on Ready/Bye and on
    /// errors raised before the thread is known.
    #[serde(rename = "threadId")]
    pub thread_id: Option<String>,
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
                // Object rather than a bare string so the thread it belongs to
                // travels with it; the frontend accepts both shapes.
                let payload = serde_json::json!({
                    "threadId": event.thread_id,
                    "node": event.node.unwrap_or_default(),
                });
                let _ = app.emit("chat_thinking", payload);
            }
            "ChatReply" => {
                if let Some(mut p) = event.payload {
                    // Merged into the payload rather than wrapped around it, so
                    // the frontend keeps one flat shape to read.
                    if let (Some(obj), Some(thread_id)) = (p.as_object_mut(), event.thread_id) {
                        obj.insert(
                            "threadId".to_string(),
                            serde_json::Value::String(thread_id),
                        );
                    }
                    let _ = app.emit("chat_reply", p);
                }
            }
            "IndexRebuilt" => {
                let _ = app.emit("chat_index_rebuilt", event.stats);
            }
            "Error" => {
                let payload = serde_json::json!({
                    "threadId": event.thread_id,
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
