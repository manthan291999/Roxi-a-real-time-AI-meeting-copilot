//! Browser-based sign-in, start to finish: PKCE, the loopback redirect, the
//! browser hand-off, and the code exchange.
//!
//! Produces an `AuthSession` and nothing else; `AccountUseCase` decides what
//! signing in means (saving the session, resolving the workspace).

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

use crate::domain::account::{AuthError, AuthErrorCode, AuthSession};
use crate::domain::federated::{FederatedMethod, SignInMethods};
use crate::domain::pkce::Pkce;
use crate::ports::federated_auth::{
    BrowserLauncher, FederatedAuthProvider, RedirectListener, RedirectParams,
};

/// Long enough for MFA and a slow SSO page; short enough that a forgotten
/// tab does not hold a listening port open all day.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct FederatedSignIn {
    provider: Arc<dyn FederatedAuthProvider>,
    browser: Arc<dyn BrowserLauncher>,
    redirects: Arc<dyn RedirectListener>,
    methods: SignInMethods,
    timeout: Duration,
    /// Cancels the sign-in in progress, if any. Only one runs at a time:
    /// starting another cancels the first.
    cancel: Mutex<Option<oneshot::Sender<()>>>,
}

impl FederatedSignIn {
    pub fn new(
        provider: Arc<dyn FederatedAuthProvider>,
        browser: Arc<dyn BrowserLauncher>,
        redirects: Arc<dyn RedirectListener>,
        methods: SignInMethods,
    ) -> Self {
        Self {
            provider,
            browser,
            redirects,
            methods,
            timeout: SIGN_IN_TIMEOUT,
            cancel: Mutex::new(None),
        }
    }

    #[cfg(test)]
    fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn methods(&self) -> &SignInMethods {
        &self.methods
    }

    pub async fn run(&self, method: &FederatedMethod) -> Result<AuthSession, AuthError> {
        if !self.methods.allows(method) {
            return Err(AuthError::new(
                AuthErrorCode::NotConfigured,
                "That sign-in option isn't available in this build of Roxi.",
            ));
        }

        let pkce = Pkce::generate();
        // The unguessable path is the `state` check: only the browser we sent
        // can know it, so a forged redirect never reaches the exchange.
        let pending = self
            .redirects
            .listen(&format!("/auth/callback/{}", Uuid::new_v4().simple()))
            .await?;
        let url = self
            .provider
            .authorization_url(method, pending.redirect_url(), &pkce.challenge)
            .await?;

        let (cancel_tx, cancel_rx) = oneshot::channel();
        if let Some(previous) = self.cancel.lock().await.replace(cancel_tx) {
            let _ = previous.send(());
        }

        self.browser.open(&url)?;

        let outcome = tokio::select! {
            params = pending.wait() => params,
            _ = cancel_rx => Err(AuthError::cancelled()),
            _ = tokio::time::sleep(self.timeout) => Err(AuthError::new(
                AuthErrorCode::Cancelled,
                "Sign-in timed out. Start again when you're ready.",
            )),
        };
        self.cancel.lock().await.take();

        let code = code_from(outcome?)?;
        self.provider.exchange_code(&code, &pkce.verifier).await
    }

    /// Stops a sign-in waiting on the browser. Harmless when none is.
    pub async fn cancel(&self) {
        if let Some(tx) = self.cancel.lock().await.take() {
            let _ = tx.send(());
        }
    }
}

/// The authorization code, or the reason the identity service gave for none.
fn code_from(params: RedirectParams) -> Result<String, AuthError> {
    if let Some(code) = params.code.filter(|c| !c.is_empty()) {
        return Ok(code);
    }
    match params.error.as_deref() {
        Some("access_denied") => Err(AuthError::cancelled()),
        Some(error) => {
            tracing::warn!(
                "[auth] federated sign-in failed: {error}: {}",
                params.error_description.as_deref().unwrap_or("")
            );
            Err(AuthError::new(
                AuthErrorCode::Unknown,
                "Sign-in didn't finish. Try again, or use your email and password.",
            ))
        }
        None => Err(AuthError::new(
            AuthErrorCode::Unknown,
            "Sign-in came back without a code. Try again.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::account::AccountUser;
    use crate::domain::federated::OAuthProvider;
    use crate::ports::federated_auth::PendingRedirect;
    use async_trait::async_trait;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct FakeProvider {
        exchanged: StdMutex<Vec<(String, String)>>,
    }

    #[async_trait]
    impl FederatedAuthProvider for FakeProvider {
        async fn authorization_url(
            &self,
            _: &FederatedMethod,
            redirect_to: &str,
            challenge: &str,
        ) -> Result<String, AuthError> {
            Ok(format!(
                "https://idp.example/authorize?redirect_to={redirect_to}&challenge={challenge}"
            ))
        }

        async fn exchange_code(
            &self,
            code: &str,
            verifier: &str,
        ) -> Result<AuthSession, AuthError> {
            self.exchanged
                .lock()
                .unwrap()
                .push((code.into(), verifier.into()));
            Ok(AuthSession {
                access_token: "a".into(),
                refresh_token: "r".into(),
                expires_at: i64::MAX,
                user: AccountUser {
                    id: "u1".into(),
                    email: Some("ana@acme.com".into()),
                    full_name: None,
                },
            })
        }
    }

    #[derive(Default)]
    struct FakeBrowser {
        opened: StdMutex<Vec<String>>,
    }

    impl BrowserLauncher for FakeBrowser {
        fn open(&self, url: &str) -> Result<(), AuthError> {
            self.opened.lock().unwrap().push(url.into());
            Ok(())
        }
    }

    /// Answers with `params` at once, or never when `None`.
    struct FakeRedirects(Option<RedirectParams>);

    struct FakePending(Option<RedirectParams>);

    #[async_trait]
    impl RedirectListener for FakeRedirects {
        async fn listen(&self, _: &str) -> Result<Box<dyn PendingRedirect>, AuthError> {
            Ok(Box::new(FakePending(self.0.clone())))
        }
    }

    #[async_trait]
    impl PendingRedirect for FakePending {
        fn redirect_url(&self) -> &str {
            "http://127.0.0.1:1/auth/callback/x"
        }

        async fn wait(self: Box<Self>) -> Result<RedirectParams, AuthError> {
            match self.0 {
                Some(params) => Ok(params),
                None => std::future::pending().await,
            }
        }
    }

    const AZURE: FederatedMethod = FederatedMethod::OAuth(OAuthProvider::Azure);

    fn sign_in(
        redirect: Option<RedirectParams>,
    ) -> (FederatedSignIn, Arc<FakeProvider>, Arc<FakeBrowser>) {
        let provider = Arc::new(FakeProvider::default());
        let browser = Arc::new(FakeBrowser::default());
        let methods = SignInMethods {
            providers: vec![OAuthProvider::Azure],
            company_sso: false,
        };
        let flow = FederatedSignIn::new(
            provider.clone(),
            browser.clone(),
            Arc::new(FakeRedirects(redirect)),
            methods,
        );
        (flow, provider, browser)
    }

    fn code(code: &str) -> Option<RedirectParams> {
        Some(RedirectParams {
            code: Some(code.into()),
            ..Default::default()
        })
    }

    #[tokio::test]
    async fn exchanges_the_code_with_the_verifier_that_matches_the_challenge() {
        let (flow, provider, browser) = sign_in(code("abc"));
        let session = flow.run(&AZURE).await.unwrap();
        assert_eq!(session.user.id, "u1");

        let opened = browser.opened.lock().unwrap()[0].clone();
        let (code, verifier) = provider.exchanged.lock().unwrap()[0].clone();
        assert_eq!(code, "abc");
        assert!(opened.ends_with(&format!(
            "challenge={}",
            Pkce::from_verifier(verifier).challenge
        )));
    }

    #[tokio::test]
    async fn refuses_methods_this_build_does_not_offer() {
        let (flow, _, browser) = sign_in(code("abc"));
        let err = flow
            .run(&FederatedMethod::CompanySso {
                domain: "acme.com".into(),
            })
            .await
            .unwrap_err();
        assert_eq!(err.code, AuthErrorCode::NotConfigured);
        assert!(browser.opened.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn treats_a_denied_consent_as_cancelled() {
        let (flow, provider, _) = sign_in(Some(RedirectParams {
            error: Some("access_denied".into()),
            ..Default::default()
        }));
        assert_eq!(
            flow.run(&AZURE).await.unwrap_err().code,
            AuthErrorCode::Cancelled
        );
        assert!(provider.exchanged.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn can_be_cancelled_while_waiting_for_the_browser() {
        let (flow, _, _) = sign_in(None);
        let flow = Arc::new(flow);
        let running = tokio::spawn({
            let flow = flow.clone();
            async move { flow.run(&AZURE).await }
        });
        // Let `run` reach the wait before cancelling.
        while flow.cancel.lock().await.is_none() {
            tokio::task::yield_now().await;
        }
        flow.cancel().await;
        assert_eq!(
            running.await.unwrap().unwrap_err().code,
            AuthErrorCode::Cancelled
        );
    }

    #[tokio::test]
    async fn gives_up_after_the_timeout() {
        let (flow, _, _) = sign_in(None);
        let flow = flow.with_timeout(Duration::from_millis(20));
        let err = flow.run(&AZURE).await.unwrap_err();
        assert_eq!(err.code, AuthErrorCode::Cancelled);
        assert!(err.message.contains("timed out"));
    }
}
