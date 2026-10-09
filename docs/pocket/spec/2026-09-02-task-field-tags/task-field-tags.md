# Task Field Tags for Create Flows

**Date:** 2026-09-02
**Status:** approved
**Author:** brainstorm session
**Spec path:** `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`

---

## Summary

Add a keyboard-first `@` field command to Camel's two primary task creation surfaces: Board inline Add Card and Tracker New Item. A workspace member can write a title, choose supported metadata through a two-stage field/value popover, review the selected values as end-of-title chips, and create a fully configured card or tracker item without reopening its detail view. The implementation must retain native textarea behavior, preserve Board/Tracker persistence boundaries, and make each create mutation atomic.

---

## Context

### Current State

- Board inline creation is implemented by `AddCard` in `client/src/components/ColumnView.tsx`. It accepts only a title, and Enter creates the card.
- `client/src/pages/BoardPage.tsx` calls `api.createCard`, catches failures, and refreshes the board. The callback currently returns `Promise<void>`, so `AddCard` cannot distinguish success from a swallowed failure.
- `client/src/api.ts` and `POST /cards` currently accept only `columnId`, `title`, and `description`. The server explicitly rejects `statusId` during card creation.
- Tracker creation is implemented by `client/src/components/tracker/TrackerCreateModal.tsx`. It already has draft controls for status, priority, assignees, labels, project, and phase.
- Tracker creation uses canonical `POST /work-items`, backed by the tracker-item handler. The server already understands start and end dates, but the client create type does not expose them.
- `client/src/components/tracker/TrackerPropertyPicker.tsx` already implements ArrowUp, ArrowDown, Enter, Escape, search, and multi-value selection patterns.

### Problem / Motivation

Users commonly write the task title first, create the task, reopen it, and then fill metadata such as assignee or project. This breaks creation into multiple interactions and makes the fast Board input especially limited. The target outcome is that a user can create a fully configured task from the initial creation surface without opening the new card or tracker item afterward.

### Related Areas

- `client/src/components/ColumnView.tsx`
- `client/src/pages/BoardPage.tsx`
- `client/src/components/tracker/TrackerCreateModal.tsx`
- `client/src/components/tracker/TrackerPropertyPicker.tsx`
- `client/src/components/BoardCardTaxonomyFields.tsx`
- `client/src/components/AssigneePicker.tsx`
- `client/src/api.ts`
- `server/src/routes/cards.ts`
- `server/src/routes/tracker-items.ts`
- `server/src/routes/tracker-item-parsers.ts`
- `server/src/routes/card-assignees.ts`
- `server/src/routes/tracker-projects.ts`
- `server/src/routes/tracker-phases.ts`
- `server/src/routes/helpers.ts`
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md`
- `docs/pocket/rule/creative-brief.md`

---

## Scope

### In-Scope

- Add `@` field commands to the primary title editor in:
  - Board inline Add Card.
  - Tracker New Item.
- Open a field picker when `@` is typed at the permitted title boundary.
- Open a searchable value picker after a field is selected.
- Support keyboard navigation, selection, cancellation, chip editing, and focus restoration.
- Render selected metadata as removable, editable chips at the end of the title editor.
- Keep the existing Tracker property controls and synchronize them with the same draft state.
- Persist the title and all selected metadata in one atomic create mutation.
- Add client API, server route, validation, locking, activity, realtime, notification, and test changes required by the confirmed behavior.
- Add lock-only changes to member/project/phase removal paths where needed to enforce a workspace-first lock protocol during concurrent invalidation.

### Out-of-Scope

- Editing an existing card or tracker item.
- Commands in Description, chat, agent composer, bulk edit, or any creation surface other than the two listed above.
- Creating new members, vocabularies, projects, phases, or other option values from a command query.
- Board Status/Column selection; a Board card remains in the column where Add Card was opened.
- Natural-language metadata parsing such as pasted `@priority high` expressions.
- Persisting chip markup in a task title.
- Consolidating `cards` and `tracker_items` or their event tables.
- Durable idempotency keys or an exactly-once guarantee after a committed response is lost.
- Changes in `camel-lottie/`.

---

## Architecture Constraints

- Layers this work may touch: shared client task-entry components/hooks, the two create surfaces, client API types/errors, Board and Tracker create routes, shared metadata validation, relevant removal lock paths, and tests.
- Layers this work must not merge or bypass: Board and Tracker persistence, activity tables, and source-aware route semantics.
- Board must continue to derive status from its destination column and reject `statusId` on create.
- Tracker must continue to create through canonical `/work-items`; `/tracker/items` remains a legacy alias of the same handler.
- Every form owns one metadata reducer instance. Existing Tracker pickers, command selection, and chips must dispatch to that reducer rather than keeping parallel field state.
- Separate the client feature into:
  - metadata draft reducer and invariants;
  - command/menu/focus state machine;
  - composite title editor;
  - Board and Tracker adapters.
- Keep a native textarea as the title source. Chips are sibling elements inside one visual editor shell and always appear after title text; do not introduce `contenteditable`.
- Server metadata validation must accept a `DBExecutor`, run inside the create transaction, batch queries where practical, aggregate all field errors, and complete before identity counters, main rows, relation rows, or activity rows are written.
- Mutation lock order must be consistent: workspace, actor/referenced rows in deterministic category-and-ID order, destination column, then inserts. Relevant member/project/phase removals must acquire the workspace lock before deletion, dependent scans, soft-deletion, or cleanup.
- Card scalar metadata, assignee/label relations, and `card_events` must be committed atomically.
- Tracker scalar metadata, relations, and `tracker_events` must remain atomic.
- Realtime events and notifications occur only after commit and are best-effort; their failure must not turn a committed create into an HTTP failure.
- Preserve the existing `error: string` and HTTP status contract. Add optional, typed, stable `fieldErrors` data for field-level invalid references.
- Cache/load Board metadata catalogs once per workspace, not once per column, with independent loading/error/retry state per catalog.
- Follow the Camel creative brief, use visible focus, expose combobox/listbox semantics, announce chip changes, guard IME composition, and do not animate high-frequency keyboard command actions.
- **Architecture validation result: PASS.**

---

## Dependencies

### Existing (to leverage)

- React 18 — reducer, local state machine, focus management, and shared components.
- `date-fns` 4 — local calendar-date preset arithmetic and formatting.
- `lucide-react` — existing field and metadata icons.
- Existing `TrackerPropertyPicker` interaction patterns — searchable options and keyboard behavior.
- Express, Kysely, and PostgreSQL transactions — request validation, deterministic locks, and atomic persistence.

### New (proposed)

None.

Lexical was verified as capable of custom segmented nodes, React plugins, serialization, and keyboard command handling, but rejected because true rich-text nodes add disproportionate state, bundle, migration, and synchronization complexity for chips constrained to the end of a native title field. A custom `contenteditable` implementation was rejected because it would hand-roll selection, IME, paste, undo, Backspace, and screen-reader behavior.

---

## Field Availability

### Board Add Card

- Assignee (multi-value)
- Priority (single-value)
- Labels (multi-value)
- Project (single-value)
- Phase (single-value, linked to Project)
- Due date (single-value)

Status/Column is intentionally unavailable. The originating Board column is the create destination and remains the source of Board status.

### Tracker New Item

- Status (single-value)
- Priority (single-value)
- Assignee (multi-value)
- Labels (multi-value)
- Project (single-value)
- Phase (single-value, linked to Project)
- Start date (single-value)
- End date (single-value)

When Tracker creation starts from a locked project/phase context, the locked fields are not offered while the context remains valid.

---

## Stories + Scenarios

### Story 1: Add metadata while writing a title

> As a workspace member, I want to add metadata while writing a task title so that I do not have to reopen the task after creation.

**Rule 1: `@` opens a field command only at the title boundary**

- `Fix login @` opens the field menu.
- `Notify foo@bar.com` does not open the menu.
- Commands and completed chips are allowed only after title text, not between title words.

```gherkin
Scenario: Open the field menu
  Given the Board title is "Fix login "
  When the user types "@"
  Then the Board field popover opens
  And keyboard focus is represented on the first available option

Scenario: Do not trigger inside an email-like word
  Given the title is "Notify foo@bar.com"
  When the user continues typing
  Then the field popover does not open

Scenario: Abandon a partial command
  Given the title editor contains "Fix login @pri"
  When the user presses Escape or clicks away
  Then the popover closes
  And "@pri" remains literal title text

Scenario: Ignore IME composition keystrokes
  Given text composition is active
  When "@" or Enter occurs before compositionend
  Then no command opens or selection occurs
```

**Rule 2: Field and value selection are keyboard accessible**

- Selecting Assignee and searching `raf` resolves to an existing member named Rafi.
- Enter on an empty result does not create a new option.

```gherkin
Scenario: Select an assignee with the keyboard
  Given the field menu is open for the title "Fix login"
  When the user chooses Assignee
  And types "raf" in the value search
  And moves with ArrowUp or ArrowDown
  And presses Enter on "Rafi"
  Then an "Assignee: Rafi" chip appears after the title
  And the persisted title candidate remains "Fix login"

Scenario: Do not create a missing option
  Given a value search has no results
  When the user presses Enter
  Then no value is selected or created
  And the user can cancel or return to the field menu

Scenario: Consume Enter while the picker is unavailable
  Given the active picker is loading, failed, disabled, or has no result
  When the user presses Enter
  Then the picker consumes the keystroke
  And the create form does not submit
```

**Rule 3: Chips can be corrected without corrupting title input**

```gherkin
Scenario: Edit a chip by clicking it
  Given the draft has a "Priority: High" chip
  When the user clicks the chip
  Then the Priority value picker opens with High selected

Scenario: Remove a chip by pointer or keyboard
  Given a chip is at the end of the editor
  When the user activates its remove control
  Or presses Backspace once at the chip boundary to select it and again to remove it
  Then the chip and its draft value are removed
  And the plain title remains unchanged

Scenario: Restore title focus after a picker closes
  Given a field or value picker is open
  When it closes through Enter, Escape, Done, or click-away
  Then focus and caret return to the title editor
  And the create surface remains open

Scenario: Close nested layers in order
  Given a Tracker value picker is open inside the command flow
  When the user presses Escape repeatedly
  Then the first relevant press closes the value picker
  And the next closes the field command if it remains open
  And only the final unhandled press closes the Tracker modal
```

### Story 2: Keep metadata valid and synchronized

> As a workspace member, I want command chips to follow task field rules so that the draft cannot silently contain conflicting metadata.

**Rule 1: Single-value fields replace; multi-value fields toggle without duplicates**

```gherkin
Scenario: Replace a single-value field
  Given the draft has "Priority: High"
  When the user selects "Priority: Low"
  Then Low replaces High
  And only one Priority value is included in the create payload

Scenario: Select multiple assignees
  Given the Assignee picker is open
  When the user selects Rafi and then Maya
  Then both members are selected
  And the picker remains open until Escape or Done

Scenario: Prevent duplicate multi-value relations
  Given Rafi is already selected
  When Rafi is selected again through the command flow
  Then current toggle semantics are applied
  And the payload never contains a duplicate Rafi user ID
```

**Rule 2: Project and Phase remain consistent**

```gherkin
Scenario: Derive Project from Phase
  Given the draft has no Project
  When the user selects the "Launch" Phase
  Then the parent Project of Launch is selected automatically
  And both values are included in the payload

Scenario: Clear an incompatible Phase
  Given Project Web and Phase Build are selected
  When the user changes Project to Mobile where Build is unavailable
  Then the Phase is cleared

Scenario: Clear Phase when Project is removed
  Given Project Web and Phase Build are selected
  When the Project chip is removed
  Then the Phase chip and value are also removed
```

**Rule 3: Existing Tracker controls and commands share one draft**

```gherkin
Scenario: Reflect a command selection in the existing picker
  Given the Tracker draft has no Priority
  When the user selects "Priority: High" through the command
  Then the existing Priority control displays High

Scenario: Reflect an existing picker selection in the chip list
  Given the Tracker command chips are visible
  When the user changes Priority through the existing control
  Then the inline Priority chip reflects the same reducer state
```

**Rule 4: Locked Tracker context remains authoritative while valid**

```gherkin
Scenario: Honor a valid project context lock
  Given Tracker New Item is opened from locked Project Alpha and Phase Build
  When the field menu opens
  Then Project and Phase are not offered
  And the item remains targeted at Alpha and Build

Scenario: Recover from a deleted locked context
  Given the locked Project or Phase is deleted before submit
  When the user attempts to create the item
  Then creation is rejected without clearing the draft
  And a context-level error identifies the invalid destination
  And the invalid lock is released so the user can choose a valid destination
```

**Rule 5: Board column is fixed by the creation surface**

```gherkin
Scenario: Preserve the originating Board column
  Given Add Card is open in the "To do" column
  When the field menu opens
  Then Status and Column are not offered
  And successful creation places the card in "To do"
```

**Rule 6: Date values use validated local calendar dates**

```gherkin
Scenario: Resolve a Next week preset
  Given the user's local calendar date is 2026-09-02
  When the user selects "Due date: Next week"
  Then the draft date is 2026-09-09
  And the API payload contains the date-only value "2026-09-09"

Scenario: Preserve calendar dates across time boundaries
  Given a preset crosses a DST, month, or year boundary
  When Today, Tomorrow, or Next week is selected
  Then local calendar arithmetic is used
  And no UTC-hour arithmetic changes the intended YYYY-MM-DD date

Scenario: Reject an invalid Tracker date range immediately
  Given the Tracker Start date is 2026-09-10
  When the user attempts to select End date 2026-09-09
  Then the new End date is not applied
  And the previous valid value remains
  And an explanation states that End date cannot precede Start date
```

**Rule 7: Catalog loading is fail-soft and distinguishable**

```gherkin
Scenario: Continue when one catalog fails
  Given the Assignee catalog fails to load and Priority loads successfully
  When the user opens the field menu
  Then Assignee is disabled with a concise error and Retry action
  And Priority remains usable
  And a task without Assignee can still be created

Scenario: Distinguish loading, empty, and failed catalogs
  Given a catalog request has not completed
  When the field menu opens
  Then the field displays a loading state rather than empty or failed
  And an empty catalog does not offer option creation
```

### Story 3: Create a fully configured task atomically

> As a workspace member, I want one create action to save the title and all chosen metadata so that no partially configured task is left behind.

**Rule 1: Title validation applies only to persisted plain text**

```gherkin
Scenario: Reject a chips-only draft
  Given the editor contains metadata chips but no non-whitespace title text
  When the user attempts to submit
  Then no create request is sent
  And the title-required state is shown

Scenario: Exclude chips from title length validation
  Given the plain title is exactly the endpoint's allowed maximum length
  And metadata chips are present
  When the user submits
  Then title validation counts only the persisted plain title
  And chip labels do not consume title characters
```

**Rule 2: Existing submit keyboard behavior remains intact**

```gherkin
Scenario: Submit Board with Enter outside a popover
  Given Add Card has a valid title and no popover is open
  When the user presses Enter without Shift
  Then the Board create action runs

Scenario: Preserve Tracker Enter shortcuts
  Given Tracker New Item has a valid title and no popover is open
  When the user presses Enter without modifiers
  Then the form does not submit
  And Cmd+Enter or Ctrl+Enter submits the form
```

**Rule 3: Board metadata is persisted in one card-create transaction**

```gherkin
Scenario: Create a fully configured Board card
  Given Add Card is open in "To do"
  And the title is "Fix login"
  And Assignee Rafi, Priority High, Project Web, Phase Build, and Due date 2026-09-09 are selected
  When the user clicks Add to board
  Then one card is created in "To do" with every selected field
  And the card is immediately usable without opening its detail view

Scenario: Merge explicit and signable-column assignees
  Given the destination column auto-assigns Rafi
  And the draft explicitly selects Maya
  When the card is created
  Then the final assignees are Rafi and Maya
  And each user has one assignee relation and at most one assignment notification

Scenario: Deduplicate the same automatic and explicit assignee
  Given the destination column auto-assigns Rafi
  And the draft explicitly selects Rafi
  When the card is created
  Then Rafi is stored once
  And at most one assignment notification is emitted for Rafi

Scenario: Reject a stale signable-column assignee
  Given the destination column references an auto-assignee who is no longer a workspace member
  When the user submits
  Then the whole create is rejected
  And the draft remains intact
  And the error identifies the column configuration
```

**Rule 4: Tracker metadata is persisted in one item-create transaction**

```gherkin
Scenario: Create a fully configured Tracker item
  Given the title is "Ship onboarding"
  And valid Tracker metadata including dates is selected
  When the user clicks Create item or presses Cmd+Enter or Ctrl+Enter
  Then one tracker item is created with every selected field
  And the command chips and existing controls represented the same draft before submit
```

**Rule 5: Invalid references reject the entire mutation with complete field feedback**

```gherkin
Scenario: Reject multiple stale references together
  Given Project Web and Assignee Rafi are selected
  And both references become invalid before submit
  When the user submits
  Then the server returns field errors for Project and Assignee in one response
  And no task or relation row is created
  And every offending chip is marked
  And the draft remains intact

Scenario: Reject a revoked assignee
  Given an assignee was valid when selected
  And that member is removed from the workspace before submit
  When the user submits
  Then creation is rejected atomically
  And the Assignee chip is marked invalid

Scenario: Resolve a concurrent reference deletion atomically
  Given a selected reference is deleted concurrently with create
  When the transactions complete
  Then the outcome is either one complete valid task or one complete rejection
  And no orphaned or partially configured task remains

Scenario: Roll back every side effect on invalid create
  Given any metadata validation fails
  When the create transaction is rejected
  Then no main task row, relation row, activity event, realtime event, or notification is written
```

**Rule 6: Every submit failure preserves the draft**

```gherkin
Scenario: Preserve the draft on any submit failure
  Given a valid title and metadata draft
  When creation fails because of validation, WIP limit, network failure, or server error
  Then the create surface remains open
  And the title and every chip remain unchanged
  And only a confirmed create success may clear or close the draft

Scenario: Prevent an in-flight duplicate submit
  Given a create request is in progress
  When the user activates the CTA or submit shortcut again
  Then no second create request starts

Scenario: Retry after a failed request
  Given a create request failed before a success response
  And the preserved draft is submitted again
  When the retry succeeds
  Then one task is created by the successful request
  And the draft clears only after success
```

**Rule 7: Committed create and UI refresh are separate outcomes**

```gherkin
Scenario: Treat refresh failure as synchronization failure
  Given the create API committed and returned success
  When the subsequent Board refresh fails
  Then the create form does not invite a create retry
  And the UI reports or schedules a background synchronization retry
```

**Rule 8: Create more retains only context metadata**

```gherkin
Scenario: Reset the Tracker draft selectively
  Given Create more is enabled
  And Status is In Progress, Project is Web, Phase is Build, Assignee is Rafi, and Priority is High
  When the item is created successfully
  Then the new draft retains Status, Project, and Phase
  And title, Description, Assignees, Labels, Priority, Start date, and End date are reset
```

---

## Acceptance Criteria

```text
Rule: Command trigger and keyboard flow
  ✓ Given a title ending at a valid whitespace boundary, When @ is typed, Then a field popover opens.
  ✓ Given a field is selected, When the user searches and presses Enter on a valid value, Then an end-of-title chip is added.
  ✓ Given a picker is open, When ArrowUp/ArrowDown/Enter/Escape are used, Then navigation, selection, and layered cancellation work without unintended form submission.
  ✗ Given @ occurs inside an email-like word or during IME composition, When input continues, Then no premature command action occurs.

Rule: Chip and title integrity
  ✓ Given a selected chip, When it is clicked or reached with Backspace, Then it can be edited or removed without changing title text.
  ✓ Given title text at the endpoint limit plus chips, When submitted, Then only persisted title text counts toward the limit.
  ✗ Given chips but no non-whitespace title, When submitted, Then no create request is sent.

Rule: Field invariants
  ✓ Given a single-value field already exists, When a new value is chosen, Then the old value is replaced.
  ✓ Given a multi-value field, When values are toggled, Then no duplicate IDs are produced and the picker stays open until Done/Escape.
  ✓ Given a Phase without a Project, When selected, Then its parent Project is derived.
  ✓ Given a Project is changed or removed, When its Phase becomes invalid, Then the Phase is cleared.
  ✗ Given End date would precede Start date, When selected, Then the invalid selection is rejected immediately.

Rule: Surface-specific behavior
  ✓ Given Board Add Card, When @ opens, Then Assignee, Priority, Labels, Project, Phase, and Due date are available as their catalogs permit.
  ✗ Given Board Add Card, When @ opens, Then Status/Column is not offered and the originating column remains fixed.
  ✓ Given Tracker New Item, When @ opens, Then Status, Priority, Assignee, Labels, Project, Phase, Start date, and End date are available as their catalogs permit.
  ✓ Given valid locked Tracker context, When @ opens, Then locked Project/Phase fields are omitted.

Rule: Draft synchronization and loading
  ✓ Given a Tracker metadata change from @ or an existing picker, When the state changes, Then both controls reflect one reducer state.
  ✓ Given one catalog fails, When the command opens, Then other fields and title-only create remain usable and Retry is available.
  ✗ Given a picker is loading, failed, disabled, or empty, When Enter is pressed, Then no value is created and the form does not submit.

Rule: Atomic Board create
  ✓ Given valid Board title and metadata, When Add to board succeeds, Then one fully configured card is committed in the originating column.
  ✓ Given explicit and signable auto-assignees, When created, Then final assignees are unioned and deduplicated with one notification per unique user.
  ✗ Given statusId, stale metadata, stale auto-assignee, cross-workspace, or wrong-kind references, When submitted, Then the complete create is rejected.

Rule: Atomic Tracker create
  ✓ Given valid Tracker title and metadata, When Create item or its shortcut succeeds, Then one fully configured tracker item is committed.
  ✗ Given invalid Status/Priority kind, cross-workspace reference, stale membership, or invalid dates, When submitted, Then the complete create is rejected.

Rule: Complete error reporting and side-effect safety
  ✗ Given multiple invalid references, When submitted, Then all affected fields are returned and marked in one response.
  ✗ Given any validation failure, When the transaction aborts, Then no main row, relation, activity, SSE, notification, or partial task remains.
  ✓ Given any submit failure, When the error is returned, Then the title and all chips remain available for correction or retry.

Rule: Submit and reset behavior
  ✓ Given no popover is open, When Enter is used in Board, Then current Board submit behavior is retained.
  ✓ Given no popover is open, When Enter or Cmd/Ctrl+Enter is used in Tracker, Then current Tracker behavior is retained.
  ✓ Given a request is in flight, When submit is activated again, Then a duplicate request is suppressed.
  ✓ Given Tracker Create more succeeds, When the draft resets, Then Status/Project/Phase remain and title/Description/Assignees/Labels/Priority/dates clear.

Rule: Concurrent invalidation and committed responses
  ✓ Given create races with member/project/phase removal, When both complete, Then lock ordering yields a complete valid create or complete rejection.
  ✓ Given create committed but refresh fails, When the client handles the refresh error, Then it does not present the committed create as a failed create.
```

---

## Design Decision

**Chosen option:** Option A2 — Architecture-safe shared composite title editor

**Summary:** Keep native title textareas and render metadata chips as siblings within one editor shell. Share the metadata reducer and command state machine while preserving Board/Tracker adapters and persistence boundaries. Extend both create contracts with transaction-scoped, aggregated validation and a consistent workspace-first locking protocol.

**Rejected options:**

- **Lexical inline-node editor:** technically capable, but rejected because custom nodes, serialization, editor state, and synchronization with existing Tracker controls add disproportionate complexity for chips limited to the title end.
- **Custom `contenteditable`:** rejected because caret restoration, two-stage Backspace, IME, paste/undo, title extraction, and accessibility would be hand-rolled and high risk.
- **POST then PATCH Board metadata:** rejected because it violates atomic create and can leave a partial card.

**Key tradeoffs accepted:**

- Chips are visually inline at the end but are not embedded rich-text nodes.
- Supporting race-safe stale-reference behavior requires lock-only changes in related member/project/phase removal paths.
- Durable idempotency after a lost success response is deferred from v1.

---

## Architecture Validation Result

**Status:** PASS

Checks applied: quick checklist, modular-monolith/layer boundaries, ADR dual-table constraints, API compatibility, lock/deadlock safety, atomicity, event ordering, rollback/deployment, performance, security, accessibility, build-vs-buy, and test readiness.

Key findings:

- Board continues to write `cards`/`card_events`; Tracker continues to write `tracker_items`/`tracker_events`.
- Optional request fields and optional `fieldErrors` are additive and backward-compatible.
- Workspace-first locking plus deterministic reference locks closes the identified TOCTOU paths.
- Validation before any write supports complete rollback and aggregated errors.
- Post-commit best-effort events prevent a committed create from becoming an apparent HTTP failure.
- A reducer per form and separate UI/controller/adapters avoid god-object and shared-state failure modes.
- Existing dependencies are sufficient; no editor dependency is justified.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
| --- | --- | --- |
| What happens to a partial `@pri` command on click-away? | Assumed to match Escape and remain literal title text. | Users may expect abandoned command text to disappear; behavior can be refined without changing persistence. |
| Is a committed lost response safe to retry exactly once? | No. Durable idempotency is explicitly out-of-scope for v1. | A rare response-loss retry may duplicate a task; document and monitor before making exactly-once a requirement. |
| Does an initial due date emit a due-date-changed notification? | No. Initial creation metadata is represented by the create event; assignment notifications remain one per unique final assignee. | Teams expecting a due-date notification at creation would need a separate product decision. |

No blocking questions remain.

---

## Implementation Notes

- Preserve NodeNext `.js` extensions in server imports.
- Keep server validation normalized around a result such as metadata plus a stable `Partial<Record<FieldName, string[]>>` field-error map.
- Use batched membership/vocabulary/reference lookups rather than one query per selected ID.
- Perform reference validation with the transaction executor; do not call global `db` from create validation.
- Do not increment shared task/card identity counters until all validation passes.
- Acquire reference locks in deterministic category-and-ID order to avoid deadlocks.
- Keep `statusId` explicitly rejected in Board create tests.
- Separate Board create success from board refresh success in the client callback contract.
- Load/cache Board catalogs at workspace scope; do not create one catalog request set per `ColumnView`.
- Keep loading/error/retry independent per catalog so one failure does not blank every field.
- Use no animation for keyboard-opened or keyboard-navigated command actions. If pointer-opened popovers animate, use a brief origin-aware transition and respect reduced motion.
- Add combobox/listbox roles, active-descendant semantics, live announcements for chip add/remove/invalid state, Tab/Shift+Tab coverage, focus restoration, and `isComposing` guards.
- Deployment order: server first, then client. Rollback order: client first, then server if needed.
- Required verification includes root `npm run test`, typecheck, lint, `make check`, mutation routing guard, and the key-collision check when a database is available.

---

## Test Expectations

### Client

- Shared reducer invariants for single/multi fields, Project/Phase, dates, and selective reset.
- Command state machine for trigger boundaries, field/value transitions, search, no-result, loading/error, layered Escape, ArrowUp/ArrowDown, Enter consumption, Tab, click-away, and focus restoration.
- Composite editor for literal command fallback, chips-at-end, click/remove/two-stage Backspace, title extraction, max length, screen-reader announcements, and IME composition.
- Board adapter field availability, fixed column, catalog cache behavior, fail-soft loading, in-flight submit guard, failure draft preservation, and create-versus-refresh outcomes.
- Tracker adapter synchronization with existing pickers, locked-context behavior and recovery, date fields, keyboard shortcuts, and Create more reset.
- `ApiError` typed `fieldErrors` parsing while retaining existing constructor/call compatibility.

### Server

- Board create with every optional metadata field.
- Continued rejection of Board `statusId`.
- Tracker canonical `/work-items` and legacy `/tracker/items` parity.
- Aggregated multiple field errors.
- Cross-workspace and wrong-kind Status/Priority/Label validation.
- Revoked/invalid explicit assignee and stale signable auto-assignee.
- Explicit plus automatic assignee union and deduplication.
- Project/Phase inference and mismatch validation.
- Valid/invalid date ranges and date-only values.
- WIP limit with no writes.
- Transaction rollback leaves no main row, relation, activity, SSE, or notification.
- Concurrent member/project/phase invalidation follows the workspace-first lock protocol.
- Successful create emits expected activity and one assignment notification per unique assignee.
- Post-commit event/notification failure does not change a committed HTTP success.

---

## Rollback Plan

1. Deploy the server changes before the client so old clients remain compatible with the additive create fields.
2. If the new client causes issues, roll back the client first. The expanded server remains compatible with the old title-only create flow.
3. If server rollback is also required, do it after the client rollback so no new client sends metadata to a server that would ignore unsupported fields.
4. No database migration rollback is required.
5. Retain transaction/locking correctness changes unless they are directly proven to cause a regression; they protect existing mutation paths independently of the UI.
