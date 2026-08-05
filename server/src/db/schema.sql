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
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

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

-- Card ownership & scheduling (2026-06: assignee + due date for team PM).
-- assignee_id: who owns the card; SET NULL if the user row is deleted.
-- due_date: a calendar DATE (no time-of-day) — avoids timezone off-by-one
-- from HTML date inputs; serialized to text as 'YYYY-MM-DD'.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS due_date DATE;

-- OAuth integration: Better Auth support (2026-06: additive, non-destructive)
-- Make username / password_hash nullable to support OAuth-only users.
ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Email is captured ONLY via OAuth (always provider-verified).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
-- updated_at required by Better Auth user model adapter.
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- NOTE: NO backfill. Per spec (Scope + Rule 3), existing password users have
-- email_verified=false and ARE intentionally gated until they link a provider.
-- Do not flip email_verified for password users — that defeats the email gate.

-- Partial unique index: multiple NULL emails allowed; non-NULL emails must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

-- Better Auth expects an `image` column for OAuth avatar URLs (not remapped in fields config).
ALTER TABLE users ADD COLUMN IF NOT EXISTS image TEXT;

-- Better Auth OAuth identity table (one row per provider-link per user).
CREATE TABLE IF NOT EXISTS ba_accounts (
  id                        TEXT PRIMARY KEY,
  account_id                TEXT NOT NULL,
  provider_id               TEXT NOT NULL,
  user_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token              TEXT,
  refresh_token             TEXT,
  id_token                  TEXT,
  access_token_expires_at   TIMESTAMPTZ,
  refresh_token_expires_at  TIMESTAMPTZ,
  scope                     TEXT,
  password                  TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ba_accounts_user ON ba_accounts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ba_accounts_provider ON ba_accounts(provider_id, account_id);

-- Better Auth verification tokens (OAuth state, PKCE, etc.).
CREATE TABLE IF NOT EXISTS ba_verifications (
  id           TEXT PRIMARY KEY,
  identifier   TEXT NOT NULL,
  value        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Better Auth internal sessions (separate from camel_session authority → sessions table).
CREATE TABLE IF NOT EXISTS ba_sessions (
  id          TEXT PRIMARY KEY,
  expires_at  TIMESTAMPTZ NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address  TEXT,
  user_agent  TEXT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ba_sessions_user ON ba_sessions(user_id);

-- Account-level auth/security audit log. Distinct from card_events (which is the
-- card activity log, FK to cards + workspace_id NOT NULL). Used for events that
-- have no card/workspace context — e.g. the Rule 4 link-collision orphan event.
CREATE TABLE IF NOT EXISTS auth_audit (
  id          SERIAL PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_actor ON auth_audit(actor_id);

-- Performance indexes (issue #72)
-- Invite lookup by username (workspace list endpoint)
CREATE INDEX IF NOT EXISTS idx_invites_username
  ON workspace_invites(username);

-- Activity feed: filter by workspace + sort by recency in one index
CREATE INDEX IF NOT EXISTS idx_events_workspace_created
  ON card_events(workspace_id, created_at DESC, id DESC);

-- Board read: filter live cards by workspace + sort by position
CREATE INDEX IF NOT EXISTS idx_cards_workspace_position
  ON cards(workspace_id, position) WHERE deleted_at IS NULL;

-- Multiple assignees per card (junction table; replaces cards.assignee_id).
CREATE TABLE IF NOT EXISTS card_assignees (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_card_assignees_user ON card_assignees(user_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cards' AND column_name = 'assignee_id'
  ) THEN
    INSERT INTO card_assignees (card_id, user_id)
    SELECT id, assignee_id FROM cards
    WHERE assignee_id IS NOT NULL
    ON CONFLICT DO NOTHING;
    ALTER TABLE cards DROP COLUMN assignee_id;
  END IF;
END $$;

-- Signable columns: auto-assign cards to a designated member when moved/created.
-- is_signable: marks a column as having auto-assign behavior.
-- signable_assignee_id: the workspace member to auto-assign; SET NULL if user is deleted.
-- Non-exclusive: multiple columns can be signable, each with their own assignee.
ALTER TABLE columns ADD COLUMN IF NOT EXISTS is_signable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE columns ADD COLUMN IF NOT EXISTS signable_assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Column color: allows users to customize column appearance with predefined palettes.
-- Stores palette name (e.g. 'powder-blue', 'pale-sky') or NULL for default neutral styling.
ALTER TABLE columns ADD COLUMN IF NOT EXISTS color TEXT;

-- Notification center (2026-06: inbox, domain events, due date reminders)

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id  INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  timezone      TEXT NOT NULL DEFAULT 'UTC'
);

CREATE TABLE IF NOT EXISTS notifications (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  card_id         INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  board_id        INTEGER,
  actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  read_at         TIMESTAMPTZ,
  source_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read_at) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_reminder_daily
  ON notifications(user_id, card_id, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE type = 'due_date_reminder';

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS board_id INTEGER;

-- Tracker entity (2026-08: backlog/product items, independent of Board cards)

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS tracker_key_counter INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tracker_vocabularies (
  id           SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('status', 'priority', 'label')),
  name         TEXT NOT NULL,
  position     DOUBLE PRECISION NOT NULL,
  colour       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_vocab_workspace_kind_name
  ON tracker_vocabularies (workspace_id, kind, lower(name));

CREATE INDEX IF NOT EXISTS idx_tracker_vocab_workspace_kind_position
  ON tracker_vocabularies (workspace_id, kind, position);

CREATE TABLE IF NOT EXISTS tracker_items (
  id           SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_number   INTEGER NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status_id    INTEGER NOT NULL REFERENCES tracker_vocabularies(id),
  priority_id  INTEGER REFERENCES tracker_vocabularies(id) ON DELETE SET NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key_number)
);

CREATE INDEX IF NOT EXISTS idx_tracker_items_workspace_active
  ON tracker_items (workspace_id, created_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tracker_item_labels (
  tracker_item_id INTEGER NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE,
  vocabulary_id   INTEGER NOT NULL REFERENCES tracker_vocabularies(id) ON DELETE CASCADE,
  PRIMARY KEY (tracker_item_id, vocabulary_id)
);

CREATE INDEX IF NOT EXISTS idx_tracker_item_labels_vocab
  ON tracker_item_labels (vocabulary_id);

CREATE TABLE IF NOT EXISTS tracker_item_assignees (
  tracker_item_id INTEGER NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (tracker_item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tracker_item_assignees_user
  ON tracker_item_assignees (user_id);

CREATE TABLE IF NOT EXISTS tracker_events (
  id              SERIAL PRIMARY KEY,
  tracker_item_id INTEGER REFERENCES tracker_items(id) ON DELETE SET NULL,
  actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracker_events_item_created
  ON tracker_events (tracker_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracker_events_workspace_created
  ON tracker_events (workspace_id, created_at DESC, id DESC);

-- Retroactive default vocabulary for all existing workspaces (idempotent re-run).
DO $$
DECLARE
  ws RECORD;
BEGIN
  -- Keep in sync with tracker-vocabulary-seed.ts (DEFAULT_TRACKER_VOCABULARY); pairs with category backfill below
  FOR ws IN SELECT id FROM workspaces LOOP
    INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour)
    SELECT ws.id, v.kind, v.name, v.position, v.colour
    FROM (VALUES
      ('status',   'Backlog',       1024::double precision, 'oklch(0.89 0.07 250)'),
      ('status',   'Todo',          2048::double precision, 'oklch(0.89 0.07 200)'),
      ('status',   'In Progress',   3072::double precision, 'oklch(0.89 0.07 150)'),
      ('status',   'Done',          4096::double precision, 'oklch(0.89 0.07 140)'),
      ('status',   'Canceled',      5120::double precision, 'oklch(0.89 0.07 30)'),
      ('priority', 'High',          1024::double precision, 'oklch(0.89 0.07 25)'),
      ('priority', 'Medium',        2048::double precision, 'oklch(0.89 0.07 85)'),
      ('priority', 'Low',           3072::double precision, 'oklch(0.89 0.07 220)'),
      ('label',    'Feature',       1024::double precision, 'oklch(0.89 0.07 280)'),
      ('label',    'Bug',           2048::double precision, 'oklch(0.89 0.07 15)'),
      ('label',    'Maintain',      3072::double precision, 'oklch(0.89 0.07 180)')
    ) AS v(kind, name, position, colour)
    WHERE NOT EXISTS (
      SELECT 1
      FROM tracker_vocabularies tv
      WHERE tv.workspace_id = ws.id
        AND tv.kind = v.kind
        AND lower(tv.name) = lower(v.name)
    );
  END LOOP;
END $$;

-- Tracker project / phase / WBS (2026-08-05)

CREATE TABLE IF NOT EXISTS tracker_projects (
  id           SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  start_date   DATE,
  end_date     DATE,
  position     DOUBLE PRECISION NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracker_phases (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES tracker_projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  subtitle     TEXT NOT NULL DEFAULT '',
  start_date   DATE,
  end_date     DATE,
  position     DOUBLE PRECISION NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES tracker_projects(id) ON DELETE SET NULL;
ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS phase_id INTEGER REFERENCES tracker_phases(id) ON DELETE SET NULL;
ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION;

ALTER TABLE tracker_vocabularies ADD COLUMN IF NOT EXISTS category TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_projects_workspace_name
  ON tracker_projects (workspace_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_phases_project_name
  ON tracker_phases (project_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tracker_projects_workspace_position
  ON tracker_projects (workspace_id, position)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tracker_phases_project_position
  ON tracker_phases (project_id, position)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tracker_items_project_phase_position
  ON tracker_items (project_id, phase_id, position)
  WHERE deleted_at IS NULL;

-- tracker: category backfill
UPDATE tracker_vocabularies
SET category = 'backlog'
WHERE kind = 'status'
  AND lower(name) = lower('Backlog')
  AND category IS NULL;

-- Todo backlog
UPDATE tracker_vocabularies
SET category = 'backlog'
WHERE kind = 'status'
  AND lower(name) = lower('Todo')
  AND category IS NULL;

-- In Progress started
UPDATE tracker_vocabularies
SET category = 'started'
WHERE kind = 'status'
  AND lower(name) = lower('In Progress')
  AND category IS NULL;

-- Done completed
UPDATE tracker_vocabularies
SET category = 'completed'
WHERE kind = 'status'
  AND lower(name) = lower('Done')
  AND category IS NULL;

-- Canceled canceled
UPDATE tracker_vocabularies
SET category = 'canceled'
WHERE kind = 'status'
  AND lower(name) = lower('Canceled')
  AND category IS NULL;

UPDATE tracker_vocabularies
SET category = 'backlog'
WHERE category IS NULL
  AND kind = 'status';

UPDATE tracker_items
SET position = sub.rn * 1024
FROM (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY workspace_id, project_id, phase_id
      ORDER BY created_at, id
    ) AS rn
  FROM tracker_items
) AS sub
WHERE tracker_items.id = sub.id
  AND tracker_items.position IS NULL;
