//! Account commands: sign-up, sign-in, sign-out, password reset, and import
//! of local meeting history into the signed-in workspace.
//!
//! Auth commands return `AuthError` (a `{code, message}` object) rather than a
//! string, so the sign-in screen can branch on the code.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::adapters::local_history::LocalHistoryStats;
use crate::application::account_usecase::{AccountUseCase, ImportProgress, SignUpResult};
use crate::domain::account::{AccountState, AuthError};
use crate::domain::federated::{FederatedMethod, OAuthProvider, SignInMethods};

type Account<'a> = State<'a, Arc<AccountUseCase>>;

#[tauri::command]
pub async fn auth_get_state(account: Account<'_>) -> Result<AccountState, AuthError> {
    Ok(account.state().await)
}

#[tauri::command]
pub async fn auth_sign_in(
    account: Account<'_>,
    email: String,
    password: String,
) -> Result<AccountState, AuthError> {
    account.sign_in(&email, &password).await
}

/// Which browser sign-in buttons to show. Empty when none are set up.
#[tauri::command]
pub fn auth_sign_in_methods(account: Account<'_>) -> SignInMethods {
    account.sign_in_methods()
}

/// Opens the provider's sign-in page in the browser and resolves once the
/// user is back in Roxi, signed in. Rejects with `cancelled` if they give up.
#[tauri::command]
pub async fn auth_sign_in_oauth(
    app: AppHandle,
    account: Account<'_>,
    provider: OAuthProvider,
) -> Result<AccountState, AuthError> {
    finish_in_app(
        &app,
        account
            .sign_in_federated(FederatedMethod::OAuth(provider))
            .await,
    )
}

/// Company SSO, found by the domain of `email`.
#[tauri::command]
pub async fn auth_sign_in_sso(
    app: AppHandle,
    account: Account<'_>,
    email: String,
) -> Result<AccountState, AuthError> {
    let method = FederatedMethod::company_sso_for_email(&email)?;
    finish_in_app(&app, account.sign_in_federated(method).await)
}

#[tauri::command]
pub async fn auth_cancel_federated(account: Account<'_>) -> Result<(), AuthError> {
    account.cancel_federated_sign_in().await;
    Ok(())
}

/// The browser has focus when a federated sign-in ends; bring Roxi back.
fn finish_in_app(
    app: &AppHandle,
    result: Result<AccountState, AuthError>,
) -> Result<AccountState, AuthError> {
    if result.is_ok() {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    result
}

#[tauri::command]
pub async fn auth_sign_up(
    account: Account<'_>,
    email: String,
    password: String,
    full_name: Option<String>,
) -> Result<SignUpResult, AuthError> {
    account
        .sign_up(&email, &password, full_name.as_deref())
        .await
}

#[tauri::command]
pub async fn auth_sign_out(account: Account<'_>) -> Result<(), AuthError> {
    account.sign_out().await
}

#[tauri::command]
pub async fn auth_send_password_reset(
    account: Account<'_>,
    email: String,
) -> Result<(), AuthError> {
    account.send_password_reset(&email).await
}

#[tauri::command]
pub async fn auth_resend_confirmation(
    account: Account<'_>,
    email: String,
) -> Result<(), AuthError> {
    account.resend_confirmation(&email).await
}

#[tauri::command]
pub async fn get_local_history_stats(account: Account<'_>) -> Result<LocalHistoryStats, String> {
    let account = account.inner().clone();
    // SQLite reads, off the async runtime like every other DB command.
    tauri::async_runtime::spawn_blocking(move || account.local_history_stats())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Emits `import_progress` after every batch; resolves with the final totals.
#[tauri::command]
pub async fn import_local_history(
    app: AppHandle,
    account: Account<'_>,
) -> Result<ImportProgress, String> {
    account
        .import_local_history(|progress| {
            let _ = app.emit("import_progress", progress);
        })
        .await
        .map_err(|e| format!("{e:#}"))
}
