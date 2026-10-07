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

-- Abort loudly (and roll the whole migration back) if duplicate keys exist,
-- instead of failing with a generic unique-index error.
DO $work_item_merge_dupe_check$
DECLARE
  dupe RECORD;
BEGIN
  SELECT workspace_id, key_number
  INTO dupe
  FROM cards
  WHERE key_number IS NOT NULL
  GROUP BY workspace_id, key_number
  HAVING count(*) > 1
  ORDER BY workspace_id, key_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'work-item-merge: duplicate card keys workspace=% key=%',
      dupe.workspace_id, dupe.key_number;
  END IF;
END $work_item_merge_dupe_check$;

-- Database-enforced identity: one key per workspace, soft-deleted rows
-- included. Rows with a NULL key_number are ignored by Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cards_workspace_key
  ON cards (workspace_id, key_number);

-- Copy block (Phase 3): copy every not-yet-migrated tracker item into cards
-- and remap what points at it. One atomic block inside the migration
-- transaction. New card ids always come from the sequence (never explicit).
-- Idempotent: only tracker_items with migrated_to_id IS NULL are copied, and
-- the only write to tracker_items is migrated_to_id. tracker_events is read
-- only. Order: map -> insert -> remaps -> events.
DO $work_item_merge_copy$
BEGIN
  DROP TABLE IF EXISTS pg_temp.wim_map;
  CREATE TEMP TABLE wim_map (
    old_id       INTEGER PRIMARY KEY,
    new_id       INTEGER NOT NULL,
    workspace_id INTEGER NOT NULL
  ) ON COMMIT DROP;

  WITH inserted AS (
    INSERT INTO cards (
      workspace_id, column_id, title, description, position, version,
      deleted_at, created_at, updated_at, status_id, priority_id, project_id,
      phase_id, key_number, start_date, end_date, completed_at, plan_position
    )
    SELECT
      ti.workspace_id, NULL, ti.title, ti.description,
      0, -- placeholder: board position is never read for column-less items
      ti.version, ti.deleted_at, ti.created_at, ti.updated_at, ti.status_id,
      ti.priority_id, ti.project_id, ti.phase_id, ti.key_number,
      ti.start_date, ti.end_date, ti.completed_at,
      COALESCE(
        ti.position,
        row_number() OVER (
          PARTITION BY ti.workspace_id ORDER BY ti.created_at, ti.id
        ) * 1024.0
      )
    FROM tracker_items AS ti
    WHERE ti.migrated_to_id IS NULL
    ORDER BY ti.id
    RETURNING id, workspace_id, key_number
  )
  INSERT INTO wim_map (old_id, new_id, workspace_id)
  SELECT ti.id, inserted.id, ti.workspace_id
  FROM inserted
  JOIN tracker_items AS ti
    ON ti.workspace_id = inserted.workspace_id
   AND ti.key_number = inserted.key_number
   AND ti.migrated_to_id IS NULL;

  UPDATE tracker_items AS ti
  SET migrated_to_id = m.new_id
  FROM wim_map AS m
  WHERE ti.id = m.old_id;

  INSERT INTO card_assignees (card_id, user_id)
  SELECT m.new_id, a.user_id
  FROM tracker_item_assignees AS a
  JOIN wim_map AS m ON m.old_id = a.tracker_item_id
  ON CONFLICT DO NOTHING;

  INSERT INTO card_labels (card_id, vocabulary_id)
  SELECT m.new_id, l.vocabulary_id
  FROM tracker_item_labels AS l
  JOIN wim_map AS m ON m.old_id = l.tracker_item_id
  ON CONFLICT DO NOTHING;

  INSERT INTO card_events (
    card_id, from_column_id, to_column_id, actor_id, event_type, payload,
    workspace_id, created_at
  )
  SELECT m.new_id, NULL, NULL, e.actor_id, e.event_type, e.payload,
         e.workspace_id, e.created_at
  FROM tracker_events AS e
  JOIN wim_map AS m ON m.old_id = e.tracker_item_id
  ORDER BY e.id;
END $work_item_merge_copy$;
