# Board / Tracker unified view

**Date:** 2026-08-31
**Status:** approved
**Depends on:** docs/pocket/spec/2026-08-29-board-tracker-schema-unify/additive-shared-vocab.md

## Summary

Close the integration debt from additive shared vocab: board cards with keys appear in Tracker list and detail, mutations route to the correct table via `source`, and status changes on board items move the card to the canonical column (hybrid reverse minimal).

Two tables remain. One work-item contract at the API and client layer.

## Acceptance criteria

```
ACCEPTANCE CRITERIA — board-tracker-unified-view

Unified read
  ✓ GIVEN card TE-9 created on Board WHEN user opens Tracker THEN TE-9 appears in list
  ✓ GIVEN user opens GET /tracker/items/TE-9 for a board card THEN response includes source=board, columnId, dueDate
  ✓ GIVEN tracker item TE-1 WHEN listed THEN source=tracker and behavior unchanged
  ✓ GIVEN same key_number in both tables (must not happen) WHEN list THEN tracker row wins

Unified write
  ✓ GIVEN board card WHEN user edits priority/labels/project in Tracker THEN PATCH /cards/:id
  ✓ GIVEN board card WHEN client PATCH /tracker/items/:key with field change THEN 409 board_item_use_card_api
  ✓ GIVEN tracker item WHEN inline edit THEN PATCH /tracker/items/:key unchanged

Hybrid reverse (status)
  ✓ GIVEN 2-col Inbox | Finished(is_done) WHEN board card in Inbox status→done THEN card in Finished, status_id=done
  ✓ GIVEN in_progress column WHEN status stays in_progress THEN column_id unchanged
  ✓ GIVEN status→canceled WHEN board card THEN status_id updates, column_id unchanged

Realtime
  ✓ GIVEN card.created WHEN Tracker open THEN list refreshes (SSE includes key in payload)
  ✓ GIVEN board card detail WHEN changelog loaded THEN card_events shown
```

## Out of scope

- Merge cards + tracker_items into work_items
- Unify card_events + tracker_events tables
- Roadmap UI
- Status vocabulary CRUD
