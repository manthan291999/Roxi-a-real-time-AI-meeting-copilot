//! HTTP-level tests.
//!
//! Tests that need Postgres run only when `TEST_DATABASE_URL` is set (point
//! it at a throwaway database: migrations run against it). The rest use a
//! lazy pool that never connects.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use roxi_server::config::Config;
use roxi_server::{db, router, AppState};
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;

const SUPABASE_URL: &str = "https://proj.supabase.co";
const SECRET: &str = "test-secret-at-least-32-bytes-long!!";

fn config(database_url: &str, assemblyai: Option<(&str, &str)>) -> Config {
    Config {
        port: 0,
        database_url: database_url.to_string(),
        supabase_url: SUPABASE_URL.to_string(),
        supabase_jwt_secret: Some(SECRET.to_string()),
        assemblyai_api_key: assemblyai.map(|(key, _)| key.to_string()),
        assemblyai_streaming_base: assemblyai
            .map(|(_, base)| base.to_string())
            .unwrap_or_else(|| "https://streaming.assemblyai.com".into()),
        stt_token_ttl_secs: 60,
    }
}

fn app_without_db(assemblyai: Option<(&str, &str)>) -> Router {
    // Unroutable address: any test that accidentally touches the DB fails fast.
    let url = "postgres://nobody@127.0.0.1:1/none";
    let state = AppState::new(config(url, assemblyai), db::pool(url).unwrap()).unwrap();
    router(Arc::new(state))
}

fn token_for(sub: Uuid, email: &str) -> String {
    let claims = json!({
        "sub": sub, "email": email, "aud": "authenticated",
        "iss": format!("{SUPABASE_URL}/auth/v1"),
        "exp": chrono::Utc::now().timestamp() + 3600,
    });
    encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(SECRET.as_bytes())).unwrap()
}

async fn call(app: &Router, method: &str, path: &str, bearer: Option<&str>) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(path);
    if let Some(t) = bearer {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let res = app.clone().oneshot(req.body(Body::empty()).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn health_does_not_need_the_database() {
    let (status, body) = call(&app_without_db(None), "GET", "/health", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn the_email_confirmed_page_is_public_and_locked_down() {
    let app = app_without_db(None);
    let res = app
        .oneshot(axum::http::Request::get("/auth/confirmed").body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let csp = res.headers()["content-security-policy"].to_str().unwrap().to_string();
    assert!(csp.contains("default-src 'none'") && csp.contains("frame-ancestors 'none'"));
    assert_eq!(res.headers()["cache-control"], "no-store");
    let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(body.to_vec()).unwrap();
    assert!(html.contains("Email confirmed") && html.contains("history.replaceState"));
}

#[tokio::test]
async fn protected_routes_reject_missing_and_bad_tokens() {
    let app = app_without_db(None);
    for (method, path) in [("GET", "/v1/me"), ("POST", "/v1/stt/token")] {
        let (status, body) = call(&app, method, path, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path} without token");
        assert_eq!(body["error"]["code"], "unauthorized");

        let (status, _) = call(&app, method, path, Some("garbage")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path} with bad token");
    }
}

#[tokio::test]
async fn stt_token_is_unavailable_without_a_provider_key() {
    let app = app_without_db(None);
    let (status, body) = call(&app, "POST", "/v1/stt/token", Some(&token_for(Uuid::new_v4(), "a@x.com"))).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"]["code"], "unavailable");
}

// ---------------------------------------------------------------- Postgres

async fn test_pool() -> Option<sqlx::PgPool> {
    let url = std::env::var("TEST_DATABASE_URL").ok().filter(|v| !v.trim().is_empty())?;
    let pool = db::pool(&url).unwrap();
    db::MIGRATOR.run(&pool).await.expect("migrations apply");
    Some(pool)
}

#[tokio::test]
async fn first_login_creates_one_personal_org_and_reuses_it() {
    let Some(pool) = test_pool().await else { return };
    let url = std::env::var("TEST_DATABASE_URL").unwrap();
    let app = router(Arc::new(AppState::new(config(&url, None), pool).unwrap()));
    let token = token_for(Uuid::new_v4(), "ana@example.com");

    let (s1, first) = call(&app, "GET", "/v1/me", Some(&token)).await;
    let (s2, second) = call(&app, "GET", "/v1/me", Some(&token)).await;
    assert_eq!((s1, s2), (StatusCode::OK, StatusCode::OK));
    assert_eq!(first["org_id"], second["org_id"]);
    assert_eq!(first["role"], "owner");
    assert_eq!(first["plan"], "free");
    assert_eq!(first["org_name"], "ana's workspace");
}

#[tokio::test]
async fn rows_are_invisible_outside_their_org() {
    let Some(pool) = test_pool().await else { return };
    let claims = |email: &str| roxi_server::auth::Claims { sub: Uuid::new_v4(), email: Some(email.into()) };
    let a = roxi_server::accounts::ensure_account(&pool, &claims("a@a.com")).await.unwrap();
    let b = roxi_server::accounts::ensure_account(&pool, &claims("b@b.com")).await.unwrap();

    let mut tx = db::begin_scoped(&pool, a.org_id).await.unwrap();
    let meeting_id: Uuid = sqlx::query_scalar("INSERT INTO meetings (org_id, title) VALUES ($1, 'A secret') RETURNING id")
        .bind(a.org_id)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO chunks (org_id, meeting_id, seq, text) VALUES ($1, $2, 0, 'quarterly numbers')")
        .bind(a.org_id)
        .bind(meeting_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let count = |sql: &'static str, org: Option<Uuid>| {
        let pool = pool.clone();
        async move {
            let mut tx = match org {
                Some(o) => db::begin_scoped(&pool, o).await.unwrap(),
                None => pool.begin().await.unwrap(),
            };
            let n: i64 = sqlx::query_scalar(sql).bind(meeting_id).fetch_one(&mut *tx).await.unwrap();
            n
        }
    };
    let meetings = "SELECT count(*) FROM meetings WHERE id = $1";
    let chunks = "SELECT count(*) FROM chunks WHERE meeting_id = $1";

    assert_eq!(count(meetings, Some(a.org_id)).await, 1, "owner org sees its meeting");
    assert_eq!(count(chunks, Some(a.org_id)).await, 1, "owner org sees its chunk");
    assert_eq!(count(meetings, Some(b.org_id)).await, 0, "other org sees nothing");
    assert_eq!(count(chunks, Some(b.org_id)).await, 0, "other org sees no chunks");
    assert_eq!(count(meetings, None).await, 0, "unscoped query sees nothing");

    // Writing another org's id is refused by the policy's WITH CHECK.
    let mut tx = db::begin_scoped(&pool, b.org_id).await.unwrap();
    let forged = sqlx::query("INSERT INTO meetings (org_id, title) VALUES ($1, 'forged')")
        .bind(a.org_id)
        .execute(&mut *tx)
        .await;
    assert!(forged.is_err(), "cross-org insert must fail");
}

#[tokio::test]
async fn stt_token_is_minted_from_the_provider() {
    let Some(pool) = test_pool().await else { return };

    // Stand-in for AssemblyAI's token endpoint.
    use axum::extract::Query;
    use axum::http::HeaderMap;
    let mock = Router::new().route(
        "/v3/token",
        axum::routing::get(|headers: HeaderMap, Query(q): Query<std::collections::HashMap<String, String>>| async move {
            assert_eq!(headers.get("authorization").unwrap(), "server-side-key");
            assert_eq!(q.get("expires_in_seconds").map(String::as_str), Some("60"));
            axum::Json(json!({ "token": "temp-123" }))
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });

    let url = std::env::var("TEST_DATABASE_URL").unwrap();
    let app = router(Arc::new(AppState::new(config(&url, Some(("server-side-key", &base))), pool).unwrap()));
    let (status, body) = call(&app, "POST", "/v1/stt/token", Some(&token_for(Uuid::new_v4(), "c@c.com"))).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["token"], "temp-123");
    assert_eq!(body["provider"], "assemblyai");
    assert!(body["websocket_url"].as_str().unwrap().starts_with("ws://"));
    assert!(!body.to_string().contains("server-side-key"), "real key must never reach the client");
}

async fn call_json(app: &Router, method: &str, path: &str, bearer: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", format!("Bearer {bearer}"))
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn import_is_idempotent_and_lands_in_the_callers_org() {
    let Some(pool) = test_pool().await else { return };
    let url = std::env::var("TEST_DATABASE_URL").unwrap();
    let app = router(Arc::new(AppState::new(config(&url, None), pool).unwrap()));
    let token = token_for(Uuid::new_v4(), "admin@example.com");

    let batch = json!({
        "device_id": format!("test-{}", Uuid::new_v4()),
        "projects": [{ "local_id": 1, "name": "Unsorted", "code": "GEN" }],
        "meetings": [{
            "local_id": 42, "project_local_id": 1, "name": "Sprint review", "status": "running",
            "started_at": "2026-09-24T13:00:43Z", "ended_at": null,
            "transcripts": [
                { "speaker": "A", "text": "Let's ship Friday.", "spoken_at": "2026-09-24T13:01:00Z" },
                { "speaker": null, "text": "Agreed.", "spoken_at": null }
            ],
            "chunks": [{ "seq": 0, "speaker": "A", "text": "Let's ship Friday. Agreed." }],
            "decisions": [{ "description": "Ship Friday", "confidence": 0.9 }],
            "action_items": [{ "assignee": "B", "description": "Tag the release" }],
            "risks": [{ "text": "QA is short-staffed", "severity": "high" }],
            "summaries": [{ "kind": "executive", "text": "Release agreed for Friday." }],
            "glossary": [{ "term": "RC", "definition": "Release candidate" }]
        }]
    });

    let (status, first) = call_json(&app, "POST", "/v1/import/meetings", &token, batch.clone()).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["meetings_imported"], 1);
    assert_eq!(first["projects_imported"], 1);

    let (_, second) = call_json(&app, "POST", "/v1/import/meetings", &token, batch).await;
    assert_eq!(second["meetings_imported"], 0, "re-import must not duplicate");
    assert_eq!(second["meetings_skipped"], 1);

    let (status, list) = call(&app, "GET", "/v1/meetings", Some(&token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["total"], 1);
    assert_eq!(list["meetings"][0]["title"], "Sprint review");
    assert_eq!(list["meetings"][0]["status"], "interrupted");
    assert_eq!(list["meetings"][0]["imported"], true);
    assert_eq!(list["meetings"][0]["transcript_lines"], 2);

    // A different user's account sees none of it.
    let (_, other) = call(&app, "GET", "/v1/meetings", Some(&token_for(Uuid::new_v4(), "x@y.com"))).await;
    assert_eq!(other["total"], 0);
}

#[tokio::test]
async fn import_rejects_oversized_batches() {
    let app = app_without_db(None);
    let meetings: Vec<Value> = (0..26).map(|i| json!({ "local_id": i })).collect();
    let (status, body) = call_json(
        &app,
        "POST",
        "/v1/import/meetings",
        &token_for(Uuid::new_v4(), "a@b.com"),
        json!({ "device_id": "d", "meetings": meetings }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}
