//! Postgres pool, migrations, and tenant-scoped transactions.

use std::time::Duration;

use sqlx::migrate::Migrator;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// Does not connect: the pool opens connections on first use, so the server
/// can boot (and answer `/health`) while the database is still waking up,
/// which Neon does after scaling to zero.
pub fn pool(database_url: &str) -> anyhow::Result<PgPool> {
    Ok(PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect_lazy(database_url)?)
}

/// Begin a transaction that can only see and write `org_id`'s rows.
///
/// Every query against an RLS table (projects, meetings, chunks,
/// usage_events) must run inside one of these. The setting is
/// transaction-local (`set_config(..., true)`), so it cannot leak to the next
/// request that reuses the pooled connection.
pub async fn begin_scoped(pool: &PgPool, org_id: Uuid) -> sqlx::Result<Transaction<'static, Postgres>> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT set_config('app.org_id', $1, true)")
        .bind(org_id.to_string())
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}
