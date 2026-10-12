use crate::application::account_usecase::AccountUseCase;
use crate::application::capture_usecase::CaptureUseCase;
use crate::application::trial_usecase::TrialUseCase;
use crate::commands::trial::{current_access, Access};
use crate::domain::project::ProjectSelection;
use crate::sidecar::event_router;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Shown when Start is pressed after the trial has run out. The frontend
/// checks the trial first, so this is the backstop, not the usual path.
const TRIAL_ENDED: &str = "Your 5-minute free trial has ended. Choose a plan to keep capturing.";

/// How often a metered capture writes its time to disk and checks the limit.
const TRIAL_TICK: Duration = Duration::from_secs(5);

#[tauri::command]
pub async fn start_capture(
    app: AppHandle,
    capture_use_case: State<'_, Arc<CaptureUseCase>>,
    trial: State<'_, Arc<TrialUseCase>>,
    account: State<'_, Arc<AccountUseCase>>,
    name: Option<String>,
    context: Option<String>,
    role: Option<String>,
    // `project_id` wins over `new_project_name`: the picker only sends a name
    // for its inline "+ New project" row, which has no id yet.
    project_id: Option<i64>,
    new_project_name: Option<String>,
    doc_ids: Option<Vec<String>>,
) -> Result<u64, String> {
    let access = current_access(&account).await;
    let metered = !trial.is_unlimited(access.plan(), access.email());
    if metered
        && trial
            .status(access.plan(), access.email())
            .remaining_seconds
            == 0
    {
        return Err(TRIAL_ENDED.to_string());
    }

    let app_clone = app.clone();
    let selection = ProjectSelection::from_parts(project_id, new_project_name);

    let session_id = capture_use_case
        .start(
            selection,
            name,
            context,
            role,
            doc_ids,
            Arc::new(move |text| {
                event_router::route_sidecar_event(&app_clone, &text);
            }),
        )
        .await
        .map(|session_id| session_id.value())
        .map_err(|e| e.to_string())?;

    if metered {
        let generation = trial.begin();
        spawn_trial_timer(
            app,
            capture_use_case.inner().clone(),
            trial.inner().clone(),
            access,
            generation,
        );
    }
    Ok(session_id)
}

/// Saves trial time every tick and stops the capture when it runs out. Exits
/// quietly once the capture it was started for has ended.
fn spawn_trial_timer(
    app: AppHandle,
    capture: Arc<CaptureUseCase>,
    trial: Arc<TrialUseCase>,
    access: Access,
    generation: u64,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(TRIAL_TICK).await;
            match trial.checkpoint(generation) {
                None => return,
                Some(remaining) if remaining > 0 => continue,
                Some(_) => break,
            }
        }
        tracing::info!("[trial] free trial used up; stopping capture");
        trial.end();
        let stopping = capture.clone();
        match tauri::async_runtime::spawn_blocking(move || stopping.stop()).await {
            Ok(Err(e)) => tracing::warn!("[trial] stop after trial end failed: {e:#}"),
            Err(e) => tracing::warn!("[trial] stop after trial end panicked: {e}"),
            Ok(Ok(())) => {}
        }
        if let Err(e) = app.emit("trial_ended", trial.status(access.plan(), access.email())) {
            tracing::warn!("[trial] could not emit trial_ended: {e}");
        }
    });
}

#[tauri::command]
pub async fn stop_capture(
    capture_use_case: State<'_, Arc<CaptureUseCase>>,
    trial: State<'_, Arc<TrialUseCase>>,
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
    //
    // The trial stops counting when Stop is pressed, not when teardown ends.
    trial.end();
    let use_case = capture_use_case.inner().clone();
    tauri::async_runtime::spawn_blocking(move || use_case.stop())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
