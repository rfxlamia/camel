# Work items: merge `tracker_items` into `cards` (single table)

**Date:** 2026-10-06
**Status:** approved (revised 2026-10-06: code-scan appendix merged)
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
**Supersedes (at Contract stage):** ADR `2026-09-board-tracker-dual-table.md`, spike `work-items-migration-spike.md`
**Issues:** closes #103 (at Contract stage only); relates to #100 (P1#3 SSE patch-in-place stays out)

---

## Summary

Board cards and tracker items already share one key namespace (`workspaces.tracker_key_counter`) but live in two tables merged at read time. This spec folds `tracker_items` into `cards`, makes `cards.column_id` nullable (NULL = planned item, not on a board), enforces one full `UNIQUE (workspace_id, key_number)`, and later renames `cards` to `work_items`. Cutover happens during a short planned maintenance window with an automated parity gate. A separate Contract PR, two weeks after success, removes the shim and the detection machinery.

---

## Glossary (anonymized stand-ins)
- **the reference workspace / the largest tracker-heavy production workspace:** the production workspace on `camel-ggf` with the most cards plus tracker items (2026-10-06: 25 live cards, 53 live tracker items, header counts 6 in progress / 16 done). Identify it with a read-only volume query; its name never appears in the repo.
- **`KEY-<n>`:** key number `n` with that workspace's key prefix.
- **`<camel host>`:** the site host served by the `camel-ggf` nginx (read it from the live file; never write it into a tracked file).
- **`camel-ggf`:** ssh alias of the production host. `bmad` / `camel.web.id` is decommissioned.
- **Local-only files:** host-specific deployment files (`deploy/*-ggf.sh`, `deploy/docker-compose.ggf.yml`, `deploy/nginx/camel-ggf.conf`, `deploy/maintenance/`, `deploy/CUTOVER-CHECKLIST.md`) are gitignored and never committed (decision 2026-10-06).

---

## Context

### Current State
- `cards` (470 rows in prod) and `tracker_items` (180 rows) are separate tables; `listMergedWorkItems()` (`server/src/lib/work-item-response.ts:387`) loads both unpaginated, dedups tracker-wins, sorts in memory.
- `cards.key_number` is nullable and only has a non-unique partial index (`idx_cards_workspace_key_live`); a test (`board-tracker-unify-migration.test.ts:108`) pins "no unique constraint on cards" with no recorded rationale (commit `05e4fc3`, "idempotent backfill").
- Key allocation is duplicated: `allocateCardIdentity` (needs a column) and an inline copy in `modules/tracker/tracker-item-create.ts`.
- Two event tables (`card_events`, `tracker_events`) with near-identical shape; `card_events.card_id` and `to_column_id` are already nullable (`schema.sql:80-82`).

### Problem / Motivation
Identity uniqueness is enforced only by application discipline. #103's gates (key collision cron, mutation-routing guard, latency log) detect symptoms but do not remove the cause; the ADR's own "Must resolve BEFORE" list (agent auto-mutate, public API, audit export, bulk edit) covers most of the roadmap. Maintainer is a solo developer who returns to the project after weeks away, so the end state must carry no standing shim and every step must be resumable.

### Production evidence (read-only, `ssh camel-ggf`, 2026-10-06)
37 workspaces; the largest tracker-heavy production workspace: 25 live cards + 53 live tracker items = 78 (matches UI). 0 cross-table key overlaps (including soft-deleted), 0 duplicate keys inside `cards`, 0 live cards with NULL key, 0 NULL `workspace_id`, counters >= max key everywhere. 17 soft-deleted cards still hold keys. All 180 tracker ids collide with some card id (new ids are mandatory). `tracker_events`: 81 rows have `tracker_item_id IS NULL` (project/phase events: `tracker_project_*`, `tracker_phase_*`), the rest are `tracker_item_created/updated`; none of these `event_type` strings collide with board types (`move`, `update`, `create`, ...). `focus_sessions`: 1 row (board, finished), 0 pointing at tracker ids today. 18 live cards sit on non-default boards (`columns.board_id` 1..6).

### Related Areas
About 58 non-test query sites on `cards` (see Appendix C for the inventory); 9 files never mention `columns` (audit list: `core/work-item-debt.ts`, `modules/chat/tools/factory.ts`, `modules/board/card-create-attachments.validation.ts`, `modules/board/card-events.ts`, `modules/board/metrics.ts`, `modules/agent/service-deps-activity.ts`, `modules/tracker/tracker-project-delete.ts`, `modules/focus/focus-session-repo.ts`, `modules/tracker/tracker-phase-queries.ts`); 22 touch tracker tables. `board/metrics.ts` does not read `card_events`.

---

## Scope

### In-Scope
- One work item table: `tracker_items` folded into `cards`; `column_id` nullable; full `UNIQUE (workspace_id, key_number)` including soft-deleted rows; `cards` renamed `work_items` at Contract stage.
- Production data migration: tracker rows copied with new ids, same `key_number`; labels, assignees, `tracker_events`, and `focus_sessions` references remapped.
- Single event table (`card_events`, renamed `work_item_events` at Contract) and single label/assignee junction pair.
- One shared key allocator (with a column-less path; status chosen from the tracker vocabulary as today).
- Same HTTP contract (`/work-items/:key`, `/cards/:id`, `source` derived from `column_id`; `GET /work-items` still excludes cards on non-default boards via `board_id IS NULL`).
- Deploy tooling: maintenance mode, verified backup, retained old image/client, application-level parity gate, restore script, extend the existing `deploy/deploy-ggf.sh` + `docker-compose.ggf.yml` (already target `camel-ggf`; `deploy.sh`/`bmad` is the stale path), `BACKGROUND_JOBS` switch. All host-specific deployment files stay local and gitignored; they are never committed.
- Contract PR (separate, scheduled 2 weeks after success): drop `tracker_items`, remove merge/dedup code, `check:key-collisions`, `work-item-debt.ts`, nightly smoke, `deploy/DEBT-CHECKS.md` cron, source-branching in `workItemMutations` and its guard, `recordTrackerActivity` + allowlist entry, inline counter; make `schema.sql` correct for brand-new empty databases (the existing backfill at `schema.sql:816-869` references `tracker_items` (`:830`)); supersede the ADR; close #103.

### Out-of-Scope
- "Promote to board" flow/UI (PATCH with `column_id` on a column-less item is rejected, not enabled).
- Merging meaning of overlapping date columns (`done_at`/`completed_at`, `started_at`/`start_date`, `due_date`/`end_date` stay separate).
- Any UI change; decision on non-default-board cards (behavior unchanged).
- SSE patch-in-place (#100 P1#3), #115, #119, #124.
- Dropping `tracker_items` before the 2-week mark.
- Zero-downtime cutover / dual-write / shadow-read (rejected by maintainer: planned downtime accepted).

---

## Architecture Constraints
- May touch: `server/src/db/schema.sql`, `db/types.ts`, server kernel (`lib/work-item-response.ts`, `card-assignees`), `modules/board|tracker|my-work|focus|agent|chat|notifications|activity`, `deploy/*`, CI scripts, docs.
- Must NOT touch: client beyond what typecheck forces and the forced-reload version bump; `camel-lottie/`; Redis/SSE topology.
- Follow: `.js` import extensions, `recordActivity` on every mutation, new files <= 300 lines, idempotent SQL, 409 on stale `version`, feature-module convention (#129).
- Architecture validation (Phase 6): PASS.

---

## Dependencies

### Existing (to leverage)
- `kysely`, `pg` — queries and the single-transaction migration runner (`migrate.ts` already wraps all three schema files in one `BEGIN/COMMIT`).
- `zod` — request validation for any touched route (existing helper `validators/http.ts`).

### New (proposed)
none. A migration framework (e.g. Kysely `Migrator`) was considered and rejected: the repo has none, adopting one is scope creep; the existing idempotent `DO` block pattern is used.

---

## Stories + Scenarios

### Story 1: Merge without losing anything
> As the maintainer, I want tracker items folded into the cards table, so that identity is guaranteed by the database and the shim can be deleted.

**Rule 1: Same data, same keys, new ids**
```gherkin
Scenario: Reference production workspace is preserved
  Given the reference workspace has 25 live cards and 53 live tracker items
  When the migration runs
  Then Tracker lists 78 items, Board shows 25 cards with header 6 in progress / 16 done, and KEY-33 is still KEY-33

Scenario: A tracker item keeps all its data
  Given KEY-33 has a project, a phase, 2 assignees, 1 label and 5 events
  When it is migrated
  Then it is a row with column_id NULL, same key/title/project/phase/status/priority/dates/version, and its assignees, labels and events reference the new row

Scenario: Tracker-native items never count as board cards
  Given a row with column_id NULL
  When board, flow-metrics, my-work and notification-scheduler queries run
  Then the row is never counted as a board card and soft-deleted rows appear in no board/metrics/list query

Scenario: Workspace with no tracker items
  Given a workspace with 0 tracker items
  When migrated
  Then nothing changes for it

Scenario: Focus sessions follow their task
  Given a focus_sessions row with task_source='tracker' and task_id = old tracker id
  When migrated
  Then task_id (and return_path if it embeds the old id) point at the new row and no orphan remains
```

**Rule 2: Run-once, all-or-nothing**
```gherkin
Scenario: Re-run after go-live is a no-op
  Given all tracker rows have migrated_to_id set and users have edited KEY-33 afterwards
  When the container restarts
  Then the migration block is skipped entirely, assertions do not run, and the server starts normally

Scenario: Failure inside the block
  Given any parity assertion fails
  When the migration runs
  Then the whole transaction (including DROP NOT NULL and migrated_to_id) rolls back, the container does not start, and the old image can boot unchanged

Scenario: Late write to the old table
  Given the cutover is complete
  When anything inserts into tracker_items
  Then a BEFORE INSERT trigger raises and no un-migrated row appears

Scenario: Counter is repaired
  When the migration runs
  Then tracker_key_counter = GREATEST(counter, MAX(key_number) over all cards including soft-deleted) for every workspace
```

**Rule 3: One identity, enforced by the database**
```gherkin
Scenario: Duplicate key rejected
  When two items in one workspace are inserted with the same key_number (soft-deleted included)
  Then the unique index rejects the second

Scenario: Both entry points use one allocator
  When a card is created on a board and an item is created in Tracker
  Then both take keys from the same allocator and get consecutive keys
```

### Story 2: Same behavior for clients
> As a team member, I want Board and Tracker to look and behave exactly as before, so that the change is invisible except for a maintenance window.

```gherkin
Scenario: HTTP contract unchanged
  When the unchanged client calls GET /work-items, PATCH /cards/:id, PATCH /work-items/:key
  Then response shapes are unchanged and `source` is "tracker" when column_id IS NULL, otherwise "board"

Scenario: Column-less item through board-only endpoints
  Given an item with column_id NULL
  When PATCH /cards/:id or a move is attempted, or PATCH sets column_id
  Then the request is rejected (404 / 4xx) and no promote happens

Scenario: Non-default-board cards
  Given 18 cards on boards 1..6
  When GET /work-items is called
  Then they are still excluded (board_id IS NULL expressed explicitly)

Scenario: Activity feed
  Given copied tracker events now live in card_events
  When the unified activity feed loads
  Then each event appears once, source derived from the item's column_id (NULL => tracker), item-less project/phase events are kept with workspace_id and no card, and readers tolerate NULL card_id / NULL to_column_id
```

### Story 3: Safe cutover
> As the maintainer, I want a rehearsed, mostly automatic cutover, so that I can run it at night without remembering details.

```gherkin
Scenario: Maintenance during the window
  Given the maintenance flag is on
  When any request hits the web vhost (502/503/504) or the api vhost
  Then web shows the maintenance page; api returns JSON 503 with Retry-After, SSE /events returns 503

Scenario: Application-level parity gate
  Given a snapshot of the old system (keys per workspace, Tracker count, Board count, header counts) taken before shutdown
  When the new server runs behind maintenance with BACKGROUND_JOBS=off and queries on localhost:3001 are compared
  Then maintenance is lifted only if all workspaces match; otherwise it stays on

Scenario: SQL parity gate (inside the block, scoped to rows being migrated)
  Then counts, per-row fields (title, status, project, phase, dates, version), orphan checks for labels/assignees/events/focus_sessions, and counter >= max key all pass or the block raises

Scenario: Backup failure aborts before any change
  Given the pg_dump fails or cannot be verified restorable
  Then the deploy stops before touching the database

Scenario: Forced reload
  When the gate passes and traffic resumes
  Then old SSE connections are dropped and a version bump forces open tabs to reload
```

---

## Acceptance Criteria

```
Rule: Data is preserved
  ✓ Given the reference workspace (25 cards + 53 items), When migrated, Then Tracker = 78, Board = 25, header 6/16, keys identical
  ✓ Given any tracker item, When migrated, Then all fields, assignees, labels, events, focus references follow the new row
  ✗ Given any parity mismatch, When the block runs, Then it raises, rolls back, and the app stays down

Rule: Run-once safety
  ✓ Given all rows migrated, When the container restarts, Then the block is skipped and nothing changes
  ✗ Given an insert into tracker_items after cutover, When it executes, Then the trigger raises

Rule: Identity is database-enforced
  ✓ Given one table with UNIQUE (workspace_id, key_number), When duplicates are inserted, Then they are rejected
  ✓ Given counters, When migration finishes, Then counter >= max key in every workspace

Rule: Client contract unchanged
  ✓ Given the unchanged client, When it calls existing endpoints, Then shapes and `source` values are unchanged
  ✗ Given a column-less item, When board-only actions or column_id PATCH are attempted, Then rejected

Rule: Cutover is safe and recoverable
  ✓ Given a verified backup, kept old image/client and a rehearsal on a production dump, When the gate passes, Then maintenance lifts
  ✗ Given backup failure or any gate failure, When deploying, Then nothing opens

Rule: Shared allocator and counter
  ✓ Given a board create and a Tracker create in one workspace, When both run, Then keys are consecutive from one allocator (column-less path included)
  ✓ Given any workspace after migration, When counters are read, Then counter >= MAX(key_number) including soft-deleted rows

Rule: Cutover gates
  ✗ Given pg_dump fails or cannot be verified restorable, When deploying, Then the deploy stops before touching the database
  ✓ Given the gate passes, When traffic resumes, Then SSE connections are dropped, a version bump forces reload, and SSE payloads carry the NEW ids

Rule: Feeds and board scope
  ✓ Given copied tracker events, When /activity and the unified feed load, Then /activity is unchanged (no project/phase events) and the unified feed shows each event once
  ✓ Given 18 cards on non-default boards, When GET /work-items is called, Then they are still excluded via board_id IS NULL
  ✗ Given a column-less item, When /cards/:id or a move is called, Then 404; PATCH with column_id returns 400

Rule: Contract (separate PR, +2 weeks)
  ✓ Given success, When Contract ships, Then tracker_items, merge/dedup, collision check, debt cron, routing guard, source branching, trigger and old ADR are gone, schema.sql is correct for empty DBs, and #103 closes
```

---

## Design Decision

**Chosen option:** Option B — idempotent one-shot `DO` block in `schema.sql`, atomic with its own parity assertions, plus deploy-script wrapper for backup/maintenance/restore.

**Summary:** `entrypoint.sh` uses `set -e` and `migrate.ts` runs all schema files in one transaction and exits 1 on error, so a failed assertion rolls back everything and the container never starts: the app stays down, exactly the desired behavior. Follows the existing `DO $board_tracker_key_backfill$` pattern. Run-once marker: `tracker_items.migrated_to_id`; copy and assertions run only while at least one row has `migrated_to_id IS NULL`.

**Rejected options:**
- Option A (separate one-shot script + ledger table): new mechanism and a manual step that can be forgotten between long absences; richer TS checks are recovered by the app-level gate.
- Option C (zero-downtime dual-write/shadow read): temporary debt layer; maintainer accepted planned downtime.
- CTI / registry-table designs: unnecessary once a single table can hold both facets; rejected for adding permanent joins.

**Key tradeoffs accepted:**
- Migration logic lives in SQL; testing relies on integration tests plus a rehearsal on a production dump.
- After reopening, only a backup restore reverses the change; edits made since are lost. Decision window ~15 minutes.
- `tracker_items` retained 2 weeks is forensic only, not a rollback path.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Meaning of overlapping date columns | assumed: stay separate | Later merge needs another migration |
| Non-default-board cards in unified list | assumed: unchanged (excluded) | 18 cards remain invisible in Tracker; separate decision |
| Soft-deleted tracker rows | assumed: migrated too, excluded everywhere | None today (0 rows) |
| Restore | decided: user-triggered script, restores DB and redeploys old image | Manual error if script is not rehearsed |
| Tracker events into `card_events` | decided; `card_events.card_id` is `ON DELETE CASCADE` (`schema.sql:25`, unchanged by `:82`): keep it, cards are soft-deleted in practice | Events vanish only on a hard delete, which the app does not do |
| `task_source` for migrated focus sessions | decided: keep 'tracker', remap `task_id` (Appendix B.4) | Focus return path could break; verify in `focus-session-inputs.ts` |
| Scheduler/agent pause | no env flag exists; add `BACKGROUND_JOBS` | Notifications from migrated data could fire before the gate |

---

## Implementation Notes (from two edge-case-hunter cycles; all planner-fixable)

- Order inside `schema.sql`: `ALTER COLUMN column_id DROP NOT NULL` and the full unique index before the copy; DO block after tracker satellite schema (~:512-560), vocabulary slot constraints, and the key backfill (`:816-869`). No `CREATE INDEX CONCURRENTLY` (illegal in a transaction). Create the BEFORE INSERT trigger on `tracker_items` after the block, conditional, droppable with the table.
- Copy with `INSERT ... SELECT` using default ids (never explicit ids); `COALESCE(position, ...)` because `cards.position` is NOT NULL while tracker `position` is nullable; keep a separate planning-position column rather than overloading board `position`.
- Assertions scoped to migrated rows only (never whole-table equality); counter repair `GREATEST(counter, MAX(key_number))` over all cards including soft-deleted.
- Re-scan every id-only reference to tracker ids: `focus_sessions.task_id`, `modules/my-work`, `core/my-work-mark-done`, `lib/tracker-activity`, `modules/focus`, JSONB payloads (`card_events.payload`, notifications). The earlier prod check missed `focus_sessions` because it has no FK.
- Verify list/metrics queries: INNER JOIN `columns` drops column-less rows (correct for boards, wrong for lists); use LEFT JOIN where `source='tracker'` is expected.
- Event readers to adapt: `lib/work-item-events.ts:270` (stop reading `tracker_events`; the `card_id IS NOT NULL` filter hides item-less events), `modules/activity/activity.ts` (`toActivityEvent`), `agent/service-deps-activity.ts:24`, `chat/tools/factory.ts:50` (assume `payload.cardTitle` and column titles; NULL `to_column_id` must not render "undefined"). `agent/ticket-intake/history.ts` filters `event_type='linear_ticket_created'` and is safe.
- Maintenance: nginx `error_page` for 502/503/504 on the web vhost; JSON 503 + `Retry-After` on api; `/events` returns 503. None exists today, so ship and test it in a no-op deploy before cutover day.
- `deploy.sh` overwrites `camel-server:latest` and `/var/www/camel`: explicitly retag the old image and copy the old client dist first. Build the cutover on `deploy/deploy-ggf.sh` (already `SSH_HOST="camel-ggf"`); treat `deploy.sh`/`bmad` as stale and update the `camel-server` skill.
- Audit: one log record per workspace with counts before/after; `recordActivity` is not called per migrated row.

---

## Rollback Plan

- **Failure inside the DO block:** transaction rolls back; redeploy the old image; no restore needed.
- **Failure after reopening:** run the restore script (DB from verified backup + redeploy retained old image + old client dist); edits made since reopening are lost, so decide within ~15 minutes.
- **After the Contract PR:** no rollback path other than backups; Contract only ships after 2 quiet weeks.

---

## Appendix: code scan and reading test (merged 2026-10-06)

Two read-only subagents (spec-vs-code reading test; impact scan) reviewed this spec; the advisor was unavailable (overloaded). Items marked [verified] were re-checked by the main agent; the rest are subagent findings with file:line evidence to re-confirm in planning. Where this appendix and the sections above disagree, the appendix wins.

### A. Corrections found by the reading test

| # | Spec says | Code says |
|---|-----------|-----------|
| 1 | Change `deploy.sh` host from `bmad` to `camel-ggf` | [verified] `deploy/deploy-ggf.sh` and `deploy/docker-compose.ggf.yml` already exist and use `camel-ggf`. The cutover tooling extends `deploy-ggf.sh`; decide whether `deploy.sh`/`docker-compose.prod.yml` are deleted as dead in the Contract PR. |
| 2 | "FK delete behavior of `card_events.card_id` to be verified" | [verified] `schema.sql:25` is `ON DELETE CASCADE`; `:82` only drops NOT NULL. Closed: cascade stays. Cards are soft-deleted in practice, and column-less items are exempt from column-delete cascades. Document it, do not change it. |
| 3 | Backfill at `schema.sql:810` | The block spans `:816-869`; its `tracker_items` reference is at `:830`. |
| 4 | Test pin at `board-tracker-unify-migration.test.ts:108` | `it(` at `:108`, assertions at `:113-118`. It slices `cardsBlock` (`:12-22`) and `unifySql` (from `:541`), so a unique index anywhere in those slices fails it; the test is rewritten, not bypassed. |
| 5 | "30 files touch cards / 22 touch tracker tables" | The pattern was unstated and not reproducible. The scan found about 58 non-test query sites on `cards` (about 24 files mention tracker tables). Use the inventory in section 3 as the planning baseline. |
| 6 | "Failure inside the block: the old image can boot unchanged" | Only true when the block rolled back. After a successful cutover the old image cannot run (its inserts hit the trigger); the only way back is the backup restore. Reword the rollback plan. |
| 7 | Client unchanged | Still achievable, but 6 client files compare numeric ids from SSE (`trackerItemId`) and focus (`taskId`): `focusGuards.ts`, `FocusPage.tsx`, `TrackerDetailPage.tsx`, `TrackerPage.tsx`, `FocusSessionContext.tsx`, `FocusEntryButton.tsx`. Ids are opaque to the client, so no client change is needed as long as the server emits the NEW ids everywhere and the forced reload clears stale tabs. Add a test that SSE payloads carry the new id. |

### B. Gaps closed with default decisions (binding for planning)

1. **`updated_at`:** `tracker_items` has it, `cards` does not (a computed `computeCardUpdatedAt` exists). Default: add a real `updated_at` column to the merged table, set from tracker for migrated rows and from the computed value for cards.
2. **Target columns for tracker-only fields:** default: add `start_date`, `end_date`, `completed_at` and a separate `plan_position` (nullable) to `cards`; migrated `plan_position` uses `COALESCE(position, <derived order>)` and board `position` for column-less rows is a derived non-null placeholder, never read for ordering. Overlapping meanings stay separate (as already decided).
3. **Event copy rules:** copy item events and item-less project/phase events; keep original `event_type` and `created_at`; new `card_events.id` from the sequence (never explicit ids); copied rows get `workspace_id`. Existing main `/activity` feed keeps today's behavior by excluding `tracker_project_*` and `tracker_phase_*` events (they stay visible only in the unified feed).
4. **`focus_sessions`:** default: keep `task_source='tracker'` for migrated tracker tasks (the repo branches on it at `focus-session-repo.ts:229-262`; the lookup then reads the merged table), remap `task_id`, rewrite `return_path` (`/tracker/<key>` uses the key, so it normally needs no change; verify in `focus-session-inputs.ts`).
5. **Rejection status:** column-less item on `/cards/:id` or move returns 404 from `/cards` endpoints; `PATCH` with `column_id` on a column-less item returns 400 via `parseWith`/`sendValidationError`.
6. **Marker semantics:** `migrated_to_id` is the new `cards.id`, set inside the same DO block; rows inserted into `tracker_items` by the old image between backup and cutover cannot exist because the server is down (and the trigger blocks later inserts).
7. **`BACKGROUND_JOBS=off`:** pauses scheduler, agent workers and Redis subscribers; `on` is the default when unset.
8. **Windows:** the 15-minute decision window is advisory; the restore script prints elapsed time but does not enforce it. The 2-week retention clock starts when maintenance is lifted.
9. **Counter repair** applies to every workspace (the existing backfill only repairs workspaces with pending NULL-key cards, `schema.sql:834-839`).
10. **Soft-deleted cards with NULL keys** (if any) are allowed to stay NULL; the unique index ignores NULLs. Prod has 0 live NULL keys.
11. **Acceptance gaps:** add acceptance rules for the shared allocator, counter repair, backup-failure abort, forced reload, activity feed and non-default-board exclusion (scenarios exist, rules do not).
12. **Contract PR must also edit** statements that re-run on every start and reference tracker tables: `schema.sql:398` (`CREATE TABLE IF NOT EXISTS tracker_items`), `:512-517`, `:537-539`, `:830`, `:931-943`; the redundant partial index `idx_cards_workspace_key_live` (`:611-613`); `scripts/check-event-write-routing.mjs:15,68` allowlist; `deploy/DEBT-CHECKS.md`, `deploy/debt-check.cron.example`; `tracker-contracts.smoke.ts` if it is the nightly smoke.

### C. Impact inventory (NULL-column rows) — planning baseline

**Must gain `column_id IS NOT NULL` (or equivalent) because they would count planned items:**
- `modules/board/metrics.ts:11` (flow metrics)
- `modules/chat/tools/factory.ts:33` (chat board data)
- `modules/agent/service-deps-activity.ts:10` (agent timestamps)
- `modules/board/board.ts:64-117` (`GET /board` loads then silently drops NULL rows at a `Map<number,...>`; filter in SQL instead)

**Must reject column-less items explicitly (no column guard today):**
- `modules/board/cards-update.ts:70,107,163`, `cards-delete.ts:44,63-79`, `card-read.ts:13`, `card-attachments.ts:73`, `card-attachment-persistence.ts:72`, `core/board-card-status-change.ts:39-194`, `core/my-work-mark-done.ts:101-109,221,230`, `modules/focus/focus-session-repo.ts:229`.

**Type change:** `db/types.ts:201` `Cards.column_id: number` becomes `number | null`; `typecheck` will flag the `Map<number,...>`/arithmetic users (`remap-card-statuses.ts:10,23,57-59`, `work-item-response.ts:59`, `cards-delete.ts:38,79`, and others).

**Already safe via inner join on `columns`:** `notifications/scheduler.ts:7-9` (planned items with due dates get no reminders: confirm that is intended), `my-work-data-source-list.ts:107`, `my-work-data-source-detail.ts:47`, `agent/board-db.ts:134,180-196`, `card-attachment-delivery.ts:62-68`, `card-positions.ts:21-27`, WIP counts (`card-create-validation.ts:98-103`, `cards-move.ts:143`).

**Event readers to adapt:**
- `lib/work-item-events.ts:276` filters `card_id IS NOT NULL`; item-less events would vanish.
- `lib/work-item-events.ts:104-150` (`toCardTrackerEvent`) relabels every type other than create/delete as `tracker_item_updated`; `tracker_*` types must pass through unchanged.
- `modules/activity/activity.ts:64-71`, `chat/tools/factory.ts:50`, `agent/service-deps-activity.ts:24`: unfiltered; merged tracker events would reach the LLM and the feed (see decision 3).
- `recordTrackerActivity` callers (9 files) become `recordActivity` callers; its type union covers `tracker_item_{created,updated,deleted}` and `tracker_vocabulary_created` only, so project/phase call sites (`tracker-project-serialize.ts`, `tracker-phase-queries.ts`) need reading.

**Id-only references:** `focus_sessions.task_id` (no FK); SSE `trackerItemId` (`realtime/types.ts:53`, `my-work-router.ts:252`); the 6 client files above; client storage holds no item ids; my-work URLs use identity (workspace, source, key).

**Tests that pin old behavior (rewrite in the same PR):** `db/board-tracker-unify-migration.test.ts` (+ `.integration`), `db/tracker-migration.test.ts`, `db/full-migration.integration.test.ts`, `lib/work-items.test.ts`, `lib/work-item-events.test.ts`, `lib/tracker-activity.test.ts`, `core/work-item-debt.test.ts`, `core/my-work-mark-done.test.ts`, `routes/work-item-unified.integration.test.ts`, `routes/cards-identity.integration.test.ts`, `modules/board/card-attachments-soft-delete.integration.test.ts`, `modules/my-work/my-work.integration.*`, `modules/tracker/tracker-items.*`.

### D. Not verified (carry into planning)
`activity.ts` function names; the `recordTrackerActivity` allowlist entry; shapes of the my-work and scheduler queries beyond the join; `card-attachment-cleanup.ts` and `attachment-response.ts` WHERE clauses; whether the `tracker_project_*` call sites go through `recordTrackerActivity`; production numbers (measured separately, read-only, on 2026-10-06).
