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
