//! Project taxonomy commands.
//!
//! Both are called from the intake modal's picker. There is deliberately no
//! `move_meeting_to_project` yet: no surface calls it, and this codebase has
//! already paid for commands that resolved nothing (`commands/overlay.rs`).
//! Add it with the history UI that needs it.

use crate::domain::project::Project;
use crate::ports::project_repository::ProjectRepository;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn list_projects(
    projects: State<'_, Arc<dyn ProjectRepository>>,
) -> Result<Vec<Project>, String> {
    // SQLite reads on a file the gateway may be writing. Off the async runtime
    // the pipeline shares, for the same reason `stop_capture` is.
    let repository = projects.inner().clone();
    tauri::async_runtime::spawn_blocking(move || repository.list())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_project(
    projects: State<'_, Arc<dyn ProjectRepository>>,
    name: String,
    description: Option<String>,
) -> Result<Project, String> {
    let repository = projects.inner().clone();

    let created = tauri::async_runtime::spawn_blocking(move || {
        repository
            .create(&name, description.as_deref())
            .and_then(|reference| {
                // Return the full row, not the narrow reference: the picker
                // renders `meeting_count` and `description`, and a second
                // round-trip to fetch them would flash an incomplete row.
                Ok(repository
                    .get(reference.id)?
                    .unwrap_or_else(|| Project {
                        reference,
                        description: None,
                        meeting_count: 0,
                        last_used_at: None,
                    }))
            })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    Ok(created)
}
