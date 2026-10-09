# Board / Tracker schema unify — additive shared vocab

**Date:** 2026-08-30
**Status:** draft
**Author:** brainstorm session
**Spec path:** docs/pocket/spec/2026-08-29-board-tracker-schema-unify/additive-shared-vocab.md
**Pitch:** docs/pocket/spec/2026-08-29-board-tracker-schema-unify/pitch-exploration.md

---

## Summary

Board cards and tracker items stay on two tables this cycle, but share one status/priority/label vocabulary and the same identity fields (key, project, phase). Board columns remain a named overlay (WIP, policy, signable). Each card’s `status_id` is derived from column position plus `is_done`, bound to five slotted default statuses — not from custom status names — so tracker glyphs stay meaningful and Roadmap can later treat one work-item kind.

---

## Context

### Current State

`cards` and `tracker_items` share title/description/position/version/soft-delete/assignees but diverge on status (`column_id` vs `status_id`), priority, labels, `key_number`, `updated_at`, and `project_id`/`phase_id`. `tracker_vocabularies` is already seeded for every workspace (`status|priority|label`). Status POST is rejected (`The status vocabulary is fixed.`). Glyphs in `TrackerGlyphs` derive from `category` (`backlog|started|completed|canceled`); Backlog and Todo both use `category = backlog`. Columns hold `wip_limit`, `policy`, `is_done` (at most one), `is_signable`. New columns append at `MAX(position)+gap`. Column PATCH has no `position`. Client has no `deleteColumn`. Tracker keys increment `workspaces.tracker_key_counter` atomically. Agent `insertCard` (`server/src/agent/routes.ts`) inserts into `cards` with only column/title/position/workspace. Card move stamps `started_at`/`done_at` in `cards.ts`.

### Problem / Motivation

Tracker was built as a new table instead of extending `cards`. New fields keep landing tracker-only. Status on the board is a column instance with workflow behavior, not a taxonomy row. Unifying names without a slot marker would recreate the custom-status icon failure. Full table merge is blocked until Roadmap/WIP ownership is settled; this cycle closes the taxonomy and identity gap additively.

### Related Areas

- `server/src/db/schema.sql`, `server/src/db/types.ts`, `server/src/core/tracker-vocabulary-seed.ts`, `server/src/core/tracker-key.ts`, `server/src/core/wip.ts`
- `server/src/routes/cards.ts`, `columns.ts`, `board.ts`, `tracker-items.ts`, `tracker-vocabularies.ts`, `helpers.ts`
- `server/src/agent/routes.ts` (`insertCard` only)
- Client board (`BoardPage`, `ContextPanel`, card face), tracker pickers (`TrackerGlyphs`, vocab types)

---

## Scope

### In-Scope

- Shared status/priority/label vocabulary; five default statuses get a stable `slot` marker
- Board columns remain overlays; mapping Rule 1.3; WIP/policy/signable stay on columns
- Additive `cards` fields: `status_id`, `key_number`, `priority_id`, `project_id`, `phase_id`; `card_labels` junction
- Live-card key allocation at migrate via `tracker_key_counter`; key shown on the board card face
- Board card panel pickers for priority, labels, project, phase (same workspace lists as tracker)
- Idempotent `schema.sql` backfill (null-only); `is_done` remap with version/activity/SSE and move-like timestamps
- Agent-created live cards receive key + status without changing `agent-schema.sql` or pipeline logic

### Out-of-Scope

- Roadmap UI (fields exist so Roadmap can consume them later)
- Merging `cards` and `tracker_items` into `work_items` / `view_type` enum
- Unifying `card_events` and `tracker_events`
- Column reorder/delete UI (does not exist today; server `DELETE /columns` CASCADE unchanged)
- Status vocabulary CRUD (create/delete/rename status)
- Status picker on the board panel; applying `statusId` on card POST/PATCH
- Tracker search/detail resolving board keys (`CA-41` as a card)
- Agent pipeline, `agent-schema.sql`, chat, Lottie, auth/session contracts

---

## Architecture Constraints

- Layers this work may touch: `schema.sql`, Kysely types, seed, `core/` (wip, tracker-key, vocabulary-seed, **new shared card-insert allocation**), cards/columns/tracker routes, client board + tracker types/pickers, **`server/src/agent/routes.ts` `insertCard` only** (call the shared helper)
- Layers this work must NOT touch: `agent-schema.sql`, chat-schema, `camel-lottie/`, auth/session contracts, tracker item list/detail routes as a board-card resolver
- Patterns: idempotent `schema.sql`; optimistic locking `version` + HTTP 409; fractional positions; `recordActivity()` on card mutations; NodeNext ESM `.js` on server
- Architecture validation result: **CONDITIONAL PASS** (see Phase 6)

### ARCHITECTURE VALIDATION RESULT

Status: CONDITIONAL PASS

Checks run: Phase 2 layer boundaries; Phase 1 patterns; modular-monolith data ownership; concurrency (counter + is_done remap); public contract (additive card JSON); anti-patterns (leaky abstraction, silent breaking change, non-idempotent migrate, race on counter)

Anti-patterns reviewed: layering, coupling, contract violations, concurrency hazards

Findings:

- ✓ Layer boundaries — additive columns and a `core/` allocator; board still owns `column_id`; tracker still owns `tracker_items`
- ✓ Existing patterns — `ADD COLUMN IF NOT EXISTS`, null-only UPDATE, workspace-row counter already in `tracker-items.ts`
- ✓ No new npm dependencies
- ✓ Build-vs-buy — domain mapping, not a commodity library problem
- ✓ Rollback — additive nullable columns; revert app without DROP; unused FKs remain
- ⚠ Agent insert — two `insertInto("cards")` paths; a `core/` helper unused by agent would leave agent cards without keys. Mitigation: helper **must** be called from `cards.ts` create **and** `insertCard`. No `agent-schema.sql` / `runPipeline` edits
- ✓ Counter uniqueness — `UPDATE tracker_key_counter + 1` serializes; no cross-table UNIQUE
- ✓ Card JSON additive — new fields on GET/PATCH; `statusId` write rejected 4xx
- ✓ `card_labels` new junction — do not reuse `tracker_item_labels` (FK to `tracker_items`)
- ✓ `slot` is not `category` — Todo `category=backlog`, `slot=todo`

Mitigations required before handoff:

- Shared allocate-on-cards-insert in `core/`, wired from human create and `insertCard`
- Idempotent backfill only where `key_number` / `status_id` is null
- Explicit 4xx if client sends `statusId` on card write

---

## Dependencies

### Existing (to leverage)

- Kysely — typed queries, transactions, `forUpdate` on workspace/column rows
- PostgreSQL 16 — `ADD COLUMN IF NOT EXISTS`, CHECK/UNIQUE, `UPDATE … WHERE IS NULL`
- Existing `workspaces.tracker_key_counter` and `derivePrefix` / `formatKey`
- Existing tracker vocab APIs and pickers (reuse on the board panel)
- Existing `checkWipLimit`, card `version` 409, `recordActivity`, SSE `publishEvent`

### New (proposed)

none

---

## Stories + Scenarios

### Story: Column overlay maps to a slotted status

> As a workspace member using the board, I want each card’s `status_id` to be one of five fixed tracker status slots, so board and tracker share a work-item kind and status icons stay bound to category, not custom names.

**Rule 1: Slot marker, not category, identifies the five rows**

- Example: `slot` enum `backlog | todo | in_progress | done | canceled` on the five default status rows only. Extra `kind=status` rows (if any) have `slot` null and are unused by columns.
- Example: Display name does not drive mapping. Column title is overlay only.

```gherkin
Scenario: Backfill maps In Review card to in_progress
  Given workspace "Camel App" with software-dev columns and slotted statuses
  And card "Login form" is in column "In Review" with deleted_at IS NULL
  When the schema unify migration runs
  Then card.status_id is the row with slot = in_progress
  And card.column_id is unchanged
  And the board still shows the card under "In Review"

Scenario: Two-column board maps Done by is_done not by second-column rule
  Given columns "Inbox" (not done) and "Finished" (is_done)
  When migration runs
  Then cards in Inbox have slot backlog
  And cards in Finished have slot done

Scenario: is_done leftmost still wins
  Given columns Done(is_done) | Inbox | Next
  When mapping runs
  Then Done → done, Inbox → backlog, Next → todo

Scenario: Extra unslotted status is ignored
  Given an extra kind=status row with slot NULL
  When mapping runs
  Then board slots bind only to the five slotted rows

Scenario: Rename column does not change status_id
  Given a card in "In Review" with slot in_progress
  When the user renames that column to "QA"
  Then status_id is unchanged
```

**Rule 2: Mapping formula (is_done wins)**

Ordered columns by `position`:

1. `is_done = true` → `done` (any position)
2. Leftmost non-done → `backlog`
3. Next non-done → `todo`
4. All remaining non-done → `in_progress`

Canceled has no board column this cycle.

```gherkin
Scenario: Four or more non-done columns share in_progress
  Given four non-done columns plus optional Done
  When mapping runs
  Then columns 3+ of the non-done set all bind to slot in_progress
  And no new vocab row is created
```

**Rule 3: Column geometry the product actually has**

UI cannot reorder columns. Client cannot delete columns. POST `/columns` appends right. Adding a column does not recompute existing cards’ `status_id`.

```gherkin
Scenario: Add column on the right does not remap existing cards
  Given software-dev columns and card CA-7 in In Review with in_progress
  When the user creates column "Blocked"
  Then the new column is rightmost
  And existing CA-7 remains in Review with in_progress

Scenario: Add on a two-column Inbox | Finished(is_done) board
  Given Inbox | Finished(is_done)
  When the user adds "Blocked"
  Then Blocked is rightmost and maps to todo (second non-done)
  And Inbox cards keep backlog

Scenario: First extra column on a single Inbox board
  Given one non-done column "Inbox"
  When the user adds "Doing"
  Then Doing maps to todo
  And existing Inbox cards keep backlog
```

**Rule 4: is_done move/clear remaps without moving cards**

At most one `is_done` column (existing server lock). Moving `is_done` does not change `column_id`. Newly marked column’s cards → `done`. Column that lost `is_done` remaps via Rule 2. Clearing the last `is_done` is allowed; remap Rule 2; non-blocking tip in column settings. Cards whose slot does not change keep `status_id` and `version`. Soft-deleted rows are not remapped on `is_done` change (restore is future). Each remapped live card bumps `version`, `recordActivity()`, and SSE. Concurrent PATCH with old version → 409.

`started_at` / `done_at`: migration does **not** touch them. User `is_done` move/clear stamps them with the same CASE rules as a card move.

```gherkin
Scenario: Moving is_done remaps status without moving cards
  Given software-dev columns, live card A in In Review, live card B in Done
  When the user sets is_done true on In Review
  Then A stays in In Review and status_id is done
  And B stays in the old Done column and status_id is in_progress
  And A and B versions bump, activity and SSE fire
  And done_at follows move rules (A set, B cleared)

Scenario: Clearing last is_done
  Given a board whose only is_done column is "Done"
  When the user sets isDone false on that column
  Then the board may have zero Done columns
  And cards in that column are remapped by Rule 2
  And column settings show a short non-blocking tip

Scenario: Unchanged slot skips version bump
  Given Inbox cards already on backlog
  When is_done is moved between other columns
  Then Inbox cards keep status_id and version
```

**Rule 5: Board writes status only via column placement**

No status picker on the board panel. POST/PATCH `/cards` with `statusId` → 4xx. Card move updates that card’s `status_id` from the destination column’s slot. WIP/signable/policy of the destination column apply as today. Hybrid reverse (Roadmap dual-edit) is documentation only this cycle: Backlog/Todo/Done two-way to the canonical column; In Progress stay-if-compatible else leftmost in_progress column; Canceled keeps `column_id`.

```gherkin
Scenario: Card move updates slot
  Given card CA-7 in To Do (todo)
  When the user moves CA-7 to In Review
  Then status_id is in_progress
  And WIP and signable of In Review apply as today

Scenario: Create card uses mapping, not only move
  Given software-dev columns
  When POST /cards succeeds into In Review
  Then the card gets the next tracker_key_counter value
  And status_id is in_progress
  And started_at/done_at follow today’s create/move stamping (not the is_done-remap path)

Scenario: statusId on card write is rejected
  Given a client sends statusId on POST or PATCH /cards
  Then the request fails with 4xx
  And column_id and status_id are unchanged
```

---

### Story: Key numbers on board cards

> As a workspace member, I want every live board card to have a unique key shown on the card face (same format as tracker), allocated at migration, so board and tracker share identity.

**Rule 6: Counter-only uniqueness, idempotent backfill, keep on soft-delete**

- All allocates (migrate, user create, tracker create, agent insert) use `UPDATE workspaces SET tracker_key_counter = tracker_key_counter + 1`.
- No cross-table UNIQUE. Duplicate `CA-12` on screen is not accepted.
- Re-run `schema.sql`: fill only null `key_number` / `status_id`; never rewrite filled rows; do not increment the counter twice for the same rows.
- Live cards at migrate get keys after existing tracker items.
- Soft-deleted at migrate: no `key_number`; **do** backfill `status_id`. After a live card has a key, soft-delete **keeps** it (no reuse). Restore of pre-migration deleted cards is a future contract (next counter then).
- Display: `formatKey(derivePrefix(workspace.name), key_number)` on the kanban card face and list-view rows; GET board/card payloads include the formatted key.

```gherkin
Scenario: Migration assigns keys after existing tracker items
  Given workspace counter=40 and 12 live cards
  When migration runs
  Then those 12 cards have key_numbers 41–52 unique vs tracker_items in that workspace
  And no tracker_item key_number changes
  And each live card face shows the formatted key

Scenario: Soft-deleted at migrate gets status but no key
  Given a card with deleted_at set
  When migration runs
  Then that card has status_id from Rule 2
  And key_number is null

Scenario: Soft-delete after key is assigned keeps the number
  Given live card CA-41
  When the user soft-deletes it
  Then key_number remains 41
  And the next new work item is CA-42 not CA-41

Scenario: schema.sql re-run is idempotent
  Given some live cards already keyed and some still null (interrupted migrate)
  When schema.sql is applied again
  Then remaining nulls are filled from the counter
  And already-filled keys and status_id are not rewritten

Scenario: Concurrent board create and tracker create
  Given counter=52
  When POST /cards and tracker item create run together
  Then both increment tracker_key_counter on the workspace row
  And they receive distinct numbers
```

**Rule 7: Agent live cards**

Agent `insertCard` creates a real `cards` row (clickable handle). That row must get `key_number` + `status_id` via the same `core/` allocator as human create. Do not edit `agent-schema.sql` or pipeline orchestration; only call the helper from `insertCard`.

```gherkin
Scenario: Agent-created live card is keyed
  Given insertCard writes a card into In Review
  When the insert completes
  Then the card has the next key and status_id in_progress
  And the board shows CA-n on that card
```

---

### Story: Shared priority, labels, project, phase on the board panel

> As a board user, I want to set priority, labels, project, and phase on a card from the board panel using the same workspace vocabularies and tracker projects/phases, so a later Roadmap can treat them as the same kind.

**Rule 8: Nullable, no backfill, same validation as tracker**

Old data stays null. Pickers this cycle (not schema-only). Clear to null / empty labels like tracker. Cross-workspace or wrong-kind vocab/project/phase → 4xx. Phase without project → 4xx (tracker rule). Version required on PATCH as today; 409 on stale. Mutations `recordActivity()` → `card_events` (not `tracker_events`).

```gherkin
Scenario: Board panel sets shared fields
  Given migrated card CA-7 with null priority/labels/project/phase
  When the user selects priority High, label Bug, project Mobile, phase Beta from the board panel
  Then those FKs persist on the card
  And recordActivity writes card_events
  And GET card includes those fields for the panel

Scenario: Clear priority and labels
  Given CA-7 with priority High and labels Bug+Feature
  When the user clears priority and all labels
  Then priority_id is null, card_labels is empty
  And version bumps and recordActivity is written

Scenario: Stale version rejected
  Given CA-7 version=3
  When PATCH includes version=2 and a new priority
  Then HTTP 409
  And priority_id is unchanged

Scenario: Cross-workspace project rejected
  Given project id 99 belongs to another workspace
  When the user assigns project 99 to CA-7
  Then 4xx
  And project_id stays null

Scenario: PATCH labels without version
  Given CA-7 version=3
  When PATCH sets labels without version
  Then the request fails the same way today’s card PATCH does
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — board-tracker-schema-unify (additive shared vocab)
Date: 2026-08-30 | Scope confirmed: yes

Rule: Slot mapping
  ✓ Given software-dev columns, When migration runs, Then In Review cards get slot in_progress and keep column_id
  ✓ Given Inbox | Finished(is_done), When migration runs, Then Inbox=backlog and Finished=done (is_done wins)
  ✓ Given is_done leftmost, When mapping runs, Then that column is done and the next non-done is backlog
  ✓ Given add column on the right, When created, Then existing cards keep status_id
  ✓ Given card moved to In Review, When move succeeds, Then status_id is in_progress and WIP applies
  ✓ Given POST card into In Review, When create succeeds, Then next key + in_progress
  ✗ Given POST/PATCH cards with statusId, When submitted, Then 4xx and no status change

Rule: is_done remap
  ✓ Given live cards in Review and Done, When is_done moves to Review, Then cards stay put, slots swap, version/activity/SSE on remapped live cards, done_at follows move rules
  ✓ Given last is_done cleared, When PATCH isDone false, Then remap Rule 2, board may have zero Done columns, tip shown
  ✓ Given cards whose slot did not change, When is_done moves, Then those cards keep status_id and version
  ✓ Given migration, When backfill writes status_id, Then started_at/done_at are unchanged

Rule: Keys
  ✓ Given counter=40 and 12 live cards, When migrate, Then keys 41–52, tracker keys unchanged, face shows PREFIX-n
  ✓ Given already-deleted card at migrate, When migrate, Then status_id filled, key_number null
  ✓ Given CA-41 then soft-delete, When deleted, Then key_number stays 41
  ✓ Given partial migrate, When schema.sql re-runs, Then only nulls filled
  ✓ Given concurrent card + tracker create, When both commit, Then distinct keys via counter
  ✓ Given agent insertCard, When insert completes, Then key + status from column without agent-schema changes
  ✗ Given two live work items in one workspace, When both would display CA-12, Then that state must not be producible via app writes

Rule: Board panel shared fields
  ✓ Given null fields after migrate, When user sets priority/labels/project/phase, Then they persist and card_events is written
  ✓ Given filled fields, When user clears priority and labels, Then null/empty, version bumps
  ✗ Given other-workspace project, When assigned, Then 4xx
  ✗ Given stale version, When PATCH priority, Then 409
```

---

## Design Decision

**Chosen option:** Option B — additive shared vocab, two tables

**Summary:** Keep `cards` and `tracker_items`. Add `tracker_vocabularies.slot` on the five default statuses. Add identity and taxonomy FKs on `cards`. Derive `status_id` from column overlay rules. Allocate keys through the existing workspace counter from a shared `core/` helper used by human create and agent `insertCard`.

**Rejected options:**

- Option A (full `work_items` merge): fails locked two-table GWT; rewrites board, tracker, agent, events
- Option C (strangler, tracker SoT): board is still `cards`+`column_id`; would force tracker routes to resolve board keys and collapse overlay WIP in one cycle

**Key tradeoffs accepted:**

- Structural duplication (two tables) remains until a later merge
- Hybrid reverse is specified but not implemented this cycle
- Thin `insertCard` call into `core/` (not a DB trigger) so agent cards are keyed without `agent-schema.sql` changes
- Uniqueness is the counter, not a cross-table UNIQUE constraint
- In Review vs In Progress: same slot, different column titles — overlay, not a bug

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Agent files | assumed: `insertCard` may call `core/` helper; no pipeline / agent-schema edits | If interpreted as zero bytes under `server/src/agent/`, need a DB trigger instead |
| Pre-migration deleted restore | assumed: future; allocate next counter then | Restore without a key if someone restores via SQL first |
| List view shows key | assumed: yes, same formatted key as kanban face | Inconsistent identity if list omitted |
| `cards.status_id` nullability after migrate | assumed: NOT NULL for all rows including soft-deleted (backfilled); `key_number` nullable | Create/agent insert must always set status_id |
| Tracker GET by key | assumed: still tracker_items only | User types CA-41 from a card into tracker search and gets 404 — acceptable this cycle |

---

## Implementation Notes

- Mapping function belongs in `core/` (pure: columns → slot), used by migrate SQL or a one-shot backfill in `schema.sql` plus live create/move/`is_done` PATCH.
- Seed `slot` on the five default names; keep `category` for glyphs. Do not treat `category` as the five-way slot.
- `card_labels (card_id, vocabulary_id)` mirroring `tracker_item_labels`.
- Indexes on `cards.workspace_id` where `deleted_at IS NULL` including `key_number` lookups if needed; do not add UNIQUE(workspace_id, key_number) on `cards` unless it cannot conflict with tracker (it would not enforce cross-table anyway).
- Board GET / card serialize: add `key`, `status` (id+slot+name+category+colour), `priority`, `labels`, `project`, `phase` as nullable payloads consistent with tracker serializers where practical.
- Column settings: copy-only tip when clearing the last `is_done`; no blocking modal.
- `recordActivity` + `publishEvent` on is_done remap must not write `tracker_events`.
- Client: reuse tracker glyph + picker chrome where it does not fight kanban (no status picker on the card panel).

---

## Rollback Plan

- Application rollback: stop writing/reading new fields; old clients ignore unknown JSON keys if additive.
- Database: leave new columns/tables in place (idempotent schema). Do not DROP `slot`, `card_labels`, or card FKs in a panic migrate.
- Keys already issued stay on rows (same as tracker). Reverting UI hides keys; numbers remain.
- If allocation helper is buggy: disable agent/human create until patched; do not reset `tracker_key_counter` downward (would collide).
