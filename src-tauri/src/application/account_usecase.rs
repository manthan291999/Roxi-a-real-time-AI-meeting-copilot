//! Sign-up, sign-in, session upkeep, and importing local history into the
//! signed-in account.
//!
//! The session is cached in memory and mirrored to the `SessionStore`, so the
//! Keychain is read once at launch, not on every call. Every call that needs a
//! token goes through `access_token()`, which refreshes it when close to
//! expiry and signs the user out locally if the refresh token is rejected.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tokio::sync::Mutex;

use super::account_scope::AccountScopeCell;
use super::federated_sign_in::FederatedSignIn;
use crate::adapters::local_history::{LocalHistory, LocalHistoryStats};
use crate::domain::account::{
    AccountState, AccountUser, AuthError, AuthErrorCode, AuthSession, Workspace,
};
use crate::domain::federated::{FederatedMethod, SignInMethods};
use crate::ports::account_scope::UnownedHistoryClaim;
use crate::ports::auth::{AuthProvider, CloudApi, SessionStore, SignUpOutcome};

/// Meetings per request. Well under the server's 25, so one very long meeting
/// cannot push a batch past the body limit.
const IMPORT_BATCH: usize = 10;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum SignUpResult {
    SignedIn { account: AccountState },
    ConfirmEmail,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub total: usize,
    pub processed: usize,
    pub imported: usize,
    pub skipped: usize,
}

pub struct AccountUseCase {
    auth: Option<Arc<dyn AuthProvider>>,
    /// Browser-based sign-in; `None` offers email and password only.
    federated: Option<Arc<FederatedSignIn>>,
    /// Who local history belongs to right now; kept in step with `session`.
    scope: Option<Arc<AccountScopeCell>>,
    /// Gives pre-account history to its designated owner on sign-in.
    unowned: Option<Arc<dyn UnownedHistoryClaim>>,
    store: Arc<dyn SessionStore>,
    cloud: Arc<dyn CloudApi>,
    history: LocalHistory,
    session: Mutex<Option<AuthSession>>,
    workspace: Mutex<Option<Workspace>>,
    importing: AtomicBool,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn validate_credentials(email: &str, password: &str) -> Result<(), AuthError> {
    let email = email.trim();
    let at = email.find('@');
    let valid_email =
        matches!(at, Some(i) if i > 0 && email[i + 1..].contains('.') && !email.ends_with('.'));
    if !valid_email {
        return Err(AuthError::new(
            AuthErrorCode::InvalidInput,
            "Enter a valid email address.",
        ));
    }
    if password.is_empty() {
        return Err(AuthError::new(
            AuthErrorCode::InvalidInput,
            "Enter your password.",
        ));
    }
    Ok(())
}

impl AccountUseCase {
    pub fn new(
        auth: Option<Arc<dyn AuthProvider>>,
        store: Arc<dyn SessionStore>,
        cloud: Arc<dyn CloudApi>,
        history: LocalHistory,
    ) -> Self {
        // Loaded eagerly so the first `state()` call has no Keychain latency.
        let session = if auth.is_some() {
            store.load().unwrap_or_else(|e| {
                tracing::warn!("[auth] could not read saved session: {e:#}");
                None
            })
        } else {
            None
        };
        Self {
            auth,
            federated: None,
            scope: None,
            unowned: None,
            store,
            cloud,
            history,
            session: Mutex::new(session),
            workspace: Mutex::new(None),
            importing: AtomicBool::new(false),
        }
    }

    /// Adds browser-based sign-in (Microsoft, Google, company SSO).
    pub fn with_federated(mut self, federated: FederatedSignIn) -> Self {
        self.federated = Some(Arc::new(federated));
        self
    }

    /// Publishes the signed-in user to `scope` now and on every change, so
    /// history readers only see that user's meetings.
    pub fn with_scope(mut self, scope: Arc<AccountScopeCell>) -> Self {
        let user = self.session.get_mut().as_ref().map(|s| s.user.id.clone());
        scope.set_user(user.as_deref());
        self.scope = Some(scope);
        self
    }

    /// Lets the designated owner claim meetings recorded before accounts.
    pub fn with_unowned_history_claim(mut self, claim: Arc<dyn UnownedHistoryClaim>) -> Self {
        if let Some(session) = self.session.get_mut().as_ref() {
            Self::run_claim(claim.as_ref(), &session.user);
        }
        self.unowned = Some(claim);
        self
    }

    fn run_claim(claim: &dyn UnownedHistoryClaim, user: &AccountUser) {
        match claim.claim_if_owner(&user.id, user.email.as_deref()) {
            Ok(0) => {}
            Ok(n) => {
                tracing::info!("[history] assigned {n} earlier meetings on this Mac to their owner")
            }
            Err(e) => tracing::warn!("[history] could not assign earlier meetings: {e:#}"),
        }
    }

    fn publish_user(&self, user_id: Option<&str>) {
        if let Some(scope) = &self.scope {
            scope.set_user(user_id);
        }
    }

    fn provider(&self) -> Result<&Arc<dyn AuthProvider>, AuthError> {
        self.auth.as_ref().ok_or_else(AuthError::not_configured)
    }

    /// The state the UI renders. Refreshes an expired token and resolves the
    /// workspace, but never fails: a cloud outage shows a signed-in user with
    /// no workspace rather than logging them out.
    pub async fn state(&self) -> AccountState {
        if self.auth.is_none() {
            return AccountState {
                configured: false,
                user: None,
                workspace: None,
            };
        }
        let user = match self.access_token().await {
            Ok((_, user)) => Some(user),
            Err(_) => None,
        };
        let workspace = if user.is_some() {
            self.workspace().await
        } else {
            None
        };
        AccountState {
            configured: true,
            user,
            workspace,
        }
    }

    pub async fn sign_in(&self, email: &str, password: &str) -> Result<AccountState, AuthError> {
        validate_credentials(email, password)?;
        let session = self.provider()?.sign_in(email.trim(), password).await?;
        self.adopt(session).await;
        Ok(self.state().await)
    }

    /// The federated options the sign-in screen may show. Empty in local-only
    /// mode, so no button can appear without a provider behind it.
    pub fn sign_in_methods(&self) -> SignInMethods {
        match (&self.auth, &self.federated) {
            (Some(_), Some(federated)) => federated.methods().clone(),
            _ => SignInMethods::default(),
        }
    }

    /// Signs in through the browser and adopts the session like a password
    /// sign-in would.
    pub async fn sign_in_federated(
        &self,
        method: FederatedMethod,
    ) -> Result<AccountState, AuthError> {
        self.provider()?;
        let federated = self
            .federated
            .as_ref()
            .ok_or_else(AuthError::not_configured)?;
        let session = federated.run(&method).await?;
        self.adopt(session).await;
        Ok(self.state().await)
    }

    pub async fn cancel_federated_sign_in(&self) {
        if let Some(federated) = &self.federated {
            federated.cancel().await;
        }
    }

    pub async fn sign_up(
        &self,
        email: &str,
        password: &str,
        full_name: Option<&str>,
    ) -> Result<SignUpResult, AuthError> {
        validate_credentials(email, password)?;
        if password.chars().count() < 8 {
            return Err(AuthError::new(
                AuthErrorCode::WeakPassword,
                "Use at least 8 characters for your password.",
            ));
        }
        let name = full_name.map(str::trim).filter(|n| !n.is_empty());
        match self
            .provider()?
            .sign_up(email.trim(), password, name)
            .await?
        {
            SignUpOutcome::SignedIn(session) => {
                self.adopt(session).await;
                Ok(SignUpResult::SignedIn {
                    account: self.state().await,
                })
            }
            SignUpOutcome::ConfirmEmail => Ok(SignUpResult::ConfirmEmail),
        }
    }

    pub async fn sign_out(&self) -> Result<(), AuthError> {
        let session = self.session.lock().await.take();
        *self.workspace.lock().await = None;
        self.publish_user(None);
        if let Err(e) = self.store.clear() {
            tracing::warn!("[auth] could not clear saved session: {e:#}");
        }
        // Revoking server-side is best effort: the local session is already gone.
        if let (Some(session), Ok(provider)) = (session, self.provider()) {
            if let Err(e) = provider.sign_out(&session.access_token).await {
                tracing::debug!("[auth] remote sign-out failed: {e}");
            }
        }
        Ok(())
    }

    pub async fn send_password_reset(&self, email: &str) -> Result<(), AuthError> {
        validate_credentials(email, "-")?;
        self.provider()?.send_password_reset(email.trim()).await
    }

    pub async fn resend_confirmation(&self, email: &str) -> Result<(), AuthError> {
        validate_credentials(email, "-")?;
        self.provider()?.resend_confirmation(email.trim()).await
    }

    async fn adopt(&self, session: AuthSession) {
        if let Err(e) = self.store.save(&session) {
            // Still signed in for this run; only the next launch is affected.
            tracing::warn!("[auth] could not save session to the Keychain: {e:#}");
        }
        self.publish_user(Some(&session.user.id));
        if let Some(claim) = &self.unowned {
            Self::run_claim(claim.as_ref(), &session.user);
        }
        *self.session.lock().await = Some(session);
        *self.workspace.lock().await = None;
    }

    /// A valid access token for the signed-in user, refreshed if needed.
    pub async fn access_token(&self) -> Result<(String, AccountUser), AuthError> {
        let provider = self.provider()?;
        let mut guard = self.session.lock().await;
        let session = guard.as_ref().ok_or_else(AuthError::session_expired)?;
        if !session.needs_refresh(now()) {
            return Ok((session.access_token.clone(), session.user.clone()));
        }

        match provider.refresh(&session.refresh_token).await {
            Ok(fresh) => {
                if let Err(e) = self.store.save(&fresh) {
                    tracing::warn!("[auth] could not save refreshed session: {e:#}");
                }
                let result = (fresh.access_token.clone(), fresh.user.clone());
                *guard = Some(fresh);
                Ok(result)
            }
            // Offline: keep the session so the user is not logged out by a
            // dropped connection; the next call tries again.
            Err(e) if e.code == AuthErrorCode::Network => Err(e),
            Err(e) => {
                *guard = None;
                self.publish_user(None);
                let _ = self.store.clear();
                Err(e)
            }
        }
    }

    async fn workspace(&self) -> Option<Workspace> {
        if let Some(ws) = self.workspace.lock().await.clone() {
            return Some(ws);
        }
        let (token, _) = self.access_token().await.ok()?;
        match self.cloud.workspace(&token).await {
            Ok(ws) => {
                *self.workspace.lock().await = Some(ws.clone());
                Some(ws)
            }
            Err(e) => {
                tracing::warn!("[cloud] could not load workspace: {e:#}");
                None
            }
        }
    }

    pub fn local_history_stats(&self) -> anyhow::Result<LocalHistoryStats> {
        self.history.stats()
    }

    /// Uploads every local meeting to the signed-in user's workspace.
    ///
    /// Safe to run again: the server skips meetings this device already sent.
    /// `on_progress` fires after every batch.
    pub async fn import_local_history(
        &self,
        on_progress: impl Fn(&ImportProgress),
    ) -> anyhow::Result<ImportProgress> {
        if self.importing.swap(true, Ordering::SeqCst) {
            anyhow::bail!("An import is already running.");
        }
        let result = self.run_import(&on_progress).await;
        self.importing.store(false, Ordering::SeqCst);
        result
    }

    async fn run_import(
        &self,
        on_progress: &impl Fn(&ImportProgress),
    ) -> anyhow::Result<ImportProgress> {
        // Fail on sign-in problems before reading anything from disk.
        self.access_token().await?;
        let device_id = self.store.device_id()?;
        let projects = self.history.projects()?;
        let ids = self.history.meeting_ids()?;

        let mut progress = ImportProgress {
            total: ids.len(),
            ..Default::default()
        };
        on_progress(&progress);

        for (i, batch_ids) in ids.chunks(IMPORT_BATCH).enumerate() {
            let meetings = self.history.meetings(batch_ids)?;
            // Projects ride along with the first batch only; later batches
            // resolve them server-side by their local id.
            let batch = json!({
                "device_id": device_id,
                "projects": if i == 0 { projects.clone() } else { Vec::new() },
                "meetings": meetings,
            });
            // Fetched per batch: a long import can outlive one access token.
            let (token, _) = self.access_token().await?;
            let result = self.cloud.import_batch(&token, &batch).await?;

            progress.processed += batch_ids.len();
            progress.imported += result.meetings_imported;
            progress.skipped += result.meetings_skipped;
            on_progress(&progress);
        }
        Ok(progress)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ports::auth::ImportBatchResult;
    use async_trait::async_trait;
    use std::sync::Mutex as StdMutex;

    fn session(expires_at: i64) -> AuthSession {
        AuthSession {
            access_token: format!("access-{expires_at}"),
            refresh_token: "refresh".into(),
            expires_at,
            user: AccountUser {
                id: "u1".into(),
                email: Some("ana@example.com".into()),
                full_name: None,
            },
        }
    }

    #[derive(Default)]
    struct FakeAuth {
        refresh_fails: bool,
        signup_confirms: bool,
    }

    #[async_trait]
    impl AuthProvider for FakeAuth {
        async fn sign_up(
            &self,
            _: &str,
            _: &str,
            _: Option<&str>,
        ) -> Result<SignUpOutcome, AuthError> {
            Ok(if self.signup_confirms {
                SignUpOutcome::ConfirmEmail
            } else {
                SignUpOutcome::SignedIn(session(now() + 3600))
            })
        }
        async fn sign_in(&self, _: &str, password: &str) -> Result<AuthSession, AuthError> {
            if password == "right-password" {
                Ok(session(now() + 3600))
            } else {
                Err(AuthError::new(AuthErrorCode::InvalidCredentials, "no"))
            }
        }
        async fn refresh(&self, _: &str) -> Result<AuthSession, AuthError> {
            if self.refresh_fails {
                Err(AuthError::session_expired())
            } else {
                Ok(session(now() + 7200))
            }
        }
        async fn sign_out(&self, _: &str) -> Result<(), AuthError> {
            Ok(())
        }
        async fn send_password_reset(&self, _: &str) -> Result<(), AuthError> {
            Ok(())
        }
        async fn resend_confirmation(&self, _: &str) -> Result<(), AuthError> {
            Ok(())
        }
    }

    #[derive(Default)]
    struct MemoryStore(StdMutex<Option<AuthSession>>);
    impl SessionStore for MemoryStore {
        fn load(&self) -> anyhow::Result<Option<AuthSession>> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn save(&self, s: &AuthSession) -> anyhow::Result<()> {
            *self.0.lock().unwrap() = Some(s.clone());
            Ok(())
        }
        fn clear(&self) -> anyhow::Result<()> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
        fn device_id(&self) -> anyhow::Result<String> {
            Ok("device-1".into())
        }
    }

    #[derive(Default)]
    struct FakeCloud {
        batches: StdMutex<Vec<serde_json::Value>>,
    }
    #[async_trait]
    impl CloudApi for FakeCloud {
        async fn workspace(&self, _: &str) -> anyhow::Result<Workspace> {
            Ok(Workspace {
                org_id: "o1".into(),
                org_name: "ana's workspace".into(),
                role: "owner".into(),
                plan: "free".into(),
            })
        }
        async fn import_batch(
            &self,
            _: &str,
            batch: &serde_json::Value,
        ) -> anyhow::Result<ImportBatchResult> {
            self.batches.lock().unwrap().push(batch.clone());
            let n = batch["meetings"].as_array().unwrap().len();
            Ok(ImportBatchResult {
                projects_imported: 0,
                meetings_imported: n,
                meetings_skipped: 0,
            })
        }
    }

    fn usecase(auth: FakeAuth, store: Arc<MemoryStore>, cloud: Arc<FakeCloud>) -> AccountUseCase {
        AccountUseCase::new(
            Some(Arc::new(auth)),
            store,
            cloud,
            LocalHistory::new("/nonexistent.db"),
        )
    }

    #[tokio::test]
    async fn local_mode_when_auth_is_not_configured() {
        let uc = AccountUseCase::new(
            None,
            Arc::new(MemoryStore::default()),
            Arc::new(FakeCloud::default()),
            LocalHistory::new("/x"),
        );
        assert_eq!(
            uc.state().await,
            AccountState {
                configured: false,
                user: None,
                workspace: None
            }
        );
        assert_eq!(
            uc.sign_in("a@b.co", "x").await.unwrap_err().code,
            AuthErrorCode::NotConfigured
        );
    }

    #[tokio::test]
    async fn sign_in_saves_the_session_and_resolves_the_workspace() {
        let store = Arc::new(MemoryStore::default());
        let uc = usecase(
            FakeAuth::default(),
            store.clone(),
            Arc::new(FakeCloud::default()),
        );

        assert_eq!(
            uc.sign_in("ana@example.com", "wrong")
                .await
                .unwrap_err()
                .code,
            AuthErrorCode::InvalidCredentials
        );
        let state = uc
            .sign_in("ana@example.com", "right-password")
            .await
            .unwrap();
        assert_eq!(state.user.unwrap().id, "u1");
        assert_eq!(state.workspace.unwrap().role, "owner");
        assert!(store.load().unwrap().is_some(), "session persisted");

        uc.sign_out().await.unwrap();
        assert!(store.load().unwrap().is_none(), "session cleared");
        assert!(uc.state().await.user.is_none());
    }

    #[tokio::test]
    async fn validates_input_before_calling_the_provider() {
        let uc = usecase(
            FakeAuth::default(),
            Arc::new(MemoryStore::default()),
            Arc::new(FakeCloud::default()),
        );
        assert_eq!(
            uc.sign_in("not-an-email", "x").await.unwrap_err().code,
            AuthErrorCode::InvalidInput
        );
        assert_eq!(
            uc.sign_up("ana@example.com", "short", None)
                .await
                .unwrap_err()
                .code,
            AuthErrorCode::WeakPassword
        );
    }

    #[tokio::test]
    async fn sign_up_reports_when_email_confirmation_is_required() {
        let uc = usecase(
            FakeAuth {
                signup_confirms: true,
                ..Default::default()
            },
            Arc::new(MemoryStore::default()),
            Arc::new(FakeCloud::default()),
        );
        assert_eq!(
            uc.sign_up("ana@example.com", "long-enough", Some("Ana"))
                .await
                .unwrap(),
            SignUpResult::ConfirmEmail
        );
    }

    #[tokio::test]
    async fn restores_a_saved_session_and_refreshes_it_when_expired() {
        let store = Arc::new(MemoryStore::default());
        store.save(&session(now() - 10)).unwrap();
        let uc = usecase(
            FakeAuth::default(),
            store.clone(),
            Arc::new(FakeCloud::default()),
        );
        let (token, _) = uc.access_token().await.unwrap();
        assert_ne!(
            token,
            format!("access-{}", now() - 10),
            "expired token was refreshed"
        );
        assert!(store.load().unwrap().unwrap().expires_at > now() + 3600);
    }

    #[tokio::test]
    async fn a_rejected_refresh_signs_the_user_out() {
        let store = Arc::new(MemoryStore::default());
        store.save(&session(now() - 10)).unwrap();
        let uc = usecase(
            FakeAuth {
                refresh_fails: true,
                ..Default::default()
            },
            store.clone(),
            Arc::new(FakeCloud::default()),
        );
        assert!(uc.state().await.user.is_none());
        assert!(store.load().unwrap().is_none());
    }

    #[tokio::test]
    async fn import_sends_batches_with_projects_only_once() {
        let dir = std::env::temp_dir().join(format!("roxi-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("meeting_history.db");
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (project_id INTEGER PRIMARY KEY, name TEXT, code TEXT, description TEXT, created_at TEXT, archived_at TEXT);
             CREATE TABLE meetings (id INTEGER PRIMARY KEY, start_time DATETIME, name TEXT);
             INSERT INTO projects VALUES (1, 'Unsorted', 'GEN', NULL, NULL, NULL);",
        )
        .unwrap();
        for i in 1..=12 {
            conn.execute("INSERT INTO meetings (id, name) VALUES (?1, 'm')", [i])
                .unwrap();
        }
        drop(conn);

        let store = Arc::new(MemoryStore::default());
        store.save(&session(now() + 3600)).unwrap();
        let cloud = Arc::new(FakeCloud::default());
        let uc = AccountUseCase::new(
            Some(Arc::new(FakeAuth::default())),
            store,
            cloud.clone(),
            LocalHistory::new(&db),
        );

        let seen = StdMutex::new(Vec::new());
        let result = uc
            .import_local_history(|p| seen.lock().unwrap().push(p.processed))
            .await
            .unwrap();

        assert_eq!(
            result,
            ImportProgress {
                total: 12,
                processed: 12,
                imported: 12,
                skipped: 0
            }
        );
        assert_eq!(*seen.lock().unwrap(), vec![0, 10, 12]);
        let batches = cloud.batches.lock().unwrap();
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0]["projects"].as_array().unwrap().len(), 1);
        assert!(batches[1]["projects"].as_array().unwrap().is_empty());
        assert_eq!(batches[0]["device_id"], "device-1");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn import_requires_a_signed_in_user() {
        let uc = usecase(
            FakeAuth::default(),
            Arc::new(MemoryStore::default()),
            Arc::new(FakeCloud::default()),
        );
        assert!(uc.import_local_history(|_| {}).await.is_err());
    }
}
