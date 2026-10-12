//! Signing in through someone else's identity system: a social / work
//! provider (Microsoft, Google) or the company's own SSO.

use serde::{Deserialize, Serialize};

use super::account::{AuthError, AuthErrorCode};

/// Identity providers Roxi can offer. The serialized names are Supabase's
/// provider ids, and the frontend's too.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OAuthProvider {
    Azure,
    Google,
}

impl OAuthProvider {
    pub fn id(self) -> &'static str {
        match self {
            Self::Azure => "azure",
            Self::Google => "google",
        }
    }

    /// Scopes to ask for beyond the provider's defaults. Azure omits the
    /// email claim unless asked, and Supabase needs it to match accounts.
    pub fn extra_scopes(self) -> Option<&'static str> {
        match self {
            Self::Azure => Some("email"),
            Self::Google => None,
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        match id.trim().to_ascii_lowercase().as_str() {
            "azure" | "microsoft" => Some(Self::Azure),
            "google" => Some(Self::Google),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FederatedMethod {
    OAuth(OAuthProvider),
    /// SAML SSO, found by the domain of the user's work email.
    CompanySso {
        domain: String,
    },
}

impl FederatedMethod {
    /// Company SSO for the domain of `email` (`ana@acme.com` → `acme.com`).
    pub fn company_sso_for_email(email: &str) -> Result<Self, AuthError> {
        let domain = email
            .trim()
            .rsplit_once('@')
            .map(|(local, domain)| (local, domain.trim().to_ascii_lowercase()))
            .filter(|(local, domain)| {
                !local.is_empty() && domain.contains('.') && !domain.ends_with('.')
            })
            .map(|(_, domain)| domain)
            .ok_or_else(|| {
                AuthError::new(
                    AuthErrorCode::InvalidInput,
                    "Enter your work email so we can find your company's sign-in.",
                )
            })?;
        Ok(Self::CompanySso { domain })
    }
}

/// Which federated options this build offers. Empty means the sign-in screen
/// shows email and password only.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignInMethods {
    pub providers: Vec<OAuthProvider>,
    pub company_sso: bool,
}

impl SignInMethods {
    pub fn allows(&self, method: &FederatedMethod) -> bool {
        match method {
            FederatedMethod::OAuth(p) => self.providers.contains(p),
            FederatedMethod::CompanySso { .. } => self.company_sso,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_domain_of_a_work_email() {
        assert_eq!(
            FederatedMethod::company_sso_for_email(" Ana@Acme.COM ").unwrap(),
            FederatedMethod::CompanySso {
                domain: "acme.com".into()
            }
        );
        for bad in ["", "ana", "@acme.com", "ana@acme", "ana@acme."] {
            assert_eq!(
                FederatedMethod::company_sso_for_email(bad)
                    .unwrap_err()
                    .code,
                AuthErrorCode::InvalidInput,
                "{bad}"
            );
        }
    }

    #[test]
    fn allows_only_the_configured_methods() {
        let methods = SignInMethods {
            providers: vec![OAuthProvider::Azure],
            company_sso: false,
        };
        assert!(methods.allows(&FederatedMethod::OAuth(OAuthProvider::Azure)));
        assert!(!methods.allows(&FederatedMethod::OAuth(OAuthProvider::Google)));
        assert!(!methods.allows(&FederatedMethod::CompanySso {
            domain: "acme.com".into()
        }));
    }

    #[test]
    fn parses_provider_names() {
        assert_eq!(
            OAuthProvider::parse(" Microsoft "),
            Some(OAuthProvider::Azure)
        );
        assert_eq!(OAuthProvider::parse("google"), Some(OAuthProvider::Google));
        assert_eq!(OAuthProvider::parse("github"), None);
        assert_eq!(serde_json::to_value(OAuthProvider::Azure).unwrap(), "azure");
    }
}
