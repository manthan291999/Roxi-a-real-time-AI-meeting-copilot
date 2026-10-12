//! Browser pages for links in Supabase's auth emails.
//!
//! Roxi is a desktop app with no website, so without this a confirmation link
//! lands on the project's default Site URL (`localhost:3000`) and shows a
//! connection error even though the confirmation worked.
//!
//! Supabase puts the outcome in the URL fragment (`#access_token=…` on
//! success, `#error_code=…` on failure). A fragment never reaches a server, so
//! the page reads it in the browser, shows a fixed message for the outcome,
//! and then strips it from the address bar: it holds a live session token the
//! user should not bookmark or share. Nothing from the fragment is echoed into
//! the page.

use axum::http::header;
use axum::response::{Html, IntoResponse};

/// The page's one inline script and inline styles are its only content, so
/// everything else (network, frames, forms) is refused.
const CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

pub async fn email_confirmed() -> impl IntoResponse {
    (
        [
            (header::CONTENT_SECURITY_POLICY, CSP),
            (header::CACHE_CONTROL, "no-store"),
            (header::REFERRER_POLICY, "no-referrer"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Html(EMAIL_CONFIRMED_PAGE),
    )
}

const EMAIL_CONFIRMED_PAGE: &str = r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Roxi · Email confirmed</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #15133B; color: #fff; font: 16px/1.55 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  main { max-width: 440px; padding: 40px 32px; text-align: center; }
  .mark { width: 56px; height: 56px; margin: 0 auto 24px; border-radius: 16px; background: #4338CA;
          display: flex; align-items: center; justify-content: center; }
  h1 { margin: 0 0 12px; font: 500 34px/1.15 "New York", Georgia, serif; letter-spacing: -0.015em; }
  p { margin: 0; color: rgba(255,255,255,.74); }
  .hint { margin-top: 20px; font-size: 13px; color: rgba(255,255,255,.6); }
  [hidden] { display: none; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>
  </div>
  <section id="ok">
    <h1>Email confirmed</h1>
    <p>Your Roxi account is ready. Go back to the Roxi app and sign in with your email and password.</p>
    <p class="hint">You can close this tab.</p>
  </section>
  <section id="expired" hidden>
    <h1>This link has expired</h1>
    <p>Confirmation links work once and only for a short time. In Roxi, choose “Resend email” on the sign-in screen to get a new one.</p>
  </section>
  <section id="failed" hidden>
    <h1>We couldn't confirm this link</h1>
    <p>Go back to Roxi and try signing in. If it says your email isn't confirmed, choose “Resend confirmation email”.</p>
  </section>
</main>
<script>
  (function () {
    var params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
    var code = params.get('error_code') || params.get('error');
    if (code) {
      document.getElementById('ok').hidden = true;
      document.getElementById(code === 'otp_expired' ? 'expired' : 'failed').hidden = false;
    }
    // The fragment carries a session token: keep it out of history and bookmarks.
    if (location.hash || location.search) history.replaceState(null, '', location.pathname);
  })();
</script>
</body>
</html>
"##;
