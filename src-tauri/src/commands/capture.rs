use crate::application::capture_usecase::CaptureUseCase;
use std::sync::Arc;
use tauri::{AppHandle, State};
use crate::sidecar::event_router;

#[tauri::command]
pub async fn start_capture(
    app: AppHandle,
    capture_use_case: State<'_, Arc<CaptureUseCase>>,
    context: Option<String>,
    role: Option<String>,
) -> Result<(), String> {
    let app_clone = app.clone();
    capture_use_case.start(context, role, Box::new(move |text| {
        event_router::route_sidecar_event(&app_clone, &text);
    })).map_err(|e| e.to_string())
}

use crate::ports::chat_gateway::ChatGatewayClient;

#[tauri::command]
pub async fn stop_capture(
    capture_use_case: State<'_, Arc<CaptureUseCase>>,
    chat_client: State<'_, Arc<dyn ChatGatewayClient>>,
) -> Result<(), String> {
    let result = capture_use_case.stop().map_err(|e| e.to_string());
    // Auto-rebuild chatbot FTS index after meeting capture completes (G-1)
    let _ = chat_client.send(r#"{"type":"RebuildIndex","force":false}"#.to_string());
    result
}
