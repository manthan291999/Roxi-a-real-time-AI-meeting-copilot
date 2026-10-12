//! Session storage in the native OS credential store.
//!
//! The refresh token is a long-lived credential, so it goes where the OS
//! protects it rather than in `tauri-plugin-store`'s plain JSON file.

use keyring::Entry;

use crate::domain::account::AuthSession;
use crate::ports::auth::SessionStore;

/// Matches the bundle identifier so entries are recognisable in the platform
/// credential manager (Keychain, Credential Manager, or Secret Service).
const SERVICE: &str = "com.manth.roxi";
const SESSION_ACCOUNT: &str = "auth-session";
const DEVICE_ACCOUNT: &str = "device-id";

pub struct KeychainSessionStore;

impl KeychainSessionStore {
    fn entry(account: &str) -> anyhow::Result<Entry> {
        Ok(Entry::new(SERVICE, account)?)
    }
}

impl SessionStore for KeychainSessionStore {
    fn load(&self) -> anyhow::Result<Option<AuthSession>> {
        match Self::entry(SESSION_ACCOUNT)?.get_password() {
            Ok(json) => Ok(serde_json::from_str(&json).ok()),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn save(&self, session: &AuthSession) -> anyhow::Result<()> {
        Self::entry(SESSION_ACCOUNT)?.set_password(&serde_json::to_string(session)?)?;
        Ok(())
    }

    fn clear(&self) -> anyhow::Result<()> {
        match Self::entry(SESSION_ACCOUNT)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    fn device_id(&self) -> anyhow::Result<String> {
        let entry = Self::entry(DEVICE_ACCOUNT)?;
        match entry.get_password() {
            Ok(id) if !id.trim().is_empty() => Ok(id),
            Ok(_) | Err(keyring::Error::NoEntry) => {
                let id = uuid::Uuid::new_v4().to_string();
                entry.set_password(&id)?;
                Ok(id)
            }
            Err(e) => Err(e.into()),
        }
    }
}
