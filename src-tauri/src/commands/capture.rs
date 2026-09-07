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

#[tauri::command]
pub async fn stop_capture(
    capture_use_case: State<'_, Arc<CaptureUseCase>>,
) -> Result<(), String> {
    // stop() polls try_wait with a blocking std::thread::sleep for up to 15s
    // (adapters/gateway_client.rs), so it must not run on the async runtime the
    // ChunkGraph pipeline tasks share.
    //
    // The chatbot FTS rebuild that used to be fired here has been removed: the
    // chat sidecar is spawned lazily by ask_chat, so send() failed with "Chat
    // sidecar is not running" whenever chat had not been opened, and the error
    // was discarded. It was also redundant — stdioSidecar.js runs
    // rebuildIfStale at startup, and FtsIndexBuilder compares the meeting count
    // in meeting_history.db against the index, so a finished meeting is picked
    // up the next time Ask Roxi opens.
    let use_case = capture_use_case.inner().clone();
    tauri::async_runtime::spawn_blocking(move || use_case.stop())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
