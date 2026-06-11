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
