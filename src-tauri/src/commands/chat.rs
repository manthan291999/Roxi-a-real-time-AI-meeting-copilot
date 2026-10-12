use crate::ports::account_scope::{CurrentAccount, MeetingScope};
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
///
/// `mode` is the frontend's Knowledge switch: "direct" answers from the model
/// alone (no retrieval, no live context), anything else searches the meeting
/// corpora. The sidecar validates it — this layer only forwards it, and
/// defaults it so an older caller keeps the searching behaviour it expects.
///
/// `web_mode` is the Web switch, an axis INDEPENDENT of `mode`: "auto" offers
/// the model a web-search tool and lets it decide whether the question needs
/// one, "always" forces a search, "never" sends no tool at all. Unlike `mode`
/// it is forwarded WITHOUT a default — absent has to reach the sidecar as
/// absent so that the sidecar's own configured default (auto) applies.
/// Defaulting it here would pin every caller to one mode forever and move the
/// decision out of config.
#[tauri::command]
pub async fn ask_chat(
    app: AppHandle,
    chat: State<'_, Arc<dyn ChatGatewayClient>>,
    account: State<'_, Arc<dyn CurrentAccount>>,
    question: String,
    thread_id: Option<String>,
    history: Option<Vec<ChatMessage>>,
    live_context: Option<String>,
    mode: Option<String>,
    web_mode: Option<String>,
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
        "mode": mode.unwrap_or_else(|| "rag".into()),
        "webMode": web_mode,
        // Ask Roxi searches only the meetings this account owns.
        "scope": scope_json(&account.meeting_scope()),
    });

    chat.send(payload.to_string()).map_err(|e| e.to_string())
}

/// The wire form the chat sidecar reads (`chatbot/src/application/meetingScope.js`).
fn scope_json(scope: &MeetingScope) -> serde_json::Value {
    match scope {
        MeetingScope::Everyone => serde_json::json!({ "kind": "everyone" }),
        MeetingScope::Account(id) => serde_json::json!({ "kind": "account", "accountId": id }),
        MeetingScope::Nobody => serde_json::json!({ "kind": "nobody" }),
    }
}

#[cfg(test)]
mod scope_tests {
    use super::*;

    #[test]
    fn sends_the_scope_the_sidecar_expects() {
        assert_eq!(
            scope_json(&MeetingScope::Everyone),
            serde_json::json!({ "kind": "everyone" })
        );
        assert_eq!(
            scope_json(&MeetingScope::Account("u1".into())),
            serde_json::json!({ "kind": "account", "accountId": "u1" })
        );
        assert_eq!(
            scope_json(&MeetingScope::Nobody),
            serde_json::json!({ "kind": "nobody" })
        );
    }
}

/// Stop the chat sidecar (called when the chat panel closes / app exits).
#[tauri::command]
pub async fn close_chat(chat: State<'_, Arc<dyn ChatGatewayClient>>) -> Result<(), String> {
    chat.stop_session().map_err(|e| e.to_string())
}
