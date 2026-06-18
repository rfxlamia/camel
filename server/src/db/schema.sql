-- Camel Kanban schema

CREATE TABLE IF NOT EXISTS columns (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  position    DOUBLE PRECISION NOT NULL,
  wip_limit   INTEGER CHECK (wip_limit IS NULL OR wip_limit > 0),
  policy      TEXT NOT NULL DEFAULT '',
  is_done     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS cards (
  id          SERIAL PRIMARY KEY,
  column_id   INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    DOUBLE PRECISION NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  done_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS card_events (
  id             SERIAL PRIMARY KEY,
  card_id        INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  from_column_id INTEGER REFERENCES columns(id) ON DELETE SET NULL,
  to_column_id   INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id);
CREATE INDEX IF NOT EXISTS idx_events_card ON card_events(card_id);

-- Team collaboration (2026-06: auth, optimistic locking, activity feed)

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at) WHERE expires_at < now();

-- Optimistic locking: clients send the version they last saw; a mismatch
-- means someone else changed the card first (conflict -> 409).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Activity feed: who did what, beyond column moves.
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'move';
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}';
ALTER TABLE card_events ALTER COLUMN to_column_id DROP NOT NULL;
-- Delete events outlive the card row (card_id NULL, title kept in payload).
ALTER TABLE card_events ALTER COLUMN card_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_created ON card_events(created_at DESC);

-- Soft delete: cards are marked, not removed, so activity history and the
-- card_events FK survive. All board/flow queries filter `deleted_at IS NULL`.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_cards_active ON cards(column_id) WHERE deleted_at IS NULL;

-- Settings infrastructure (T1 foundation): single table, typed columns only (no JSONB),
-- global version for optimistic locking on PATCH, IF NOT EXISTS for idempotent re-runs.
-- migrate.ts applies ONLY this schema.sql (no migrations/ dir or separate files).
CREATE TABLE IF NOT EXISTS settings (
  key       TEXT PRIMARY KEY,
  text_value TEXT,
  bool_value BOOLEAN,
  version   INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Multi-workspace (2026-06: workspace boundaries, idempotent migration)

CREATE TABLE IF NOT EXISTS workspaces (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_personal   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  UNIQUE (user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id           SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  username     TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  invited_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, username)
);

ALTER TABLE columns ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_columns_workspace ON columns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cards_workspace ON cards(workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_workspace ON card_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_settings_workspace ON settings(workspace_id);

-- Legacy data migration: skip when workspaces already exist (idempotent re-run).
DO $$
DECLARE
  default_ws_id INTEGER;
  u RECORD;
  personal_ws_id INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM workspaces LIMIT 1) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO workspaces (name, owner_user_id, is_personal)
  SELECT 'Default Workspace', (SELECT id FROM users ORDER BY id LIMIT 1), false
  RETURNING id INTO default_ws_id;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  SELECT
    default_ws_id,
    usr.id,
    CASE WHEN usr.id = (SELECT MIN(id) FROM users) THEN 'owner' ELSE 'member' END
  FROM users usr;

  FOR u IN SELECT id, display_name FROM users ORDER BY id LOOP
    INSERT INTO workspaces (name, owner_user_id, is_personal)
    VALUES (u.display_name || '''s Workspace', u.id, true)
    RETURNING id INTO personal_ws_id;

    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (personal_ws_id, u.id, 'owner');
  END LOOP;

  UPDATE columns SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
  UPDATE cards SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
  UPDATE card_events SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
  UPDATE settings SET workspace_id = default_ws_id WHERE workspace_id IS NULL;
END $$;

-- Settings re-key: (1) column added above, (2) backfill in DO block, (3) NOT NULL + composite PK.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'settings'::regclass
      AND contype = 'p'
      AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE settings DROP CONSTRAINT settings_pkey;
    ALTER TABLE settings ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE settings ADD PRIMARY KEY (workspace_id, key);
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

-- Enforce NOT NULL on scoped board tables after legacy backfill.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM columns WHERE workspace_id IS NULL) THEN
    ALTER TABLE columns ALTER COLUMN workspace_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cards WHERE workspace_id IS NULL) THEN
    ALTER TABLE cards ALTER COLUMN workspace_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM card_events WHERE workspace_id IS NULL) THEN
    ALTER TABLE card_events ALTER COLUMN workspace_id SET NOT NULL;
  END IF;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
