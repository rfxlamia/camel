-- Work-item single-table merge: post-copy guard (Phase 4).
-- Runs right after work-item-merge.sql inside the same migration transaction.
-- Everything here sits behind the merge gate (work_item_merge.enabled = 'on',
-- set by applySchema); with the gate off this file changes nothing.

DO $work_item_merge_guard$
BEGIN
  IF coalesce(current_setting('work_item_merge.enabled', true), '') <> 'on' THEN
    RETURN;
  END IF;

  -- Counter repair: bring every workspace counter up to its highest card key
  -- (soft-deleted cards included, they still own their key). Monotonic and
  -- idempotent: GREATEST never lowers a counter, and only rows that are
  -- actually behind are written.
  UPDATE workspaces AS w
  SET tracker_key_counter = m.max_key
  FROM (
    SELECT workspace_id, MAX(key_number) AS max_key
    FROM cards
    WHERE key_number IS NOT NULL
    GROUP BY workspace_id
  ) AS m
  WHERE m.workspace_id = w.id
    AND w.tracker_key_counter < m.max_key;

  -- Late-write trigger: once at least one tracker row has been migrated, any
  -- further INSERT into tracker_items would create an item the copy never
  -- sees, so it is rejected. UPDATE and SELECT are untouched. Created only
  -- when absent (idempotent) and never on a database without migrated rows
  -- (fresh or empty databases keep accepting tracker inserts). The trigger is
  -- dropped together with tracker_items; the function is not and must be
  -- removed by the schema-removal task:
  --   DROP FUNCTION IF EXISTS work_item_merge_block_tracker_insert();
  IF EXISTS (SELECT 1 FROM tracker_items WHERE migrated_to_id IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = to_regclass('tracker_items')
         AND tgname = 'trg_tracker_items_block_insert'
     )
  THEN
    CREATE OR REPLACE FUNCTION work_item_merge_block_tracker_insert()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      RAISE EXCEPTION 'work-item-merge: tracker_items is closed for new rows (workspace=%, key=%); create work items in cards',
        NEW.workspace_id, NEW.key_number;
    END $fn$;

    CREATE TRIGGER trg_tracker_items_block_insert
      BEFORE INSERT ON tracker_items
      FOR EACH ROW EXECUTE FUNCTION work_item_merge_block_tracker_insert();
  END IF;
END $work_item_merge_guard$;
