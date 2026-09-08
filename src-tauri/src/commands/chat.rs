use crate::ports::chat_gateway::ChatGatewayClient;
use crate::sidecar::chat_events;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};

/// One prior chat turn, supplied by the frontend for thread rehydration.
#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Ask the meeting-history chatbot. Answers arrive asynchronously via
/// Tauri events: chat_thinking (progress), chat_reply (payload), chat_error.
#[tauri::command]
pub async fn ask_chat(
    app: AppHandle,
    chat: State<'_, Arc<dyn ChatGatewayClient>>,
    question: String,
    thread_id: Option<String>,
    history: Option<Vec<ChatMessage>>,
    live_context: Option<String>,
) -> Result<(), String> {
    let app_clone = app.clone();
    chat.start_session(Box::new(move |text| {
        chat_events::route_chat_event(&app_clone, &text);
    }))
    .map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "type": "Ask",
        "question": question,
        "threadId": thread_id.unwrap_or_else(|| "default".into()),
        "history": history.unwrap_or_default(),
        "liveContext": live_context.unwrap_or_default(),
    });

    chat.send(payload.to_string()).map_err(|e| e.to_string())
}

/// Stop the chat sidecar (called when the chat panel closes / app exits).
#[tauri::command]
pub async fn close_chat(chat: State<'_, Arc<dyn ChatGatewayClient>>) -> Result<(), String> {
    chat.stop_session().map_err(|e| e.to_string())
}
