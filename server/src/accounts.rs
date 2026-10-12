//! Local account records for Supabase users.
//!
//! Supabase owns sign-up and login; this module only mirrors the user and
//! gives them an org. The first authenticated request from a new user creates
//! their row plus a personal org they own, so there is no separate
//! "complete sign-up" step for the app to get wrong.

use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::Claims;

#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub user_id: Uuid,
    pub email: Option<String>,
    pub org_id: Uuid,
    pub org_name: String,
    pub role: String,
    pub plan: String,
}

#[derive(sqlx::FromRow)]
struct OrgRow {
    org_id: Uuid,
    org_name: String,
    role: String,
    plan: String,
}

/// Upsert the user and return their current org, creating one if needed.
///
/// A user in several orgs gets the oldest membership for now; choosing an
/// org belongs with team invites, which come later.
pub async fn ensure_account(pool: &PgPool, claims: &Claims) -> sqlx::Result<Account> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO users (id, email) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, last_seen_at = now()",
    )
    .bind(claims.sub)
    .bind(&claims.email)
    .execute(&mut *tx)
    .await?;

    // Lock the user row so two concurrent first requests cannot both decide
    // there is no org and create two.
    sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;

    let existing: Option<OrgRow> = sqlx::query_as(
        "SELECT o.id AS org_id, o.name AS org_name, m.role, o.plan
           FROM memberships m JOIN orgs o ON o.id = m.org_id
          WHERE m.user_id = $1
          ORDER BY m.created_at, o.id
          LIMIT 1",
    )
    .bind(claims.sub)
    .fetch_optional(&mut *tx)
    .await?;

    let org = match existing {
        Some(org) => org,
        None => {
            let name = personal_org_name(claims.email.as_deref());
            let (org_id, plan): (Uuid, String) =
                sqlx::query_as("INSERT INTO orgs (name) VALUES ($1) RETURNING id, plan")
                    .bind(&name)
                    .fetch_one(&mut *tx)
                    .await?;
            sqlx::query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')")
                .bind(org_id)
                .bind(claims.sub)
                .execute(&mut *tx)
                .await?;
            OrgRow { org_id, org_name: name, role: "owner".into(), plan }
        }
    };

    tx.commit().await?;
    Ok(Account {
        user_id: claims.sub,
        email: claims.email.clone(),
        org_id: org.org_id,
        org_name: org.org_name,
        role: org.role,
        plan: org.plan,
    })
}

fn personal_org_name(email: Option<&str>) -> String {
    match email.and_then(|e| e.split('@').next()).map(str::trim).filter(|s| !s.is_empty()) {
        Some(local) => format!("{local}'s workspace"),
        None => "My workspace".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::personal_org_name;

    #[test]
    fn names_the_personal_org_after_the_email() {
        assert_eq!(personal_org_name(Some("ana@example.com")), "ana's workspace");
        assert_eq!(personal_org_name(Some("@example.com")), "My workspace");
        assert_eq!(personal_org_name(None), "My workspace");
    }
}
