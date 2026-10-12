# server/ — Roxi cloud API

The backend for Roxi as a SaaS product. The desktop app signs in with
Supabase, calls this API with the user's access token, and never holds a
provider API key.

| Piece | Choice |
|---|---|
| Auth | Supabase Auth (tokens verified here, JWKS or legacy HS256 secret) |
| Database | Neon Postgres, row-level security per org |
| Hosting | Render (Docker), blueprint in `/render.yaml` |
| Speech to text | App streams directly to AssemblyAI with a short-lived token from `POST /v1/stt/token` |

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness, never touches the DB |
| GET | `/health/ready` | none | DB reachable |
| GET | `/v1/me` | Bearer | User + org. Creates both on first call |
| POST | `/v1/stt/token` | Bearer | Temporary AssemblyAI streaming token + WebSocket URL |
| GET | `/v1/meetings` | Bearer | The workspace's meetings, newest first (`?limit=`, max 200) |
| POST | `/v1/import/meetings` | Bearer, owner/admin | Import a batch (≤ 25) of desktop meetings. Idempotent per `(device_id, local_id)` |

Errors are always `{"error": {"code", "message"}}`.

## Run locally

Add to the **repo-root** `.env` (the server searches parent directories for it):

```
DATABASE_URL=postgres://...        # a Neon branch works well for dev
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_JWT_SECRET=               # only for projects still on the legacy HS256 secret
ASSEMBLYAI_API_KEY=...             # already there for the desktop app
```

```bash
cd server
cargo run          # applies migrations, then listens on :8080 (PORT to change)
cargo test         # DB tests skip unless TEST_DATABASE_URL is set
TEST_DATABASE_URL=postgres://... cargo test   # use a throwaway database
```

## Tenancy rules

- Every table with customer data has `org_id` and `FORCE ROW LEVEL SECURITY`.
- Query those tables only inside `db::begin_scoped(pool, org_id)`. A query
  outside it sees zero rows, which fails safe.
- Child rows use composite foreign keys (`(meeting_id, org_id)`), so a row
  cannot point at another org's parent.
- Never run the server as a Postgres superuser: superusers bypass RLS.
