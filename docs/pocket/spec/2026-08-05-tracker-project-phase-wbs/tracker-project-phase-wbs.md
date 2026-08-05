# Tracker Project / Phase / WBS

**Date:** 2026-08-05
**Status:** approved
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/tracker-project-phase-wbs.md

---

## Summary

Tracker is a flat, workspace-scoped list grouped by status, so it cannot represent long-horizon plans. This cycle inserts two optional parent layers above the existing `tracker_items` entity — **Project** (a sub-workspace container, capped at 10) and **Phase** (a named stage inside a project) — plus scheduling (`start_date`, `end_date`), derived rollup progress, overdue signalling, and manual ordering. It also fixes the foundation both rollup and overdue depend on: status vocabulary gains a machine-readable `category`, and the status vocabulary is closed to the five seeded rows.

The change is almost entirely **additive**. No existing row is rewritten, no key is reissued, and `/tracker` keeps its current behaviour for items that are not in a project. This cycle produces the data a future Roadmap will consume; it does not render a timeline.

---

## Context

### Current State

- Tracker shipped 2026-08-03 (`docs/pocket/spec/2026-08-03-tracker-entity/tracker-entity.md`): `tracker_items`, `tracker_vocabularies` (kind `status`/`priority`/`label`, fractional `position`), `tracker_item_labels`, `tracker_item_assignees`, `tracker_events` + `recordTrackerActivity()`, per-workspace SSE, `version` + HTTP 409, `deleted_at`.
- The grouping axis is a single call site: `client/src/pages/TrackerPage.tsx:120-123` calls `groupItemsByStatus(filteredItems, statuses)` and then maps over `statuses`. Changing the axis is a different selector, not a new paradigm.
- `GET /tracker/items` returns every non-deleted item in the workspace with no pagination (`server/src/routes/tracker-items.ts:331-334`); the client derives all display state from that list.
- `tracker_items` has no `position` column; rows sort `created_at ASC` (`client/src/lib/trackerUtils.ts:11-16`).
- There is no `boards` table. `columns` and `cards` reference `workspace_id` directly (`server/src/db/schema.sql:113-114`). Project is therefore a clean new axis inside Tracker, not a competing third boundary.
- `server/src/db/migrate.ts:9-18` executes all of `schema.sql` in one transaction on **every** `make db-migrate`. There is no migration-tracking table; idempotency must be expressed in the SQL itself. The only existing precedent is the `WHERE NOT EXISTS` seed block at `schema.sql:432-461`.

### Problem / Motivation

- Members planning multi-month work have no container for stages, no rollup, and no schedule on items.
- Status carries no machine-readable semantics. `client/src/components/tracker/TrackerGlyphs.tsx:8,27` infers meaning from `CANCELLED = /cancel/i` plus `position` rank — a status named "Batal" or "Selesai" already renders wrong today. Rollup percentage and overdue colouring both depend on this missing signal.
- `PATCH /tracker/items/:key` accepts any integer `statusId` with no workspace or kind check (`server/src/routes/tracker-items.ts:551-556`), while `labelIds`/`assigneeIds` are validated (`:228-239`, `:295-300`). New foreign keys must follow the validated precedent, not the unvalidated one.
- **Vocabulary is never provisioned at workspace creation.** All three production paths — `server/src/routes/workspaces.ts:85`, `server/src/auth.ts:415`, `server/src/routes/oauth.ts:75` — insert the workspace and its membership row and nothing else. The five statuses come only from the retroactive seed block in `schema.sql:432-461`, which runs at migrate time over workspaces that exist *then*. A workspace created after the last `make db-migrate` therefore has zero statuses, and `getBacklogStatusId` (`tracker-items.ts:304-319`) throws `"Backlog status not found for workspace"` on first item create. This is a pre-existing bug; the only runtime path that could patch it is `POST /tracker/vocabularies` (`tracker-vocabularies.ts:113`) — the exact endpoint this cycle closes. Provisioning is therefore in-scope, not optional.
- `tracker.vocabulary.created` is published with no payload (`tracker-vocabularies.ts:141-144`) while the client handler reads `event.payload.kind` (`TrackerPage.tsx:71-85`), so a new status never appears live today. The working precedent is two lines below at `TrackerPage.tsx:100-106`, which simply calls `loadData()`.

### Related Areas

- `server/src/db/schema.sql` — two new tables, six new columns, guarded backfills
- `server/src/routes/tracker-items.ts` (878 lines) — split mechanically before project/phase routes land
- `server/src/routes/tracker-vocabularies.ts` — `category` in `RETURNING_COLUMNS`, POST closed for `kind='status'`
- `server/src/routes/helpers.ts:8-22` — `getWorkspaceCapacity` is the cap precedent (returns **409**)
- `server/src/routes/workspaces.ts:85`, `server/src/auth.ts:415`, `server/src/routes/oauth.ts:75` — the three workspace-creation transactions that must now seed vocabulary
- `server/src/routes/cards.ts:765-795` — precedent for `done_at` stamping and for rewriting sibling `position` without bumping `version`
- `server/src/core/position.ts` — fractional ordering, `positionBetween`, `rebalance`
- `server/src/realtime.ts` — new SSE event types on the existing per-workspace channel
- `client/src/pages/TrackerPage.tsx` — home; `:126` short-circuits the whole render on empty search results and must learn about in-project matches; `:68-107` no-ops on unknown SSE types and must learn the new ones
- `client/src/lib/trackerUtils.ts` — grouping and the new derivation helpers
- `client/src/components/tracker/TrackerGlyphs.tsx` — drops name-regex inference
- `client/src/App.tsx:67-73` — `/tracker/p/:id` must be registered so it never falls through to the `tracker/:key` route

---

## Scope

### In-Scope

**Data**
- `tracker_projects` — workspace-scoped, name, nullable `start_date`/`end_date`, fractional `position`, `version`, `deleted_at`, cap 10
- `tracker_phases` — project FK, name, subtitle, fractional `position`, nullable `start_date`/`end_date`, `version`, `deleted_at`
- `tracker_items` — new nullable `project_id`, `phase_id`, `start_date`, `end_date`, `completed_at`, `position`
- `tracker_vocabularies.category` on `kind='status'`: `backlog | started | completed | canceled`, backfilled
- Guarded, re-runnable backfills (`WHERE … IS NULL`) for `category` and `position`

> `tracker_projects.start_date`/`end_date`/`position` ship as **schema only** this cycle — no UI reads or writes them, and project bounds render from the derived `MIN`/`MAX` of tasks. They exist so the Roadmap cycle, whose primary object is a project bar on an ordered row, does not open with a migration on a table this cycle just created. The date semantics, when a UI arrives, are the same explicit-wins-per-field rule phases use.

**Behaviour**
- Status vocabulary closed: `POST /tracker/vocabularies` with `kind='status'` → 400; `priority` and `label` stay open
- **Vocabulary provisioning on workspace creation** — the five statuses, three priorities and three labels are seeded in the same transaction that creates a workspace, at all three creation paths (`server/src/routes/workspaces.ts:85`, `server/src/auth.ts:415`, `server/src/routes/oauth.ts:75`). This closes a pre-existing latent bug that the status lock would otherwise make unfixable without a deploy (see Context)
- Derived rollup at phase and project level, never stored
- Overdue signalling; visual only, never blocking
- Phase dates explicit-with-per-field-fallback to `MIN`/`MAX` of children
- `completed_at` stamped on entering a completed status, cleared on leaving
- Delete phase → tasks get `phase_id = NULL`; delete project → tasks get `project_id`/`phase_id` NULL and phases are soft-deleted
- Manual task ordering scoped per `(project_id, phase_id)` bucket

**Surfaces**
- `/tracker` becomes Tracker home: project cards above, unassigned items grouped by status below (today's behaviour preserved)
- `/tracker/p/{id}` — project WBS page: phases with rollup, date range, "No phase" section
- Search reaches items inside projects, rendered with a `Project › Phase` trail
- Date fields on the create modal and the detail page
- Drag reorder UI (last plan phase, cuttable)

**Plumbing**
- Project/phase routes with `requireWorkspaceMember`, `version` + 409, `deleted_at`
- **A dedicated reorder endpoint for tasks** — `PATCH /tracker/items/:key` explicitly ignores `position`, so reorder needs its own route. It survives even if the drag UI is cut
- New SSE event types; `recordTrackerActivity()` on every project/phase mutation with `tracker_item_id = NULL`
- Targeted extraction of parse/validate helpers from `tracker-items.ts` **before** new routes are added

### Out-of-Scope

- **Comments and attachments on tracker items** — visible in the reference screenshot; Tracker has no comment subsystem, and inheriting one would double this cycle
- **Roadmap / Gantt rendering** — this cycle produces the inputs (`start`, `end`, phase, rollup); drawing the timeline is its own cycle
- **Any Board change** — carried forward from the `tracker-entity` spec; Board rendering, card/column mutation paths, `card_events`, `recordActivity()` and `activity.ts` stay untouched
- **Tracker ↔ card linkage** — still deferred
- **Per-project status vocabularies** — status stays workspace-scoped
- **Re-keying items under a project prefix** — `FA-N` is a stable citation already circulating in chat; allocation stays on `workspaces.tracker_key_counter`
- **Changelog UI for project/phase events** — events are recorded, no reader is built this cycle
- **Fixing the unvalidated `statusId` path** (`tracker-items.ts:551-563`) — a known pre-existing hole; fixing it here widens the blast radius
- **Bookmarkable project routes beyond `/tracker/p/{id}`** — sidebar entries and a project index remain a purely additive future upgrade

---

## Architecture Constraints

- **May touch:** `server/src/db/schema.sql`, `server/src/routes/tracker-*.ts`, `server/src/realtime.ts` event types, Kysely types, `client/src/pages/Tracker*.tsx`, `client/src/components/tracker/*`, `client/src/lib/trackerUtils.ts`, `client/src/api.ts`, `client/src/types.ts`, `client/src/App.tsx` routing
- **May touch, narrowly:** `server/src/routes/workspaces.ts`, `server/src/auth.ts`, `server/src/routes/oauth.ts` — **only** to seed tracker vocabulary inside the existing workspace-creation transaction. This is a deliberate widening of the Phase 2 boundary, taken because the status lock closes the last runtime fix for workspaces that are born without vocabulary. No other behaviour in those files may change
- **Must NOT touch:** Board rendering, card/column mutation paths, existing card queries, `card_events`, `recordActivity()`, `server/src/routes/activity.ts`
- **Patterns required:** `recordTrackerActivity()` on every mutation; `version` + HTTP 409 on stale writes; `deleted_at` filtering; NodeNext `.js` import extensions on server; `requireWorkspaceMember` on all routes; `server/src/core/position.ts` for fractional ordering; `pastelColor.ts` / `columnColorUtils.ts` for colour
- **Migration:** additive and idempotent. `schema.sql` re-runs whole on every migrate, so every backfill carries a `WHERE … IS NULL` guard
- **Architecture validation result:** PASS (checklist below)

### Phase 6 validation

| Check | Result |
|---|---|
| Respects layer boundaries from Phase 2 | ⚠️ **Deliberately widened.** Board remains untouched, but `workspaces.ts`, `auth.ts` and `oauth.ts` are now in bounds for vocabulary seeding only. Reason recorded in Context: the status lock closes the last runtime fix for vocabulary-less workspaces, so provisioning cannot stay out of scope |
| Follows patterns found in the context scan | ✅ `version`+409, `deleted_at`, `recordTrackerActivity`, `position.ts`, cap precedent |
| No new dependencies | ✅ none |
| Build-vs-buy considered | ✅ fractional ordering reuses `position.ts`; date handling uses installed `date-fns`; drag uses installed `dnd-kit`; nothing commodity is hand-rolled |
| Rollback strategy defined | ✅ see Rollback Plan |
| No silent data migration or contract break | ✅ all new columns nullable; backfills guarded; `serializeItem` only gains fields |
| Performance acceptable for this layer | ⚠️ accepted: client-side rollup is bounded by the "dozens per workspace" scale the `tracker-entity` spec sets. Beyond that, adding server aggregates is additive |
| No security regression | ✅ new FKs validated against the workspace, mirroring `parseLabelIds` |

---

## Dependencies

### Existing (to leverage)

- **`server/src/core/position.ts`** — fractional ordering for phases and tasks, including `rebalance` on `RangeError`
- **`date-fns`** (client) — date formatting and comparison for schedule display and overdue
- **`@dnd-kit/*`** (client) — drag reorder, already used by Board
- **Kysely + PostgreSQL** — CRUD, aggregate-free reads, transactional deletes
- **Redis Pub/Sub → SSE** (`server/src/realtime.ts`) — new event types on the existing per-workspace channel
- **`culori`** via `pastelColor.ts` / `columnColorUtils.ts` — OKLCH colour if project/phase colour is ever added

### New

none

---

## Stories + Scenarios

The complete Given-When-Then set (13 stories, ~75 scenarios) is the authority for implementation. The acceptance criteria below compress it into the definition of done. Full scenario text is preserved in this spec's Acceptance Criteria plus the rules stated per story here.

### Story: Status carries machine-readable semantics

> As the system, I need each status to declare what it means, so progress and overdue never depend on guessing a name.

**Rule: `category` backfills deterministically and idempotently**
- Backlog → `backlog`, Todo → `backlog`, In Progress → `started`, Done → `completed`, Canceled → `canceled`
- A status created before the lock (e.g. "Blocked") is grandfathered with `category='backlog'`; its items keep working and keep counting in the denominator
- Re-running the migration changes nothing

**Rule: the status vocabulary is closed; priority and label are not**
- `POST /tracker/vocabularies` `kind='status'` → 400; `kind='label'` → 201
- Reverses the `tracker-entity` v1 rule "all members can add vocabulary" for `kind='status'` only. Deliberate: no UI ever called `api.createTrackerVocabulary` (`client/src/api.ts:514` has no component caller), so no user-visible capability is removed

**Rule: every workspace is born with vocabulary**
- All three creation paths seed the five statuses (with categories), three priorities and three labels inside the same transaction that inserts the workspace
- Seeding failure fails the whole creation — a workspace must never exist without vocabulary, since the lock leaves no way to add it afterwards
- The migrate-time retroactive seed block stays for workspaces created before this ships; the two must not double-insert

**Rule: glyphs read the column, never the name**
- A status named "Batal" with `category='canceled'` renders the cancelled glyph; `CANCELLED = /cancel/i` is deleted
- `category` picks the shape (`pending` / `progress` / `done` / `cancelled`); `position` rank continues to supply the *fraction* inside `started`

### Story: Project lifecycle

> As a workspace member, I want projects as sub-workspace containers, so long-horizon work has a home.

**Rule: create, rename, delete**
- Blank name → 400; 11th project → **409** naming the cap; stale rename → 409
- Delete releases tasks: `project_id` and `phase_id` NULL, phases soft-deleted, keys and detail URLs still resolve
- The confirmation names the count: "18 tasks will be released to the unassigned list"

### Story: Phase lifecycle

> As a workspace member, I want named phases inside a project, so a work breakdown has structure.

**Rule: a phase belongs to exactly one project**
- Names may repeat across projects; phases order by fractional `position`
- Rename and delete are both allowed — the reason Phase is its own table rather than `tracker_vocabularies.kind='phase'`, whose v1 rules forbid both
- Delete moves tasks to `phase_id = NULL`, keeping `project_id`

### Story: Assigning tasks to project and phase

> As a workspace member, I want to move tasks into a plan, so the breakdown reflects reality.

**Rule: both FKs are optional; inconsistent pairs are unrepresentable**
- `{phaseId: X}` alone derives `project_id` from X
- `{projectId: P2}` alone nulls `phase_id`
- `{projectId: null, phaseId: X}` → 400
- A phase from another project, a soft-deleted phase, or a nonexistent id → 400

### Story: Task scheduling

> As a workspace member, I want dates on tasks, so the plan has a shape a Roadmap can draw.

**Rule: dates are optional; end must not precede start**
- Inverted range → 400; start-only is legal and never overdue

**Rule: `completed_at` provenance**
- Set on entering a `completed` status via `COALESCE(completed_at, now())`, cleared on leaving, never set by `canceled` — mirrors `cards.ts:789-790`

### Story: Rollup progress

> As a workspace member, I want progress per phase and project, so I can see where the plan stands.

**Rule: the denominator excludes canceled**
- 5 completed / 2 canceled / 3 started → 63%, "5 of 8"
- All canceled → "no active work" (not 0%, not 100%)
- Zero tasks → "no tasks yet"
- A project's rollup includes its phase-less tasks

### Story: Overdue signalling

> As a workspace member, I want late work marked, so progress never lies.

**Rule: overdue needs an end date and unfinished work**
- Task: `end_date < today` AND category ∉ {`completed`, `canceled`}; due today is not overdue; no end date is never overdue
- Phase: overdue from any overdue descendant, OR from its own explicit `end_date` **unless every one of its tasks is completed or canceled**. An empty phase past its explicit end IS overdue — nothing was delivered
- Project: inherits from any overdue phase, including a phase overdue only by its own date
- The "task falls outside the phase range" flag is live **only against explicitly-set phase fields** — a derived bound cannot be violated by definition

### Story: Ordering

> As a workspace member, I want to arrange tasks in the order the work happens.

**Rule: fractional position scoped per `(project_id, phase_id)` bucket**
- New tasks land at the end of their bucket; changing bucket assigns a fresh end-of-bucket position; bulk releases append in old-position order
- `RangeError` from `positionBetween` triggers `rebalance`, not a 500
- `/tracker` home keeps `created_at ASC` inside status groups

**Rule: version bumps on assignment, not on reorder**
- A **reorder-only** write (the reorder endpoint, and the sibling rewrite inside a rebalance) does **not** bump `version` — mirrors the rebalance loop at `cards.ts:770-777`
- An **assignment** write (`project_id`/`phase_id` changing, whether or not `position` changes with it) **does** bump `version` — mirrors the moved card at `cards.ts:783-791`, which sets `version + 1` alongside `position`
- Without this split, two members reassigning the same task cannot detect the conflict and Tracker's optimistic-locking contract silently becomes "version tracks some fields"
- The one exception is a **release** caused by deleting a project or phase: it bumps neither `version` nor `updated_at`, so 18 open editors are not 409'd by someone else's delete

### Story: Tracker home and project page

> As a workspace member, I want projects visible without losing the list I already use.

**Rule: existing behaviour is preserved for unassigned items**
- A workspace with no projects renders exactly as today plus a "New project" affordance
- Search reaches into projects; results appear in an "In projects" section with the `Project › Phase` trail
- The "No items match" state fires only when project-name, in-project and unassigned matches are all empty; the toolbar count includes in-project matches
- Unknown project id, or a project from another workspace → 404 state
- Phase collapse persists per project in `sessionStorage` and survives an SSE-triggered reload; `/tracker` keeps the v1 reset-on-navigation rule

### Story: Realtime

> As a workspace member, I want teammates' plan changes to appear without refreshing.

**Rule: project/phase events reach both surfaces**
- Home and the project page both reload on project/phase events, so released tasks appear and deleted cards vanish
- A viewer on a deleted project's page gets the 404 state, not a stale page
- One `tracker_events` row and one SSE event per delete, not one per released task

### Story: Migration safety

> As an operator, I want a migration that survives being run again.

**Rule: additive and guarded**
- No `tracker_items` row changes `project_id` or `phase_id`
- `position` backfills `WHERE position IS NULL` — unguarded, a re-deploy would wipe every manual drag order
- `completed_at` backfills to NULL, not an approximation
- No live row keeps a NULL `position` after backfill; the reorder read coalesces defensively because `Number(null)` is `0` in JS while Postgres sorts NULLs last

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — Tracker Project / Phase / WBS
Date: 2026-08-05 | Scope confirmed: yes

Rule: Status semantics
  ✓ Given the 5 seeded statuses, When the migration runs, Then Backlog/Todo=backlog,
    In Progress=started, Done=completed, Canceled=canceled
  ✓ Given a pre-lock custom status "Blocked", When the migration runs, Then it gets
    category=backlog, survives, and still counts in the rollup denominator
  ✓ Given the migration already ran, When make db-migrate runs again, Then no category
    value changes and no row is duplicated
  ✓ Given a status named "Batal" with category=canceled, When a row renders, Then the
    cancelled glyph shows and no name regex participates
  ✓ Given GET /tracker/vocabularies?kind=status, When it responds, Then every row
    includes category
  ✗ Given a POST to /tracker/vocabularies with kind=status, When attempted, Then 400
    and no row is inserted
  ✓ Given a POST with kind=label, When attempted, Then 201
  ✓ Given a member creates a workspace, When the transaction commits, Then that workspace
    already holds the 5 statuses with categories, 3 priorities and 3 labels
  ✓ Given a user signs up by password or by OAuth, When the personal workspace is created,
    Then it holds the same seeded vocabulary
  ✓ Given vocabulary seeding fails, When workspace creation runs, Then the whole
    transaction rolls back and no workspace exists without vocabulary
  ✓ Given a workspace created after this ships, When a member creates their first tracker
    item, Then getBacklogStatusId resolves and no "Backlog status not found" error occurs
  ✓ Given both the creation-time seed and the migrate-time retroactive block have run,
    When a workspace is inspected, Then no vocabulary row is duplicated
  ✓ Given the client needs category for glyphs and rollup, When any item payload is
    serialized, Then its embedded status carries category — all four sites agree
    (tracker-vocabularies.ts RETURNING_COLUMNS and serializeVocabulary,
    tracker-items.ts serializeVocab and selectItemRows)

Rule: Project lifecycle
  ✓ Given workspace W has 2 projects, When a member creates "Rilis v2", Then 201 and it
    appears on Tracker home with 0 tasks and no percentage
  ✓ Given project P, When renamed with the current version, Then 200
  ✗ Given a blank project name, When create is attempted, Then 400
  ✗ Given 10 non-deleted projects, When an 11th is attempted, Then 409 naming the cap,
    and the client control is disabled with the reason visible
  ✗ Given a stale version, When rename is attempted, Then 409 with card-mirror UX
  ✓ Given 9 projects and two simultaneous creates, When both submit, Then exactly one
    succeeds and the other gets the 409 cap error
  ✓ Given project P with 4 phases and 18 tasks, When deleted, Then P and its phases are
    soft-deleted, all 18 tasks have project_id and phase_id NULL, they appear in the
    unassigned sections, and their FA-N keys still resolve
  ✓ Given project P holds 18 tasks, When Delete is clicked, Then the confirmation states
    that 18 tasks will be released
  ✓ Given a soft-deleted project named "Rilis v2", When a new project takes that name,
    Then it succeeds (uniqueness is partial on deleted_at IS NULL)

Rule: Phase lifecycle
  ✓ Given project P with two phases, When a third is added, Then it is positioned last
  ✓ Given phase "Persiapan" with 5 tasks, When renamed then deleted, Then rename succeeds
    and its tasks get phase_id NULL, keep project_id P, and appear under "No phase"
  ✓ Given no phase-less task exists, When the project page renders, Then no "No phase"
    section appears
  ✓ Given project P with zero phases and zero tasks, When opened, Then a CTA empty state
    invites creating the first phase

Rule: Project / phase assignment
  ✓ Given unassigned FA-12, When assigned to project P phase "Persiapan", Then it leaves
    the unassigned list, appears under that phase, gets an end-of-bucket position, and has
    its version bumped (assignment is a content write; only reorder-only writes leave
    version alone — see Rule: Ordering)
  ✓ Given FA-25 in project P phase X, When PATCHed with projectId P2 and no phaseId,
    Then project_id becomes P2 and phase_id becomes NULL
  ✓ Given a PATCH with phaseId X and no projectId, When applied, Then project_id is
    derived from X
  ✗ Given phase X belongs to project A, When a task is PATCHed to project B with phase X,
    Then 400
  ✗ Given a soft-deleted, cross-workspace, or nonexistent projectId/phaseId, When PATCHed,
    Then 400 and no field is written
  ✗ Given a PATCH with projectId null together with phaseId X, When applied, Then 400
  ✓ Given a task in project P, When its project is cleared, Then both project_id and
    phase_id become NULL

Rule: Scheduling
  ✓ Given task FA-25 with no dates, When start 21 Sep and end 30 Sep are set, Then both
    save and the row shows the range
  ✓ Given start only, When saved, Then the range renders open-ended and the task is never
    overdue
  ✗ Given start 30 Sep and end 21 Sep, When saved, Then 400
  ✓ Given completed_at NULL, When status changes to Done, Then completed_at is set to now()
  ✓ Given completed_at already set, When the item moves between completed statuses, Then
    completed_at is unchanged
  ✓ Given a Done item, When status changes to In Progress, Then completed_at becomes NULL
  ✓ Given an In Progress item, When status changes to Canceled, Then completed_at stays NULL
  ✗ Given a PATCH body carrying completedAt or position, When applied, Then both are ignored

Rule: Rollup
  ✓ Given 5 Done, 2 Canceled, 3 In Progress, When the phase header renders, Then 63% and
    "5 of 8"
  ✓ Given all tasks canceled, When rendered, Then "no active work" and no percentage
  ✓ Given zero tasks, When rendered, Then "no tasks yet" and no percentage
  ✓ Given project P with 2 phases and 4 phase-less tasks, When its card renders, Then the
    percentage counts every task with project_id = P

Rule: Overdue
  ✓ Given end 20 Sep, status In Progress, today 5 Okt, When rendered, Then the overdue
    marker appears
  ✓ Given end 20 Sep and status Done, When rendered, Then no marker
  ✓ Given end equal to today, When rendered, Then no marker
  ✓ Given a phase whose bar reads 83% (5 of 6) and whose one remaining live task is past its
    end date, When rendered, Then the phase carries the overdue marker beside the bar — a
    nearly-full bar must never be the only signal
    (a phase cannot be at 100% AND hold a live task: a live task counts in the denominator,
    so 100% means nothing is outstanding)
  ✓ Given a phase with explicit end 20 Sep and all six tasks Done, today 5 Okt, When
    rendered, Then no marker
  ✓ Given a phase with explicit end 20 Sep and zero tasks, today 5 Okt, When rendered,
    Then the marker appears
  ✓ Given a project whose only overdue descendant is a date-only overdue phase, When its
    card renders, Then the card carries the marker
  ✓ Given a phase with no explicit dates, When bounds are derived, Then no task is ever
    flagged as outside the range
  ✓ Given a phase with explicit start 1 Sep and no explicit end whose latest task ends
    25 Sep, When rendered, Then the range reads 1 Sep – 25 Sep
  ✗ Given phase start 30 Sep and end 21 Sep, When saved, Then 400

Rule: Ordering
  ✓ Given a phase with 3 ordered tasks, When a task is added, Then it is positioned last
  ✓ Given phase tasks ordered C, A, B, When the phase is deleted, Then they appear after
    the existing "No phase" tasks in the order C, A, B
  ✓ Given tasks A, B, C, When C is dragged between A and B, Then C takes the midpoint
  ✓ Given a rebalance is triggered, When sibling positions are rewritten, Then sibling
    version values are unchanged
  ✓ Given a reorder-only request, When applied, Then version is unchanged
  ✓ Given a PATCH that changes project_id or phase_id, When applied, Then version is
    bumped so a concurrent reassignment 409s
  ✓ Given a task released by a project or phase delete, When applied, Then neither version
    nor updated_at changes
  ✓ Given the drag UI is cut from the plan, When the cycle ships, Then the reorder
    endpoint still exists and is still tested
  ✓ Given the migration has run, When any item is read for ordering, Then its position is
    non-NULL
  ✓ Given tasks were manually reordered, When make db-migrate runs again, Then no position
    value changes

Rule: Home and project page
  ✓ Given a workspace with 31 items and no projects, When /tracker opens, Then the items
    render grouped by status exactly as before, with only a "New project" affordance added
  ✓ Given GET /tracker/items, When it responds, Then each item carries projectId and
    phaseId and no embedded project or phase name
  ✓ Given the only match for "realtime" is FA-26 inside a project, When searched on
    /tracker, Then FA-26 appears under "In projects" with its trail, the empty state does
    not appear, and the toolbar count includes it
  ✓ Given no project name and no item matches, When searched, Then the "No items match"
    state appears
  ✓ Given project P, When its card is clicked, Then /tracker/p/P renders phases with
    rollups, date ranges, and a "No phase" section when needed
  ✗ Given a nonexistent project id or a project from another workspace, When opened, Then
    a 404 state renders
  ✓ Given "Persiapan" was collapsed, When the member returns to /tracker/p/P, Then it is
    still collapsed
  ✓ Given a collapsed phase, When an SSE event triggers the full loadData reload, Then the
    collapse survives

Rule: Realtime
  ✓ Given members A and B on /tracker, When A creates a project, Then B sees the card
    without refreshing
  ✓ Given members A and B on /tracker, When A deletes a project holding 18 tasks, Then B's
    card disappears and the 18 released tasks appear in B's unassigned sections
  ✓ Given B on /tracker/p/P, When A deletes phase "Persiapan", Then B's view moves those
    tasks to "No phase" without refreshing
  ✓ Given B on /tracker/p/P, When A deletes project P, Then B is shown the 404 state
  ✓ Given B on /tracker/p/P, When A marks a task Done, Then B's phase and project
    percentages update without refreshing
  ✓ Given project P with 18 tasks, When deleted, Then exactly one tracker_events row and
    exactly one SSE event are produced

Rule: Migration safety
  ✓ Given a production database, When the migration runs, Then no tracker_items row
    changes project_id or phase_id and Board tables are untouched
  ✓ Given an item already in status Done, When the migration runs, Then completed_at
    stays NULL and populates on the next transition into a completed status
  ✓ Given a brand-new empty database, When the migration runs once, Then the seeded
    statuses exist AND every one carries a category — the category backfill is appended
    after the retroactive seed block at schema.sql:461, never before it
  ✓ Given a project is deleted, When its single tracker_events row is written, Then the
    payload records the released (itemId, projectId, phaseId) triples so the breakdown
    is reconstructible

OPEN QUESTIONS (risks if unresolved):
  - Unassigned section density on home → assumed: stays expanded as today. Risk: with
    many projects the list is pushed far down; a collapse affordance is a later addition.
  - Project card date range → assumed: derived MIN/MAX across its tasks, no explicit
    project dates. Risk: a project cannot be scheduled top-down the way a phase can.

OUT-OF-SCOPE (remind pocket-planning):
  - Comments and attachments on tracker items
  - Roadmap / Gantt rendering
  - Any Board change, card_events, recordActivity, activity.ts
  - Tracker ↔ card linkage
  - Per-project status vocabularies
  - Re-keying items under a project prefix
  - Changelog UI for project/phase events
  - Fixing the unvalidated statusId path at tracker-items.ts:551-563
```

---

## Design Decision

**Chosen option:** Option B — client-derived rollup over the existing full item list

**Summary:** `GET /tracker/items` keeps returning every non-deleted workspace item and gains only raw `projectId`/`phaseId`; `GET /tracker/projects` returns projects with their phases nested. The client joins by id and derives rollup, date ranges, and overdue in `useMemo`, exactly as it already derives status grouping and glyphs.

**Rejected options:**
- **Option A (server-computed aggregate fields)** — rejected because it does not deliver the payload saving that motivates it: the "search reaches into projects" acceptance criterion requires in-project items on the home payload regardless. It also makes "Live rollup" expensive: today the page refetches on SSE (`TrackerPage.tsx:100-106`) and derived numbers follow for free, whereas aggregates need a separate invalidation path.
- **Option C (hybrid: server for home cards, client for the project page)** — rejected because it creates two rollup implementations that must agree forever. When they drift, the card says 63% and the page says 61% with no way to tell which is right, and it still does not avoid the full payload.

**Key tradeoffs accepted:**
- Client-side derivation is bounded by the "dozens per workspace, not hundreds" scale the `tracker-entity` spec sets (`tracker-entity.md:27`). Two honest caveats: that bound was written for a **flat backlog, before projects existed**, and projects are precisely the feature that makes a workspace accumulate hundreds of items — this cycle cites a scale limit it is designed to strain. The mitigation is genuinely additive, but it must be a **project-scoped aggregate endpoint feeding the same derivation helpers**, not a second rollup implementation; otherwise the Roadmap cycle re-derives rollup independently and lands in exactly the Option C failure this spec rejects.
- **Navigation overrides the pitch's Recommended Direction.** `pitch-exploration.md:156` recommends Direction A (implicit default project, `/tracker` unchanged). This spec ships a B/C hybrid because the user rejected a default project outright — Direction A's entire benefit depends on one existing. With `project_id` nullable and no default, two populations of items exist permanently, and Tracker home is the only layout that gives both a home without an extra click.
- **Home hosts two concepts.** Project cards sit above the item list, so a workspace with many projects pushes the familiar list down. This is the one place the cycle knowingly degrades a working surface to host a new concept — the shape that killed the List/Calendar cycle. Accepted deliberately rather than assumed: the projects area is collapsible, and the unassigned list is never moved to another route.
- The project page loads the full workspace item list rather than a project-scoped one. Accepted for one derivation path and one cache.
- Closing the status vocabulary reverses a `tracker-entity` v1 rule. Accepted because no UI ever exposed it; the cost is that a workspace needing "Blocked" or "In Review" cannot have one.
- Project/phase activity is recorded but unreadable this cycle. Note that `trackerEventSelect()` (`tracker-items.ts:815-819`) left-joins `tracker_items`; rows with `tracker_item_id = NULL` must not leak into an existing feed with a null title.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|---|---|---|
| Unassigned section density on home | **decided**: the projects area is collapsible; the unassigned list stays on `/tracker` and is never relocated | If projects still crowd the list, the next step is collapsing by default — not moving the list |
| Does a project card show a date range? | **decided**: rendered from derived MIN/MAX of its tasks this cycle; `start_date`/`end_date` columns ship unused so Roadmap needs no migration | A project cannot yet be scheduled top-down the way a phase can — deliberate, the columns are already there |
| Glyph fraction for a grandfathered `backlog` status | resolved: `category` picks the shape, `position` rank still supplies the fraction inside `started` | Custom statuses render with a flat glyph |
| Are there non-seeded statuses in production? | assumed: none, since no UI ever called `createTrackerVocabulary` | A few rows silently count as `backlog` in rollups |
| Can the grandfather branch be tested after the lock ships? | assumed: no — nothing can create a 6th status in a fresh DB, so that test needs a direct SQL insert | The branch ships untested if planning writes the test through the API |

---

## Implementation Notes

- **Order of work is load-bearing, but scope the split correctly.** Nearly all new server logic — `projectId`/`phaseId` parse and cross-validation, date validation, the `completed_at` CASE, bucket reassignment — lands inside one 213-line `PATCH` handler (`tracker-items.ts:513-726`). A *mechanical* whole-file reorganization moves helpers around that handler and reduces the review burden of the new code by zero lines. Extract the parse/validate helpers the new code needs, mirroring `parseLabelIds` (`:228-239`), and leave the rest alone.
- **The integration test is not an automatic safety net.** `tracker-items.integration.test.ts:2` reads `Gated: RUN_INTEGRATION=1` and needs a live Postgres, so it does not run under `npm run test`. Make `RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts` an explicit acceptance step for the extraction task.
- **The `position` backfill guard is not optional.** `schema.sql` re-runs in full on every `make db-migrate` (`migrate.ts:9-18`). An unguarded `created_at`-ordered backfill wipes every manual drag order on each deploy. Add a test asserting the guard, following the string/regex convention in `server/src/db/tracker-migration.test.ts`.
- **Migrate ordering is load-bearing.** `schema.sql` currently ends at line 461, and that last block is the retroactive vocabulary seed. The `category` backfill must be appended **after** it. Placed earlier — next to the tracker DDL — it runs before those five rows exist on a fresh database, leaving every `category` NULL and rollup silently dead.
- **`category` has four serialization sites, not one.** `tracker-vocabularies.ts:12-19` `RETURNING_COLUMNS` and `:25-41` `serializeVocabulary` (a separate hardcoded literal — adding to the first alone does not put it on the wire), plus `tracker-items.ts:54-65` `serializeVocab` (a second vocabulary serializer used for every item's embedded `status`) and `:110-135` `selectItemRows`. Item payloads **do** carry `status.category`; the client needs it for glyphs and rollup.
- **New SSE handlers must reload, not merge.** Call `loadData()` the way `TrackerPage.tsx:100-106` does. The nearest precedent in the codebase is broken: `tracker-vocabularies.ts:141-144` publishes with no payload while `TrackerPage.tsx:71-85` reads `event.payload.kind`, so that handler never fires. Do not copy it.
- **`TrackerPage.tsx:126`** short-circuits the whole render into the empty state when `filteredItems` is empty. In-project matches and project-name matches must feed that condition, or the "In projects" section can never render.
- **`TrackerPage.tsx:68-107`** ignores unknown SSE types while `BoardContext.tsx` forwards every `tracker.*` event. New project/phase types must be handled explicitly on home as well as on the project page.
- **`/tracker/p/:id` must be registered before or distinctly from `tracker/:key`** (`client/src/App.tsx:67-73`), whose server-side `parseKeyFromUrl` would 400 on "p".
- **Do not copy the `statusId` validation path.** Follow `parseLabelIds` (`tracker-items.ts:228-239`): verify the referenced row belongs to this workspace and is not soft-deleted.
- **Design tokens** (`docs/pocket/rule/creative-brief.md` is the authority): progress bar fill uses primary-600 `oklch(55.0% 0.076 250)` on a neutral-200 `oklch(92.0% 0.005 250)` track — the calm register, not a success-green celebration; the overdue marker uses the Error role (`oklch(55% 0.100 25)` solid, `oklch(35% 0.085 25)` text on `oklch(95% 0.025 25)`); phase subtitles use `sm` 13px neutral-600; base radius 6px; Work Sans throughout. Copy follows the neutral-friendly register: "18 tasks will be released to the unassigned list", "Nothing here yet — add your first phase."
- **`todayISODate` / `isDueOverdue`** live in `client/src/lib/boardViewUtils.ts:23,48` and use client-local date, which is the correct precedent for "today". Import read-only or copy the three lines into `trackerUtils.ts`; do not edit that module.
- **Nothing may touch `workspaces.tracker_key_counter`** (`schema.sql:361`). The guarantee that released tasks keep resolving depends on it.

---

## Rollback Plan

- The migration is additive: two new tables, new nullable columns on `tracker_items` and `tracker_projects`, one nullable vocabulary column, and guarded backfills. Nothing existing is rewritten.
- Rollback = revert the deploy. The new columns stay in place holding NULLs; the previous client and server ignore them entirely, and `/tracker` returns to its status-grouped list.
- **One operation is not covered by that rollback: deleting a project.** The project and its phases soft-delete, but `project_id`/`phase_id` on the released items are hard-nulled. Reverting the deploy does not restore an 18-task, 4-phase breakdown, and nothing else does either. This is why the single delete event's payload must carry the released `(itemId, projectId, phaseId)` triples — that payload is the only reconstruction path, and writing it costs nothing extra since the event row is already mandated.
- Dropping `tracker_projects` / `tracker_phases` and the new columns is a maintenance-window operation, only needed to reclaim schema surface — not to restore function.
- Closing the status vocabulary is a route-level check with no data effect; reverting the deploy reopens `POST kind='status'` immediately.
- Board data is untouched under every rollback path.
