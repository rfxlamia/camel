-- Work-item single-table merge: post-copy guard (Phase 4).
-- Runs right after work-item-merge.sql inside the same migration transaction.
-- Everything here sits behind the merge gate (work_item_merge.enabled = 'on',
-- set by applySchema); with the gate off this file changes nothing.

-- Parity assertions, scoped to wim_pending: only the rows migrated by THIS
-- run, never whole tables (users edit cards after go-live). The temp tables
-- are created by the copy block and live until commit; when the copy did not
-- run in this transaction (gate off, nothing left to migrate) they do not
-- exist and this block returns without checking anything. Any mismatch aborts
-- the whole migration transaction.
DO $work_item_merge_parity$
DECLARE
  bad RECORD;
BEGIN
  IF coalesce(current_setting('work_item_merge.enabled', true), '') <> 'on'
     OR to_regclass('pg_temp.wim_pending') IS NULL
     OR to_regclass('pg_temp.wim_focus') IS NULL THEN
    RETURN;
  END IF;

  -- Parity assertions, scoped to wim_pending. Any mismatch aborts the whole
  -- migration transaction (nothing is committed) with a readable message.
  SELECT p.workspace_id, p.key_number
  INTO bad
  FROM (
    SELECT workspace_id, count(*) AS n FROM wim_pending GROUP BY workspace_id
  ) AS want
  JOIN wim_pending AS p ON p.workspace_id = want.workspace_id
  WHERE want.n <> (
    SELECT count(*) FROM wim_pending AS q
    JOIN tracker_items AS t ON t.id = q.old_id
    JOIN cards AS c ON c.id = t.migrated_to_id AND c.workspace_id = q.workspace_id
    WHERE q.workspace_id = want.workspace_id
  )
  ORDER BY p.workspace_id, p.key_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'work-item-merge: count mismatch workspace=% key=% (a tracker row has no copied card)',
      bad.workspace_id, bad.key_number;
  END IF;

  SELECT p.workspace_id, p.key_number,
    CASE
      WHEN c.title IS DISTINCT FROM t.title THEN 'title'
      WHEN c.status_id IS DISTINCT FROM t.status_id THEN 'status_id'
      WHEN c.project_id IS DISTINCT FROM t.project_id THEN 'project_id'
      WHEN c.phase_id IS DISTINCT FROM t.phase_id THEN 'phase_id'
      WHEN c.start_date IS DISTINCT FROM t.start_date THEN 'start_date'
      WHEN c.end_date IS DISTINCT FROM t.end_date THEN 'end_date'
      WHEN c.version IS DISTINCT FROM t.version THEN 'version'
      WHEN c.key_number IS DISTINCT FROM t.key_number THEN 'key_number'
    END AS field
  INTO bad
  FROM wim_pending AS p
  JOIN tracker_items AS t ON t.id = p.old_id
  JOIN cards AS c ON c.id = t.migrated_to_id
  WHERE c.title IS DISTINCT FROM t.title
     OR c.status_id IS DISTINCT FROM t.status_id
     OR c.project_id IS DISTINCT FROM t.project_id
     OR c.phase_id IS DISTINCT FROM t.phase_id
     OR c.start_date IS DISTINCT FROM t.start_date
     OR c.end_date IS DISTINCT FROM t.end_date
     OR c.version IS DISTINCT FROM t.version
     OR c.key_number IS DISTINCT FROM t.key_number
  ORDER BY p.workspace_id, p.key_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'work-item-merge: field mismatch workspace=% key=% field=%',
      bad.workspace_id, bad.key_number, bad.field;
  END IF;

  -- Relation parity per migrated row: labels, assignees and events must
  -- exist on the new card exactly as they did on the tracker item.
  SELECT p.workspace_id, p.key_number,
    CASE
      WHEN (SELECT count(*) FROM tracker_item_labels AS l WHERE l.tracker_item_id = p.old_id)
        <> (SELECT count(*) FROM card_labels AS cl WHERE cl.card_id = t.migrated_to_id)
        THEN 'card_labels'
      WHEN (SELECT count(*) FROM tracker_item_assignees AS a WHERE a.tracker_item_id = p.old_id)
        <> (SELECT count(*) FROM card_assignees AS ca WHERE ca.card_id = t.migrated_to_id)
        THEN 'card_assignees'
      WHEN (SELECT count(*) FROM tracker_events AS e WHERE e.tracker_item_id = p.old_id)
        <> (SELECT count(*) FROM card_events AS ce WHERE ce.card_id = t.migrated_to_id)
        THEN 'card_events'
    END AS relation
  INTO bad
  FROM wim_pending AS p
  JOIN tracker_items AS t ON t.id = p.old_id
  WHERE (SELECT count(*) FROM tracker_item_labels AS l WHERE l.tracker_item_id = p.old_id)
        <> (SELECT count(*) FROM card_labels AS cl WHERE cl.card_id = t.migrated_to_id)
     OR (SELECT count(*) FROM tracker_item_assignees AS a WHERE a.tracker_item_id = p.old_id)
        <> (SELECT count(*) FROM card_assignees AS ca WHERE ca.card_id = t.migrated_to_id)
     OR (SELECT count(*) FROM tracker_events AS e WHERE e.tracker_item_id = p.old_id)
        <> (SELECT count(*) FROM card_events AS ce WHERE ce.card_id = t.migrated_to_id)
  ORDER BY p.workspace_id, p.key_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'work-item-merge: relation mismatch workspace=% key=% relation=%',
      bad.workspace_id, bad.key_number, bad.relation;
  END IF;

  -- Every remapped focus session must now point at the new card of its item.
  SELECT p.workspace_id, p.key_number, w.session_id
  INTO bad
  FROM wim_focus AS w
  JOIN wim_pending AS p ON p.old_id = w.old_id
  JOIN focus_sessions AS f ON f.id = w.session_id
  WHERE f.task_id IS DISTINCT FROM w.new_id
     OR NOT EXISTS (
       SELECT 1 FROM cards AS c
       WHERE c.id = f.task_id AND c.workspace_id = f.workspace_id
     )
  ORDER BY p.workspace_id, p.key_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'work-item-merge: focus session mismatch workspace=% key=% session=%',
      bad.workspace_id, bad.key_number, bad.session_id;
  END IF;
END $work_item_merge_parity$;

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
