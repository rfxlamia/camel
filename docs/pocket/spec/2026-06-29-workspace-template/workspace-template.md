# Workspace Template (Column Seeding)

**Date:** 2026-06-29
**Status:** draft
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-29-workspace-template/workspace-template.md

---

## Summary

New workspaces land on an empty board, forcing users to build their column
structure from scratch every time. This feature lets a member apply a curated
column template (5 presets) from the empty-board state — seeding titles, colors,
WIP limits, descriptions, and the done-flag in one atomic operation — so they
start working within seconds. Templates are client-hardcoded; a new atomic batch
endpoint persists them. No schema migration.

---

## Context

### Current State
- `POST /columns` (`server/src/routes/columns.ts:26`) creates ONE column,
  accepts `title` only, auto-positions via `MAX(position)+GAP`, emits a
  `column.created` event, and does **not** call `recordActivity`. `PATCH`
  does call `recordActivity` — the codebase is internally inconsistent on
  column-activity logging.
- `columns` table has all needed fields already: `title`, `position`,
  `wip_limit` (CHECK null or >0), `policy` (TEXT, the per-column description),
  `is_done`, `is_signable`, `signable_assignee_id`, `color` (nullable TEXT).
  **No schema migration required.**
- `policy` IS the per-column description field — rendered at
  `ColumnView.tsx:460`, settings placeholder "When does a card belong here?".
  There is no separate `description` column on `columns` (`description` lives
  on `cards`).
- Empty-board surface: `BoardPage.tsx:470` renders the shared `EmptyState`
  component when `columns.length === 0`, with `<AddColumn>` as its CTA.
- Realtime: the client SSE consumer (`BoardContext.tsx:447`) ignores
  `column.created` payloads — any non-special event triggers a debounced
  `refresh()`. A single `column.created` reuses the existing path; no new
  event type is needed.
- `is_done` has a single-column invariant (PATCH unsets other done-columns);
  safe on an empty workspace.
- Reusable UI exists: `SuccessAnimation.tsx` (one-shot lottie tick) and
  `LoadingCamel.tsx`. `AgentBoardVisual.tsx:132,140` already pairs them in a
  loading→success flow (the quality bar to mirror).
- Color name→CSS mapping exists inline in `ColumnView.tsx` (`colorToSwatch`
  → `var(--color-*-200)`, `colorLabel`, border/bg-50 class map); CSS vars in
  `client/src/index.css`.

### Problem / Motivation
Empty board = zero time-to-value and no guidance on "correct" kanban structure.
Templates collapse setup to one click and act as social proof for good workflow
patterns. The discovery moment (empty board) is also the safest apply surface —
it sidesteps the data-loss risk of applying to a populated board.

### Related Areas
- `server/src/routes/columns.ts`, `server/src/routes/helpers.ts`
  (`recordActivity`), `server/src/realtime.ts`, `server/src/validators/`
- `client/src/pages/BoardPage.tsx`, `client/src/components/EmptyState.tsx`,
  `client/src/components/ColumnView.tsx`, `client/src/api.ts`,
  `client/src/components/SuccessAnimation.tsx`, `LoadingCamel.tsx`

---

## Scope

### In-Scope
- 5 curated system templates, hardcoded client-side as ordered column-config
  arrays (Software Dev, Firmware/Hardware, Management/Ops, Purchasing,
  Bug Tracker — see Appendix).
- Inline template picker that **replaces** the empty-state content at
  `BoardPage.tsx:470` when `columns.length === 0`.
- Per-card always-visible preview: color chips + column titles + `policy`
  descriptions as compact muted micro-text (NOT hover-gated — touch/a11y safe).
- "Start blank instead" always visible — picker is never a gate.
- New `POST /workspaces/:id/columns/batch`: atomic multi-column insert in a
  single transaction.
- One `column.created` event after the batch (reuse existing union).
- One `create` activity record `{templateName, columnCount}` written inside
  the transaction.
- Server-side empty-workspace guard (rejects non-empty with 409).
- Loading state during apply → success lottie + "board is ready, edit anytime"
  → auto-transition to board.

### Out-of-Scope
- Applying templates to a NON-empty workspace — data-loss risk; hard 409 guard.
- User-created / save-as-template — needs DB table + CRUD (Phase 2).
- DB-stored templates (Direction C) — premature generalization.
- `is_signable` / `signable_assignee_id` in templates — needs a member
  reference unavailable at apply-time; config shape is forward-compatible only,
  and the batch endpoint must NOT persist these even if a client sends them.
- Custom colors — locked to the 5-name palette.
- Schema migration — all fields already exist.
- Template undo / bulk-delete — one-way; user deletes columns individually via
  existing `DELETE /columns/:id`.

---

## Architecture Constraints

- **May touch:** client presets/components, `BoardPage` empty-state, `api.ts`,
  `server/src/routes/columns.ts`, validators.
- **Must NOT touch:** `columns` schema, the realtime event union (reuse
  `column.created`), the PATCH single-done invariant.
- **Patterns to follow:**
  - Server uses NodeNext — `.js` extensions in imports even for `.ts`.
  - Reuse existing validators: `validateColumnName`, `isValidColumnColor`, plus
    the wip/policy/isDone checks from the PATCH handler.
  - Batch endpoint MUST reject a non-empty workspace server-side (not client-only).
  - Positions computed inside the transaction (`i * POSITION_GAP` from a zero
    base; workspace is empty).
  - Color palette locked to 5 names; each template defines ≤1 done-column.
  - `recordActivity` inside the transaction; `publishEvent` after COMMIT,
    best-effort (realtime degrades gracefully).
- **Architecture validation result:** PASS.

---

## Stories + Scenarios

### Story: Seed an empty board from a template
> As a workspace member on an empty board, I want to apply a curated column
> template, so that I start working in seconds instead of building columns
> from scratch.

**Rule 1: Apply is allowed only on an empty workspace (server-enforced)**
- Example A: workspace with 0 columns → apply succeeds.
- Example B: workspace with ≥1 column → 409, no writes.

```gherkin
Scenario: Apply template to empty board (happy path)
  Given an empty workspace (0 columns) and a member viewing the inline picker
  When the member clicks "Use this template" on "Software Dev"
  Then 5 columns are created in one transaction, in defined order
  And each column has its title, color, wip_limit, policy, is_done set
  And exactly one column has is_done = true ("Done")
  And one column.created event is published after commit
  And one "create" activity record {templateName:"Software Dev", columnCount:5}
      is written inside the transaction
  And the UI shows loading, then the success lottie + "Your board is ready —
      edit any column anytime", then auto-transitions to the rendered board

Scenario: Reject apply on a non-empty workspace
  Given a workspace that already has >= 1 column
  When POST /columns/batch is called
  Then the server responds 409 and creates no columns
  And no event and no activity record are written
```

**Rule 2: Apply is atomic**
- Example C: insert fails on column 3 → 0 columns persist.

```gherkin
Scenario: Atomic rollback on mid-apply failure
  Given an empty workspace
  When the batch insert fails partway (e.g. a DB error on the 3rd column)
  Then the transaction rolls back and 0 columns persist
  And the client shows an error toast and the picker remains
```

**Rule 3: Losing client on 409 transitions to the populated board (silent)**
- Example D: concurrent member won → loser refetches, renders board, light info toast.
- Example E: same user double-clicks after success → renders board, no toast.

```gherkin
Scenario: Concurrent apply race
  Given two members both viewing the picker on the same empty workspace
  When both click apply near-simultaneously
  Then the first transaction wins and creates the columns
  And the second apply is rejected 409 with no duplicate columns
  And the second client refetches and renders the now-populated board
  And shows a light info toast ("This board was just set up.")

Scenario: Double-click own apply
  Given a member whose apply has just succeeded
  When a duplicate batch request is sent and returns 409
  Then the client silently refetches and renders the board (no error toast)
```

**Rule 4: Validation — palette colors, ≤1 done-column, non-empty array**
```gherkin
Scenario: Invalid template payload rejected
  Given a batch request with an invalid color, OR more than one done-column,
        OR an empty columns array
  When POST /columns/batch is called
  Then the server responds 400 with a validation error and creates no columns
```

**Rule 5: Picker is never a gate**
```gherkin
Scenario: Start blank
  Given an empty workspace with the inline picker
  When the member clicks "Start blank instead"
  Then the picker dismisses to the manual AddColumn empty state
  And no columns are created
```

**Rule 6: Forward-compatible config — signable never persisted by batch**
```gherkin
Scenario: Batch ignores signable fields
  Given a batch request that includes is_signable / signable_assignee_id
  When POST /columns/batch is called
  Then those fields are ignored — created columns have is_signable = false
      and signable_assignee_id = null
```

---

## Acceptance Criteria

```
Rule: Empty-only apply (server-enforced)
  ✓ Given 0 columns, When apply "Software Dev", Then 5 columns created in order, one is_done
  ✗ Given >=1 column, When POST /columns/batch, Then 409, no columns, no event, no activity

Rule: Atomicity
  ✓ Given empty workspace, When all configs valid, Then all columns created in one tx
  ✗ Given a mid-insert failure, When apply runs, Then 0 columns persist (rollback) + error toast

Rule: One event + one activity
  ✓ Given a successful apply, When committed, Then exactly one column.created event published
  ✓ Given a successful apply, When committed, Then one "create" activity {templateName, columnCount}

Rule: 409 losing-client → silent transition
  ✓ Given concurrent loser, When 409, Then refetch + render board + light info toast
  ✓ Given own double-click, When 409, Then refetch + render board, no error toast

Rule: Validation
  ✗ Given invalid color, When apply, Then 400
  ✗ Given >1 done-column, When apply, Then 400
  ✗ Given empty columns array, When apply, Then 400

Rule: Picker never a gate
  ✓ Given empty board, When "Start blank instead", Then manual AddColumn state, no columns

Rule: Forward-compatible (signable not persisted)
  ✓ Given batch payload with signable fields, When apply, Then created columns have is_signable=false, signable_assignee_id=null

Rule: Preview (a11y)
  ✓ Given the picker, When rendered, Then each card shows color chips + titles + policy descriptions always-visible (not hover-only)
```

---

## Design Decision

**Chosen option:** Option A — Batch route in `columns.ts` + client preset module.

**Summary:** Add `POST /workspaces/:id/columns/batch` to the existing
`columnsRouter`. Single transaction: `SELECT ... FOR UPDATE` on the workspace
row → count columns (serializes concurrent applies; non-empty → ROLLBACK + 409)
→ insert N columns with positions `i * POSITION_GAP` → `recordActivity` in-tx
(valid: `card_id` and `to_column_id` are nullable, dropped at schema.sql:62,64)
→ COMMIT → `publishEvent("column.created")` best-effort. Templates live in
a new client const module (`client/src/lib/templates.ts`). The color name→CSS
mapping is extracted from `ColumnView.tsx` into a shared module reused by both
the picker and `ColumnView`.

**Rejected options:**
- Sequential client POSTs: fails the atomic-rollback scenario (partial apply,
  no rollback) and violates the one-event/one-activity rules.
- DB-stored template table: satisfies scenarios but violates Out-of-Scope
  (migration + CRUD) — overbuilt for column seeding.

**Key tradeoffs accepted:**
- One new server endpoint + a small shared-color-map refactor (vs zero backend
  change) — bought atomicity and clean failure handling.
- templateName is a free-text client assertion in the activity log (no server
  registry) — acceptable; it is only a log label.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Success auto-dismiss timing | assumed: ~2s after lottie completes, then auto-transition to board | Mild UX feel; trivially tunable |
| Batch request shape | assumed: client sends `{templateName, columns:[{title,color,wipLimit,policy,isDone}]}`; server logs name, validates structure | Low; shape is internal |
| templateName validation | assumed: free-text, length-bounded, not checked against a registry (none exists) | Garbage log label only; no data integrity impact |
| Activity/publish failure ordering | resolved: recordActivity in-tx (atomic with columns); publishEvent post-commit best-effort | None — chosen explicitly |

---

## Implementation Notes

- Reuse `validateColumnName`, `isValidColumnColor`, and replicate the
  wip/policy/isDone validation from the PATCH handler for each column in the array.
- Validate `≤1 done-column` and `non-empty array` at the endpoint.
- The empty-workspace guard must SERIALIZE concurrent applies. A plain
  `SELECT count(*)` under Postgres READ COMMITTED does NOT serialize — both
  concurrent txs see 0 columns and both insert. The transaction MUST first take
  a row lock on the parent workspace, then count:
  `SELECT id FROM workspaces WHERE id = $1 FOR UPDATE;` then
  `SELECT count(*) FROM columns WHERE workspace_id = $1;` — if > 0, ROLLBACK +
  409. The second concurrent apply blocks on the lock, then sees the columns and
  gets 409. (A unique constraint is NOT an option — `columns` schema is frozen.)
  This makes "no duplicate columns" a hard, guaranteed invariant.
- Batch must strip/ignore `is_signable` and `signable_assignee_id` (created
  columns: `is_signable=false`, `signable_assignee_id=null`).
- Client apply mirrors `onAddColumn`: call the batch API, then `await refresh()`;
  on 409, `refresh()` + render (info toast only for the concurrent-other case).
- Extract the color name→CSS map out of `ColumnView.tsx` into a shared module to
  avoid duplication between picker and column.
- All UI tokens (type scale, chip sizing, spacing, OKLCH colors, button styles)
  follow `docs/pocket/rule/creative-brief.md` (Work Sans, radius 6px, primary
  buttons primary-600, neutral micro-text neutral-600).
- Client tests run via `npm run test --workspace=client` (jsdom needs workspace).

---

## Rollback Plan

- Feature is additive. To disable: remove the picker render branch in
  `BoardPage` (empty state reverts to the existing `<AddColumn>` CTA) — the
  batch endpoint becomes dead code with no data impact.
- No migration to reverse; `columns` schema is unchanged.
- Columns created by a template are ordinary columns — deletable via existing
  `DELETE /columns/:id`.

---

## Appendix: Template Definitions

Colors ∈ {powder-blue, pale-sky, light-cyan, frozen-water, turquoise}.
`policy` = per-column description. Each template has exactly one done-column.

### Software Dev — "Ship code, track work"
1. Backlog · powder-blue · — · "Ideas & requests, not yet scheduled."
2. To Do · pale-sky · — · "Ready to pick up next."
3. In Progress · light-cyan · wip 3 · "Actively being worked on."
4. In Review · frozen-water · wip 2 · "Awaiting review or QA."
5. Done · turquoise · done · "Shipped and verified."

### Firmware / Hardware — "Build & test units"
1. Backlog · powder-blue · — · "Requests & ideas, not yet scheduled."
2. Design · pale-sky · — · "Schematics & specs in progress."
3. Implementation · light-cyan · wip 2 · "Building the unit."
4. Bench Test · frozen-water · wip 2 · "Validation on the bench."
5. Shipped · turquoise · done · "Released to production."

### Management / Ops — "Plan & run ops"
1. To Plan · powder-blue · — · "Needs scoping before scheduling."
2. This Week · pale-sky · wip 5 · "Committed for this week."
3. In Progress · light-cyan · wip 3 · "Currently being executed."
4. Blocked · frozen-water · — · "Stuck — needs unblocking."
5. Done · turquoise · done · "Completed."

### Purchasing — "Track procurement"
1. Requested · powder-blue · — · "Requested, pending review."
2. Approval · pale-sky · — · "Awaiting budget sign-off."
3. Ordered · light-cyan · — · "PO placed with supplier."
4. Received · frozen-water · — · "Goods received, pending check."
5. Closed · turquoise · done · "Paid and closed."

### Bug Tracker — "Triage to resolution"
1. New · powder-blue · — · "Reported, not yet triaged."
2. Triaged · pale-sky · — · "Confirmed & prioritized."
3. Fixing · light-cyan · wip 3 · "Fix in progress."
4. Verifying · frozen-water · wip 2 · "Fix under verification."
5. Resolved · turquoise · done · "Verified & closed."
