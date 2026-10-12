//! Whose local meetings a read may see.
//!
//! `meeting_history.db` is one file per Mac, shared by every account that
//! signs in on it. Each meeting row carries the `account_id` that recorded
//! it; every read of local history goes through this scope so one account
//! never sees another's meetings.

/// Which local meetings are visible right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MeetingScope {
    /// Local-only mode: accounts are not set up, so every meeting on this
    /// Mac is visible, exactly as before accounts existed.
    Everyone,
    /// Signed in: only the meetings this account owns.
    Account(String),
    /// Accounts are set up but nobody is signed in: nothing is visible.
    Nobody,
}

impl MeetingScope {
    /// The account new meetings are stamped with; `None` stamps no owner.
    pub fn owner(&self) -> Option<&str> {
        match self {
            Self::Account(id) => Some(id),
            Self::Everyone | Self::Nobody => None,
        }
    }
}

/// Read side: anything that reads local history asks this for the scope.
pub trait CurrentAccount: Send + Sync {
    fn meeting_scope(&self) -> MeetingScope;
}

/// Hands meetings recorded before accounts existed (no owner) to one
/// designated account, on that account's sign-in.
pub trait UnownedHistoryClaim: Send + Sync {
    /// Assigns every unowned meeting to `user_id` if `email` is the
    /// designated owner. Returns how many meetings were assigned.
    fn claim_if_owner(&self, user_id: &str, email: Option<&str>) -> anyhow::Result<usize>;
}

/// For tests and tools that should see everything.
pub struct Unscoped;

impl CurrentAccount for Unscoped {
    fn meeting_scope(&self) -> MeetingScope {
        MeetingScope::Everyone
    }
}
