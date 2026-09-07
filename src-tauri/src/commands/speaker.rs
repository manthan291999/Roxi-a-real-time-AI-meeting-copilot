//! Speaker identity commands.
//!
//! A rename travels to the gateway rather than being written straight to
//! `speaker_names` from here: the gateway's diarization layer caches names for
//! the live session, and a direct database write would leave that cache stale,
//! so subsequent transcript lines would keep the old label.

use crate::application::capture_usecase::CaptureUseCase;
use serde_json::json;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn rename_speaker(
    capture_use_case: State<'_, Arc<CaptureUseCase>>,
    stt_label: String,
    display_name: String,
) -> Result<(), String> {
    let name = display_name.trim();
    if stt_label.is_empty() || name.is_empty() {
        return Err("Speaker label and display name are both required".into());
    }

    let channel = capture_use_case
        .control()
        .ok_or("No capture session is running")?;

    channel
        .send(&json!({
            "command": "renameSpeaker",
            "sttLabel": stt_label,
            "displayName": name,
        }))
        .map_err(|e| e.to_string())
}
