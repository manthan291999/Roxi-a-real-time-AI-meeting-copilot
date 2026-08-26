use crate::application::capture_usecase::CaptureUseCase;
use std::sync::Arc;
use tauri::{AppHandle, State};
use crate::sidecar::event_router;

#[tauri::command]
pub async fn start_capture(
    app: AppHandle,
    capture_use_case: State<'_, Arc<CaptureUseCase>>,
    context: Option<String>,
) -> Result<(), String> {
    let app_clone = app.clone();
    capture_use_case.start(context, Box::new(move |text| {
        event_router::route_sidecar_event(&app_clone, &text);
    })).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_capture(capture_use_case: State<'_, Arc<CaptureUseCase>>) -> Result<(), String> {
    capture_use_case.stop().map_err(|e| e.to_string())
}
