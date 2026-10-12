//! Free-trial status for the plan screens. Enforcement lives in
//! `commands::capture`; this only reports.

use std::sync::Arc;

use tauri::State;

use crate::application::account_usecase::AccountUseCase;
use crate::application::trial_usecase::{TrialStatus, TrialUseCase};

#[tauri::command]
pub async fn get_trial_status(
    trial: State<'_, Arc<TrialUseCase>>,
    account: State<'_, Arc<AccountUseCase>>,
) -> Result<TrialStatus, String> {
    let access = current_access(&account).await;
    Ok(trial.status(access.plan(), access.email()))
}

/// Who is signed in, as far as the trial cares.
pub struct Access {
    /// `None` in local-only mode or when the workspace could not be loaded.
    pub plan: Option<String>,
    /// `None` when nobody is signed in.
    pub email: Option<String>,
}

impl Access {
    pub fn plan(&self) -> Option<&str> {
        self.plan.as_deref()
    }
    pub fn email(&self) -> Option<&str> {
        self.email.as_deref()
    }
}

pub async fn current_access(account: &AccountUseCase) -> Access {
    let state = account.state().await;
    Access {
        plan: state.workspace.map(|ws| ws.plan),
        email: state.user.and_then(|u| u.email),
    }
}
