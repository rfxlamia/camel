-- Work-item single-table merge: additive expand step (Phase 1).
-- Runs inside the single transaction opened by migrate.ts; every statement
-- must be idempotent. Do not use CREATE INDEX CONCURRENTLY here.

-- Column-less items: a work item may exist without a board column.
ALTER TABLE cards ALTER COLUMN column_id DROP NOT NULL;

-- New nullable columns. NULL means "use the computed value".
ALTER TABLE cards ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS plan_position DOUBLE PRECISION;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE tracker_items ADD COLUMN IF NOT EXISTS migrated_to_id INTEGER;

-- Database-enforced identity: one key per workspace, soft-deleted rows
-- included. Rows with a NULL key_number are ignored by Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cards_workspace_key
  ON cards (workspace_id, key_number);
