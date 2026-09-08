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
    
    // Document specific fields
    #[serde(rename = "docId")]
    pub doc_id: Option<String>,
    #[serde(rename = "fileName")]
    pub file_name: Option<String>,
    pub phase: Option<String>,
    pub done: Option<u32>,
    pub total: Option<u32>,
    #[serde(rename = "chunkCount")]
    pub chunk_count: Option<u32>,
    #[serde(rename = "pageCount")]
    pub page_count: Option<u32>,
    pub docs: Option<serde_json::Value>,
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
            "DocumentProgress" => {
                let payload = serde_json::json!({
                    "docId": event.doc_id,
                    "phase": event.phase,
                    "done": event.done,
                    "total": event.total,
                });
                let _ = app.emit("document_progress", payload);
            }
            "DocumentReady" => {
                let payload = serde_json::json!({
                    "docId": event.doc_id,
                    "fileName": event.file_name,
                    "chunkCount": event.chunk_count,
                    "pageCount": event.page_count,
                });
                let _ = app.emit("document_ready", payload);
            }
            "DocumentList" => {
                let payload = event.docs.unwrap_or_else(|| serde_json::json!([]));
                let _ = app.emit("document_list", payload);
            }
            "DocumentDeleted" => {
                let payload = serde_json::json!({
                    "docId": event.doc_id,
                });
                let _ = app.emit("document_deleted", payload);
            }
            "Error" => {
                let mut payload = serde_json::json!({
                    "message": event.message.unwrap_or_else(|| "Unknown chat error".into()),
                    "code": event.code.unwrap_or_else(|| "UNKNOWN".into()),
                });
                
                if let Some(thread_id) = event.thread_id {
                    payload["threadId"] = serde_json::Value::String(thread_id);
                }
                if let Some(doc_id) = event.doc_id {
                    payload["docId"] = serde_json::Value::String(doc_id);
                }
                
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
