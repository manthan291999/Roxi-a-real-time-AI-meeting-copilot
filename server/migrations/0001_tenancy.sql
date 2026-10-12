-- Roxi cloud schema v1: accounts, tenancy, and the core meeting tables.
--
-- Tenancy rule: every table that holds customer data carries `org_id` and has
-- FORCE ROW LEVEL SECURITY with the `tenant_isolation` policy below. The
-- server sets `app.org_id` per transaction (see db::begin_scoped); a query
-- that forgets to do so sees no rows at all instead of every tenant's rows.
-- FORCE matters because the server connects as the table owner, and without
-- it RLS does not apply to owners. (Superusers always bypass RLS: never run
-- the server as one. Neon's default `neondb_owner` is not a superuser.)
--
-- Account tables (orgs, users, memberships) are not RLS-scoped: they are only
-- ever read by the authenticated user's own id, in accounts.rs.

CREATE TABLE orgs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    plan        text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- `id` is the Supabase auth user id (the token's `sub`), not a local sequence.
CREATE TABLE users (
    id            uuid PRIMARY KEY,
    email         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    org_id      uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE projects (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    name         text NOT NULL,
    code         text NOT NULL,
    description  text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    archived_at  timestamptz,
    UNIQUE (org_id, code),
    UNIQUE (org_id, name),
    UNIQUE (id, org_id)
);

CREATE TABLE meetings (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
    project_id    uuid,
    title         text,
    context       text,
    status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    stt_provider  text,
    started_at    timestamptz NOT NULL DEFAULT now(),
    ended_at      timestamptz,
    UNIQUE (id, org_id),
    -- Composite key: a meeting can only point at a project in its own org.
    FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id)
);
CREATE INDEX meetings_org_started_idx ON meetings (org_id, started_at DESC);

CREATE TABLE chunks (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id        uuid NOT NULL,
    meeting_id    uuid NOT NULL,
    seq           integer NOT NULL,
    speaker       text,
    text          text NOT NULL,
    significance  text,
    topic         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- Replaces the desktop app's FTS5 table for Ask Roxi's lexical search.
    search        tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
    UNIQUE (meeting_id, seq),
    -- Composite key: a chunk can only belong to a meeting in its own org.
    FOREIGN KEY (meeting_id, org_id) REFERENCES meetings (id, org_id) ON DELETE CASCADE
);
CREATE INDEX chunks_org_idx ON chunks (org_id);
CREATE INDEX chunks_search_idx ON chunks USING gin (search);

-- Metering for plan limits and per-org cost. `quantity` is seconds for
-- stt_seconds and 1 per call otherwise.
CREATE TABLE usage_events (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id         uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id        uuid REFERENCES users (id) ON DELETE SET NULL,
    meeting_id     uuid REFERENCES meetings (id) ON DELETE SET NULL,
    kind           text NOT NULL CHECK (kind IN ('stt_seconds', 'llm_call', 'embedding')),
    provider       text,
    model          text,
    quantity       numeric NOT NULL DEFAULT 0,
    input_tokens   integer,
    output_tokens  integer,
    cost_usd       numeric(12, 6) NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_org_created_idx ON usage_events (org_id, created_at);

-- `current_setting(..., true)` returns NULL (or '' once reset) when unset, so
-- an unscoped query matches nothing.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['projects', 'meetings', 'chunks', 'usage_events'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
                 USING (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)
                 WITH CHECK (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
            t);
    END LOOP;
END
$$;
