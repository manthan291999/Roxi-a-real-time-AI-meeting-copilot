use crate::domain::usage::SessionUsage;
use crate::ports::usage::UsageRepository;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_session_usage(
    session_id: u64,
    usage: State<'_, Arc<dyn UsageRepository>>,
) -> Result<SessionUsage, String> {
    usage.session_usage(session_id).map_err(|e| e.to_string())
}
