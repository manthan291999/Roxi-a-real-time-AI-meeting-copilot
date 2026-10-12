//! The one place that knows who is signed in, for code that is not async.
//!
//! `AccountUseCase` writes it on every sign-in and sign-out; the history
//! readers, capture and chat read it through `CurrentAccount`. It is created
//! before either side so neither has to depend on the other.

use std::sync::RwLock;

use crate::ports::account_scope::{CurrentAccount, MeetingScope};

pub struct AccountScopeCell {
    /// False in local-only mode, where every meeting is visible.
    accounts_enabled: bool,
    user_id: RwLock<Option<String>>,
}

impl AccountScopeCell {
    pub fn new(accounts_enabled: bool) -> Self {
        Self {
            accounts_enabled,
            user_id: RwLock::new(None),
        }
    }

    pub fn set_user(&self, user_id: Option<&str>) {
        let mut slot = self
            .user_id
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot = user_id.map(str::to_string);
    }
}

impl CurrentAccount for AccountScopeCell {
    fn meeting_scope(&self) -> MeetingScope {
        if !self.accounts_enabled {
            return MeetingScope::Everyone;
        }
        let slot = self
            .user_id
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match slot.as_deref() {
            Some(id) => MeetingScope::Account(id.to_string()),
            None => MeetingScope::Nobody,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_only_mode_sees_everything_whoever_is_set() {
        let cell = AccountScopeCell::new(false);
        cell.set_user(Some("u1"));
        assert_eq!(cell.meeting_scope(), MeetingScope::Everyone);
    }

    #[test]
    fn follows_sign_in_and_sign_out() {
        let cell = AccountScopeCell::new(true);
        assert_eq!(cell.meeting_scope(), MeetingScope::Nobody);
        cell.set_user(Some("u1"));
        assert_eq!(cell.meeting_scope(), MeetingScope::Account("u1".into()));
        cell.set_user(None);
        assert_eq!(cell.meeting_scope(), MeetingScope::Nobody);
    }
}
