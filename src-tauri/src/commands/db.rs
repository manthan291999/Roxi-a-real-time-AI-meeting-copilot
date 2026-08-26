use crate::domain::meeting::{Meeting, MeetingDetails};
use crate::ports::db::Database;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_meetings(db: State<'_, Arc<dyn Database>>) -> Result<Vec<Meeting>, String> {
    db.get_meetings().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_meeting_details(id: i64, db: State<'_, Arc<dyn Database>>) -> Result<MeetingDetails, String> {
    db.get_meeting_details(id).map_err(|e| e.to_string())
}

