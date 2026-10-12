//! The free trial: five minutes of live capture per Mac, then an upgrade.
//!
//! Paid plans (`pro`, `team`, `enterprise`) are never metered, and neither are
//! admins: the app owner (`ROXI_HISTORY_OWNER_EMAIL`) plus anyone listed in
//! `ROXI_ADMIN_EMAILS`, matched on the signed-in email. Everyone else —
//! a `free` workspace, a signed-in user whose workspace failed to load, and
//! local-only mode — shares one allowance per Mac, so signing up again does
//! not reset it.
//!
//! Time is written to disk every few seconds while a capture runs (see
//! `commands::capture`), so quitting mid-meeting loses at most one tick.
//!
//! This is a client-side meter. Anyone who can edit files on their own Mac can
//! reset it; the real limit belongs on the server's STT token route once
//! billing is live.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

/// Five minutes.
pub const TRIAL_SECONDS: u64 = 5 * 60;

/// Plans that capture without a limit. Mirrors the `orgs.plan` check in
/// `server/migrations/0001_tenancy.sql`.
const PAID_PLANS: &[&str] = &["pro", "team", "enterprise"];

/// What the app shows about the trial. Mirrored by `src/shared/types/billing.ts`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrialStatus {
    /// The workspace plan, or `free` when there is no workspace.
    pub plan: String,
    /// True on a paid plan, for an admin, or with the developer override: no
    /// meter at all.
    pub unlimited: bool,
    /// The signed-in account is the app owner or a listed admin.
    pub admin: bool,
    pub limit_seconds: u64,
    pub used_seconds: u64,
    pub remaining_seconds: u64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Ledger {
    used_seconds: u64,
}

struct Meter {
    used_seconds: u64,
    /// Set while a metered capture runs: the last moment already counted.
    counted_until: Option<Instant>,
    /// Bumped on every `begin`, so a timer left over from an earlier capture
    /// can tell it no longer owns the session.
    generation: u64,
}

pub struct TrialUseCase {
    path: PathBuf,
    /// `ROXI_TRIAL_DISABLED=1` in the root `.env` — for developing Roxi itself.
    disabled: bool,
    /// Lowercased emails that always have full access.
    admin_emails: Vec<String>,
    meter: Mutex<Meter>,
}

impl TrialUseCase {
    pub fn new(path: PathBuf) -> Self {
        let used_seconds = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Ledger>(&text).ok())
            .map(|ledger| ledger.used_seconds)
            .unwrap_or(0);
        Self {
            path,
            disabled: false,
            admin_emails: Vec::new(),
            meter: Mutex::new(Meter {
                used_seconds,
                counted_until: None,
                generation: 0,
            }),
        }
    }

    pub fn from_env(path: PathBuf) -> Self {
        let disabled = matches!(
            std::env::var("ROXI_TRIAL_DISABLED").map(|v| v.trim().to_ascii_lowercase()),
            Ok(v) if v == "1" || v == "true" || v == "yes"
        );
        if disabled {
            tracing::warn!("[trial] ROXI_TRIAL_DISABLED is set; capture time is not metered");
        }
        let admins = [
            std::env::var("ROXI_HISTORY_OWNER_EMAIL").unwrap_or_default(),
            std::env::var("ROXI_ADMIN_EMAILS").unwrap_or_default(),
        ];
        Self {
            disabled,
            ..Self::new(path)
        }
        .with_admins(admins.iter().flat_map(|v| v.split(',')))
    }

    /// Emails that always get full access. Blank entries are ignored.
    pub fn with_admins<'a>(mut self, emails: impl IntoIterator<Item = &'a str>) -> Self {
        self.admin_emails = emails
            .into_iter()
            .map(|e| e.trim().to_ascii_lowercase())
            .filter(|e| !e.is_empty())
            .collect();
        self
    }

    pub fn is_admin(&self, email: Option<&str>) -> bool {
        email
            .map(|e| e.trim().to_ascii_lowercase())
            .is_some_and(|e| !e.is_empty() && self.admin_emails.contains(&e))
    }

    pub fn is_unlimited(&self, plan: Option<&str>, email: Option<&str>) -> bool {
        self.disabled || self.is_admin(email) || plan.is_some_and(|p| PAID_PLANS.contains(&p))
    }

    pub fn status(&self, plan: Option<&str>, email: Option<&str>) -> TrialStatus {
        self.status_at(plan, email, Instant::now())
    }

    fn status_at(&self, plan: Option<&str>, email: Option<&str>, now: Instant) -> TrialStatus {
        let used = {
            let meter = self.meter.lock().unwrap_or_else(|p| p.into_inner());
            meter.used_seconds + uncounted(&meter, now)
        }
        .min(TRIAL_SECONDS);
        TrialStatus {
            plan: plan.unwrap_or("free").to_string(),
            unlimited: self.is_unlimited(plan, email),
            admin: self.is_admin(email),
            limit_seconds: TRIAL_SECONDS,
            used_seconds: used,
            remaining_seconds: TRIAL_SECONDS - used,
        }
    }

    /// Starts metering a capture. Returns the generation the caller's timer
    /// must pass back to `checkpoint`.
    pub fn begin(&self) -> u64 {
        self.begin_at(Instant::now())
    }

    fn begin_at(&self, now: Instant) -> u64 {
        // A capture that ended without `end` (a crash) is counted up to now.
        self.commit(now);
        let mut meter = self.meter.lock().unwrap_or_else(|p| p.into_inner());
        meter.counted_until = Some(now);
        meter.generation += 1;
        meter.generation
    }

    /// Counts the time since the last checkpoint and saves it. Returns the
    /// seconds left, or `None` once `generation` no longer owns the capture.
    pub fn checkpoint(&self, generation: u64) -> Option<u64> {
        self.checkpoint_at(generation, Instant::now())
    }

    fn checkpoint_at(&self, generation: u64, now: Instant) -> Option<u64> {
        {
            let meter = self.meter.lock().unwrap_or_else(|p| p.into_inner());
            if meter.generation != generation || meter.counted_until.is_none() {
                return None;
            }
        }
        Some(TRIAL_SECONDS.saturating_sub(self.commit(now)))
    }

    /// Stops metering. Idempotent, and a no-op for unmetered captures.
    pub fn end(&self) {
        self.end_at(Instant::now());
    }

    fn end_at(&self, now: Instant) {
        self.commit(now);
        self.meter
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .counted_until = None;
    }

    /// Folds uncounted time into the total and writes it. Returns the total.
    fn commit(&self, now: Instant) -> u64 {
        let used = {
            let mut meter = self.meter.lock().unwrap_or_else(|p| p.into_inner());
            let extra = uncounted(&meter, now);
            if extra == 0 {
                return meter.used_seconds;
            }
            meter.used_seconds = (meter.used_seconds + extra).min(TRIAL_SECONDS);
            // Advance by whole seconds only, so fractions carry to the next tick.
            if let Some(since) = meter.counted_until.as_mut() {
                *since += std::time::Duration::from_secs(extra);
            }
            meter.used_seconds
        };
        if let Err(e) = self.save(used) {
            tracing::warn!("[trial] could not save trial usage: {e:#}");
        }
        used
    }

    fn save(&self, used_seconds: u64) -> anyhow::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&self.path, serde_json::to_string(&Ledger { used_seconds })?)?;
        Ok(())
    }
}

fn uncounted(meter: &Meter, now: Instant) -> u64 {
    meter
        .counted_until
        .map(|since| now.saturating_duration_since(since).as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn ledger_path(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("roxi-trial-{name}-{}.json", uuid::Uuid::new_v4()));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn a_new_mac_has_the_full_five_minutes() {
        let trial = TrialUseCase::new(ledger_path("fresh"));
        let status = trial.status(None, None);
        assert_eq!(status.plan, "free");
        assert!(!status.unlimited);
        assert_eq!(status.remaining_seconds, 300);
    }

    #[test]
    fn paid_plans_are_never_metered() {
        let trial = TrialUseCase::new(ledger_path("paid"));
        assert!(trial.is_unlimited(Some("pro"), None));
        assert!(trial.is_unlimited(Some("team"), None));
        assert!(trial.is_unlimited(Some("enterprise"), None));
        assert!(!trial.is_unlimited(Some("free"), None));
        assert!(!trial.is_unlimited(None, None));
    }

    #[test]
    fn the_owner_and_listed_admins_have_full_access_on_any_plan() {
        let trial = TrialUseCase::new(ledger_path("admin")).with_admins([
            "Owner@Example.com",
            " ",
            "second@example.com",
        ]);
        assert!(trial.is_unlimited(Some("free"), Some("owner@example.com")));
        assert!(trial.is_unlimited(None, Some("  SECOND@example.com ")));
        assert!(!trial.is_unlimited(Some("free"), Some("someone@example.com")));
        assert!(!trial.is_unlimited(None, None));
        assert!(!trial.is_admin(Some("")));

        let status = trial.status(Some("free"), Some("owner@example.com"));
        assert!(status.admin && status.unlimited);
    }

    #[test]
    fn capture_time_is_counted_and_survives_a_restart() {
        let path = ledger_path("restart");
        let trial = TrialUseCase::new(path.clone());
        let t0 = Instant::now();
        let generation = trial.begin_at(t0);
        assert_eq!(
            trial.checkpoint_at(generation, t0 + Duration::from_secs(90)),
            Some(210)
        );
        trial.end_at(t0 + Duration::from_secs(120));

        let reopened = TrialUseCase::new(path);
        assert_eq!(reopened.status(None, None).used_seconds, 120);
    }

    #[test]
    fn the_allowance_runs_out_at_five_minutes() {
        let trial = TrialUseCase::new(ledger_path("exhaust"));
        let t0 = Instant::now();
        let generation = trial.begin_at(t0);
        assert_eq!(
            trial.checkpoint_at(generation, t0 + Duration::from_secs(400)),
            Some(0)
        );
        assert_eq!(
            trial
                .status_at(None, None, t0 + Duration::from_secs(400))
                .remaining_seconds,
            0
        );
    }

    #[test]
    fn a_stale_timer_does_not_own_the_next_capture() {
        let trial = TrialUseCase::new(ledger_path("stale"));
        let t0 = Instant::now();
        let first = trial.begin_at(t0);
        trial.end_at(t0 + Duration::from_secs(10));
        let second = trial.begin_at(t0 + Duration::from_secs(20));
        assert_eq!(
            trial.checkpoint_at(first, t0 + Duration::from_secs(30)),
            None
        );
        assert_eq!(
            trial.checkpoint_at(second, t0 + Duration::from_secs(30)),
            Some(280)
        );
    }

    #[test]
    fn partial_seconds_carry_over_between_ticks() {
        let trial = TrialUseCase::new(ledger_path("fraction"));
        let t0 = Instant::now();
        let generation = trial.begin_at(t0);
        trial.checkpoint_at(generation, t0 + Duration::from_millis(1500));
        trial.checkpoint_at(generation, t0 + Duration::from_millis(3000));
        assert_eq!(
            trial
                .status_at(None, None, t0 + Duration::from_millis(3000))
                .used_seconds,
            3
        );
    }
}
