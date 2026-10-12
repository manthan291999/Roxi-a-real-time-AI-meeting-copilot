-- Everything a past meeting carries on the desktop, so local history can be
-- imported into an account (routes/import.rs) and later written live.
--
-- Import idempotency: rows copied from a desktop database keep the device
-- that sent them and their local id. Re-running an import finds those and
-- skips them instead of duplicating.

ALTER TABLE projects
    ADD COLUMN source_device    text,
    ADD COLUMN source_local_id  bigint,
    ADD CONSTRAINT projects_source_key UNIQUE (org_id, source_device, source_local_id);

ALTER TABLE meetings
    ADD COLUMN display_id       text,
    ADD COLUMN role             text,
    ADD COLUMN summary          text,
    ADD COLUMN source_device    text,
    ADD COLUMN source_local_id  bigint,
    ADD CONSTRAINT meetings_source_key UNIQUE (org_id, source_device, source_local_id);

-- 'interrupted': the desktop app quit while the meeting was still running,
-- so it never recorded an end.
ALTER TABLE meetings DROP CONSTRAINT meetings_status_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_status_check
    CHECK (status IN ('running', 'completed', 'interrupted', 'failed'));

CREATE TABLE transcripts (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id      uuid NOT NULL,
    meeting_id  uuid NOT NULL,
    speaker     text,
    text        text NOT NULL,
    spoken_at   timestamptz,
    FOREIGN KEY (meeting_id, org_id) REFERENCES meetings (id, org_id) ON DELETE CASCADE
);
CREATE INDEX transcripts_meeting_idx ON transcripts (meeting_id, spoken_at);

CREATE TABLE decisions (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id       uuid NOT NULL,
    meeting_id   uuid NOT NULL,
    description  text NOT NULL,
    confidence   real,
    created_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (meeting_id, org_id) REFERENCES meetings (id, org_id) ON DELETE CASCADE
);
CREATE INDEX decisions_meeting_idx ON decisions (meeting_id);

CREATE TABLE action_items (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id       uuid NOT NULL,
    meeting_id   uuid NOT NULL,
    assignee     text,
    description  text NOT NULL,
    deadline     text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (meeting_id, org_id) REFERENCES meetings (id, org_id) ON DELETE CASCADE
);
CREATE INDEX action_items_meeting_idx ON action_items (meeting_id);

CREATE TABLE risks (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id      uuid NOT NULL,
    meeting_id  uuid NOT NULL,
    text        text NOT NULL,
    category    text,
    severity    text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (meeting_id, org_id) REFERENCES meetings (id, org_id) ON DELETE CASCADE
);
CREATE INDEX risks_meeting_idx ON risks (meeting_id);

CREATE TABLE summaries (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id      uuid NOT NULL,
    meeting_id  uuid NOT NULL,
    kind        text NOT NULL DEFAULT 'executive',
    text        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (meeting_id, org_id) REFERENCES meetings (id, org_id) ON DELETE CASCADE
);
CREATE INDEX summaries_meeting_idx ON summaries (meeting_id);

CREATE TABLE glossary_terms (
    org_id      uuid NOT NULL,
    meeting_id  uuid NOT NULL,
    term        text NOT NULL,
    definition  text,
    first_seen  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (meeting_id, term),
    FOREIGN KEY (meeting_id, org_id) REFERENCES meetings (id, org_id) ON DELETE CASCADE
);

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['transcripts', 'decisions', 'action_items', 'risks', 'summaries', 'glossary_terms'] LOOP
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
