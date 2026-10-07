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
END $work_item_merge_guard$;
