# Tracker Onboarding Seed Migration

**Date:** 2026-08-04
**Status:** approved
**Author:** brainstorm + grinding session
**Spec path:** docs/pocket/spec/2026-08-04-tracker-onboarding-seed/onboarding-seed-migration.md

---

## Summary

The Tracker page currently ships with zero onboarding — a new or existing user lands on an empty page (`EmptyState` was removed in `655b865`) with no explanation of what Tracker is for or how it differs from the Board (kanban). This adds a one-time, idempotent SQL migration that backfills exactly 3 example tracker items into every existing workspace, teaching the tracker-vs-Board distinction through the items' own content — no new UI, no new components.

---

## Context

### Current State
`TrackerPage.tsx` renders whatever rows exist in `tracker_items` for the active workspace, grouped by status, with no fallback copy for the empty case. `schema.sql` already has one proven retroactive-seed pattern (`schema.sql:432-461`): a `DO $$ / FOR ws IN SELECT id FROM workspaces LOOP` block that idempotently inserts default status/priority/label vocabulary into every workspace missing it.

### Problem / Motivation
A user opening `/tracker` for the first time sees a blank page and has no way to infer that Tracker is for weeks-horizon product/backlog work, distinct from the Board's daily-ops cards. See the pitch doc (`docs/pocket/spec/2026-08-04-tracker-onboarding-seed/pitch-exploration.md`) for the full problem exploration and rejected alternatives.

### Related Areas
- `server/src/db/schema.sql` — where the new `DO $$` block is appended
- `server/src/db/migrate.ts` — executes `schema.sql` as one transaction on every `make db-migrate`, no migration-tracking table
- `server/src/routes/tracker-items.ts:391-398` — live-route key-counter allocation pattern this migration mirrors
- `server/src/core/tracker-key.ts` — confirms key strings are derived at read time, not stored
- `server/src/routes/tracker-activity.ts` — confirms `tracker_events.actor_id` is nullable and safely left-joined
- `server/src/db/tracker-migration.test.ts` — existing test file and its string/regex-assertion convention this work extends

---

## Scope

### In-Scope
- Append one `DO $$` PL/pgSQL block to `server/src/db/schema.sql`, after the existing vocab retroactive-seed block, seeding exactly 3 tracker items into every existing workspace that has at least one status in its vocabulary
- New column `workspaces.tracker_onboarding_seeded_at TIMESTAMPTZ` as the idempotency guard
- Final copy for all 3 items (title + description), approved during discovery (Direction B voice):
  1. **Welcome to Tracker** — "A place for product and backlog work — the kind that spans weeks, not a single day."
  2. **This isn't your Board** — "One item here (like renaming a workspace) can spawn several Board cards over weeks. Different granularity, not just a different screen."
  3. **Try it yourself** — "Compare this list with your Board, then hit \"New item\" to create your first one."
- A `tracker_events` row per seeded item (`actor_id NULL`, payload includes `title` and `key`)
- Test coverage extending the existing string/regex-assertion convention in `tracker-migration.test.ts`

### Out-of-Scope
- Seeding on workspace creation — future workspaces get nothing from this migration; it is a backfill, not an ongoing mechanism (explicit user decision)
- Any client/UI change — `TrackerPage.tsx` already renders whatever exists in the database
- Label/priority attachment on seeded items — status only, avoids fragile vocab-name lookups for no teaching value
- Different treatment for workspaces that already contain real (non-onboarding) tracker items — seeded identically to any other existing workspace
- Different treatment for personal/solo vs team workspaces — copy is neutral, no branching logic
- Dismiss/hide mechanism beyond normal item delete
- Versioned re-seed mechanism for fixing typos post-deploy — manual `UPDATE`/`DELETE` on `tracker_items` is the correction path if needed
- Live-DB integration test — not this repo's convention for `schema.sql` changes

---

## Architecture Constraints

- Layers this work may touch: `server/src/db/schema.sql`, `server/src/db/tracker-migration.test.ts` only
- Layers this work must NOT touch: `client/`, any route file, `TrackerPage.tsx`, `TrackerSection.tsx`
- Patterns that must be followed: the exact `DO $$ / FOR ws IN SELECT id FROM workspaces LOOP` idempotent-seed shape at `schema.sql:432-461`; per-item counter allocation mirroring `tracker-items.ts:391-398`; string/regex-assertion test style from `tracker-migration.test.ts`
- Architecture validation result: **PASS**

---

## Dependencies

### Existing (to leverage)
- PostgreSQL 16 PL/pgSQL (`DO $$` blocks) — already the mechanism for the existing vocab seed
- No application code, no npm packages

### New (proposed)
None.

---

## Stories + Scenarios

### Story: Existing-workspace tracker onboarding
> As a workspace member landing on an empty Tracker page, I want to see example items explaining what Tracker is for, so that I understand it's for weeks-horizon product work — distinct from Board's daily ops — without reading documentation.

**Rule 1: Migration seeds exactly 3 items per existing workspace, once, idempotently**
- Example A: Workspace "Camel" (`tracker_key_counter=0`, no existing items) → gets 3 items, key_number 1, 2, 3 → CAM-1, CAM-2, CAM-3; counter ends at 3
- Example B: Workspace "Camel" already has 2 real items (`tracker_key_counter=2`, key_number 1, 2 used) → seed adds items with key_number 3, 4, 5; counter ends at 5, no collision

```gherkin
Scenario: Fresh existing workspace gets 3 onboarding items
  Given workspace "Camel" has tracker_key_counter=0, tracker_onboarding_seeded_at=NULL,
        and a status vocabulary including "Backlog"
  When  the migration (schema.sql) is applied
  Then  3 tracker_items rows exist for workspace "Camel" with key_number 1, 2, 3
  And   tracker_key_counter is updated to 3
  And   tracker_onboarding_seeded_at is set to a non-null timestamp
  And   3 matching tracker_events rows exist with actor_id = NULL and payload
        containing title and key

Scenario: Workspace with pre-existing real items is seeded without collision
  Given workspace "Camel" has tracker_key_counter=2 and 2 real items at
        key_number 1 and 2
  When  the migration is applied
  Then  3 new items are inserted with key_number 3, 4, 5
  And   tracker_key_counter becomes 5
  And   the pre-existing items (key_number 1, 2) are untouched

Scenario: Post-seed user-created item doesn't collide with seeded key_numbers
  Given workspace "Camel" was just seeded (counter now at 3)
  When  a user creates a new tracker item via POST /tracker/items
  Then  the new item receives key_number 4
  And   no UNIQUE (workspace_id, key_number) violation occurs
```

**Rule 2: Seeded items land in the workspace's best-available status; workspaces with zero statuses are skipped**
- Example C: Workspace has statuses `["Backlog" @1024, "Todo" @2048, "In Progress" @3072]` → all 3 seeded items get the "Backlog" row (name match preferred)
- Example D: Workspace renamed all statuses (no row named "backlog") but has `["Inbox" @512, "Doing" @1536]` → all 3 items get "Inbox" (lowest position, since no name match)
- Example E: Workspace has zero rows in `tracker_vocabularies` where `kind='status'` → migration skips this workspace entirely — no items, no counter bump, `tracker_onboarding_seeded_at` stays NULL

```gherkin
Scenario: Status resolution prefers a status literally named "backlog"
  Given workspace "Camel" has statuses ["Backlog", "Todo", "In Progress", "Done", "Canceled"]
  When  the migration is applied
  Then  all 3 seeded items have status_id equal to the "Backlog" row's id

Scenario: Status resolution falls back to lowest position when no "backlog" status exists
  Given workspace "Renamed" has statuses ["Inbox" @position 512, "Doing" @position 1536]
        with no row named "backlog" (case-insensitive)
  When  the migration is applied
  Then  all 3 seeded items have status_id equal to "Inbox" (lowest position)

Scenario: Workspace with no status vocabulary is skipped safely
  Given workspace "Ghost" has zero rows in tracker_vocabularies where kind='status'
  When  the migration is applied
  Then  no tracker_items rows are inserted for "Ghost"
  And   tracker_onboarding_seeded_at remains NULL for "Ghost"
  And   the migration completes successfully for all other workspaces (no
        transaction abort)
```

**Rule 3: Guard is a per-workspace flag, not content-based**
- Example F: Migration re-applied (deploy re-runs `schema.sql`) → workspace already has `tracker_onboarding_seeded_at` set → no-op
- Example G: User soft-deletes a seeded item (`deleted_at` set) → next migration run → item stays deleted, not resurrected

```gherkin
Scenario: Re-running the migration is a no-op
  Given workspace "Camel" already has tracker_onboarding_seeded_at set from a
        prior migration run
  When  the migration is applied again (schema.sql re-executed)
  Then  no new tracker_items rows are inserted for "Camel"
  And   tracker_key_counter is unchanged

Scenario: Deleted seeded item is not resurrected
  Given workspace "Camel" was seeded and the user has since soft-deleted one
        seeded item (deleted_at set)
  When  the migration is applied again
  Then  the deleted item remains deleted (not re-inserted)
```

**Rule 4: Every seeded item gets a matching, correctly-shaped activity row**
- Example H: Seeded item CAM-1's `tracker_events` row has `payload = {"title": "Welcome to Tracker", "key": "CAM-1"}`, `actor_id = NULL`

```gherkin
Scenario: Seeded item's activity rail renders without a broken title or actor reference
  Given a seeded tracker item CAM-1 with a tracker_events row where actor_id
        is NULL and payload includes title and key
  When  a user opens the item's detail page, including after later soft-deleting it
  Then  the activity rail renders a "created" entry with the correct title
  And   no actor username/avatar is shown, without throwing or rendering "undefined"
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — tracker-onboarding-seed-migration
Date: 2026-08-04 | Scope confirmed: yes

Rule: Idempotent 3-item seed per existing workspace
  ✓ Given a fresh workspace (counter=0), When migration runs, Then 3 items
    inserted at key_number 1,2,3 and counter=3
  ✓ Given a workspace with 2 existing real items (counter=2), When migration
    runs, Then 3 items inserted at key_number 3,4,5 and counter=5
  ✓ Given a workspace already seeded, When migration re-runs, Then no new
    items are inserted and counter is unchanged
  ✓ Given a post-seed workspace, When a user creates a new item via the API,
    Then it gets the next key_number with no UNIQUE violation

Rule: Safe status resolution, never aborts the migration
  ✓ Given a workspace with a status named "Backlog" (any case), When migration
    runs, Then seeded items use that status
  ✓ Given a workspace with no "backlog"-named status, When migration runs,
    Then seeded items use the lowest-position status
  ✓ Given a workspace with zero statuses, When migration runs, Then that
    workspace is skipped (no items, seeded_at stays NULL) and all other
    workspaces are still processed successfully

Rule: Guard survives user actions
  ✓ Given a seeded item is soft-deleted, When migration re-runs, Then the
    item is not resurrected

Rule: Activity row correctness
  ✓ Given a seeded item, When its detail page is opened, Then the activity
    rail shows a "created" entry with the correct title and no broken actor
    reference

OUT-OF-SCOPE (reminder for pocket-planning):
  - Seeding on workspace creation
  - Any client/UI change
  - Label/priority on seeded items
  - Special-casing workspaces with pre-existing real items
  - Personal vs team workspace branching
  - Dismiss/hide mechanism
  - Versioned re-seed / typo-fix mechanism
  - Live-DB integration test
```

---

## Design Decision

**Chosen option:** Option A — Per-item allocation loop

**Summary:** For each of the 3 items, run the counter bump (`UPDATE workspaces SET tracker_key_counter = tracker_key_counter + 1 RETURNING ...`) individually, immediately followed by that item's `INSERT` and its `tracker_events` `INSERT`. This mirrors the live route's per-item mechanics (`tracker-items.ts:391-398`) exactly, one full cycle per item.

**Rejected options:**
- Option B (single batched `+3` counter bump, then 3 inserts using computed offsets `v_counter-2`, `v_counter-1`, `v_counter`): rejected because the offset arithmetic is a real, easy-to-miss off-by-one risk class in raw PL/pgSQL that this repo's `schema.sql` tests cannot catch (string/regex assertions only, no live-DB execution check) — Option A's structural mirror of already-trusted production code eliminates that risk class entirely, and the 3-vs-1 UPDATE-statement difference is functionally free at "dozens of workspaces" scale.

**Key tradeoffs accepted:**
- 3 `UPDATE` statements per workspace instead of 1 — negligible cost, traded for maximal reviewability and reuse of a proven pattern
- Status resolution prefers a name match ("backlog") over pure position, extending the original position-only fallback decision from pitching — still never throws, degrades identically when no name match exists

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Should workspaces with zero statuses ever get flagged/retried differently? | Assumed: left unflagged (`tracker_onboarding_seeded_at` stays NULL), naturally retried on next `make db-migrate` | Low — self-healing; if a workspace never gains a status vocab, it simply never gets onboarding items, which is the correct outcome |

*(All Phase 3/4 blocking questions were resolved during discovery; table is otherwise empty.)*

---

## Implementation Notes

- Append the new `DO $$` block immediately after the existing block ending at `schema.sql:461` — Rule 2's status-vocab lookup depends on this ordering only insofar as both blocks are independent (no actual data dependency), but keeping the onboarding block last preserves reading order matching when each concern was introduced
- Add a test in `tracker-migration.test.ts` (or a new adjacent file) asserting the onboarding block's marker text appears after the vocab-seed block's marker text in the raw `schema.sql` string, to lock this ordering as an explicit invariant rather than an implicit one
- Status resolution SQL shape: `ORDER BY (lower(name) = 'backlog') DESC, position ASC, id ASC LIMIT 1` — never throws, degrades to lowest-position-then-id when no name match exists
- `tracker_events.payload` for each seeded item must be `jsonb_build_object('title', <item title>, 'key', <formatted key>)` to match the live route's shape (`tracker-items.ts:440-443`)

---

## Rollback Plan

- The new column (`tracker_onboarding_seeded_at`) is additive (`ADD COLUMN IF NOT EXISTS`) — safe to leave in place unused if the feature is reverted
- If seeded items need to be removed from production: `UPDATE tracker_items SET deleted_at = now() WHERE title IN ('Welcome to Tracker', "This isn't your Board", 'Try it yourself') AND deleted_at IS NULL` (soft delete, consistent with normal item deletion) — no code rollback needed since no application code changed
- If the migration block itself needs to be reverted before another deploy: remove the `DO $$` block from `schema.sql` — already-seeded workspaces keep their items (rollback of the migration source does not retroactively delete data), which is accepted since deleting user-visible items automatically would be a surprising side effect
