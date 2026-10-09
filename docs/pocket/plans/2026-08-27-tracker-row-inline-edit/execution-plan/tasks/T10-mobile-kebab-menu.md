# Task T10 — Mobile kebab menu

**Phase:** 3
**Depends:** T9
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 10: Mobile kebab menu [depends: T9]

## OBJECTIVE
Build `TrackerRowKebabMenu`, a panel composing every available editable property (date, project,
phase, priority, assignee, label) with graceful empty-states, and wire a kebab (⋯) trigger
into `TrackerRow.tsx` using a `lg:hidden` CSS class (no JS breakpoint detection) so it exists
in the DOM at all viewport sizes but is visually hidden at `≥1024px` via CSS alone.

Files:
- Create: `client/src/components/tracker/TrackerRowKebabMenu.tsx`
- Test: `client/src/components/tracker/TrackerRowKebabMenu.test.tsx`
- Modify: `client/src/components/tracker/TrackerRow.tsx`
- Create: `client/src/components/tracker/TrackerRow.test.tsx` (created here in Step 9, extended by T11)

Steps:

1. Write failing test for: kebab panel lists all 6 properties when opened (Story 5 Rule 1)
   Test file: `client/src/components/tracker/TrackerRowKebabMenu.test.tsx`
   Level: unit

   Test intent:
   Given a `TrackerRowKebabMenu` rendered with a fully-populated item, a mounted `anchorRef`, projects, priorities,
   labels, and members (all as props, same shapes `TrackerRow` already receives), with
   `open={true}`
   When it renders
   Then the panel has an explicit accessible name, and all 6 property triggers (date, project,
   phase, priority, assignee, label) are present in the panel, queryable by their accessible names
   within the panel — regardless of which of them would also be visible inline in `TrackerRow` at
   the current width (this component doesn't know or care about breakpoints, it always renders all 6)

   Exercise through: rendering `<TrackerRowKebabMenu anchorRef={anchorRef} idPrefix="tracker-row-menu-CA-1" item={...} projects={...} priorities={...} labels={...} members={...} open={true} onOpenChange={vi.fn()} onDateChange={vi.fn()} onProjectChange={vi.fn()} onPhaseChange={vi.fn()} onPriorityChange={vi.fn()} onAssigneeToggle={vi.fn()} onLabelToggle={vi.fn()} />` and scoping trigger queries to the labeled panel so inline controls from a real row cannot make the assertions ambiguous.

   Test doubles: all `on*` callbacks as `vi.fn()` — do NOT mock `TrackerPropertyPicker` or `TrackerRowDatePopover`, render them for real

   Expected RED: `TrackerRowKebabMenu.tsx` does not exist yet

2. Run test — verify FAIL:
   `npm run test -- client/src/components/tracker/TrackerRowKebabMenu.test.tsx`

3. Implement minimal code to satisfy the test:
   File: `client/src/components/tracker/TrackerRowKebabMenu.tsx`
   Implement: a panel component with `anchorRef: RefObject<HTMLElement>`, `idPrefix`, item/options,
   `open`, `onOpenChange`, and optional callbacks. Portal the panel positioned from `anchorRef`
   via the existing placement primitive. Give the panel an explicit accessible name such as
   `More properties for ${item.key}` and restore focus to the kebab trigger after close. Keep one
   `activeField` union inside the panel so only one child picker is open at a time; opening a child
   first closes the current child through its close contract, then sets `activeField`, while the
   panel's outside pointer-down/Escape/close button closes the active child before calling
   `onOpenChange(false)`. A click inside the active DatePopover portal must count as inside the
   panel, using the date portal's containment signal. Stack one trigger per available property: a
   `TrackerRowDatePopover` for date and `TrackerPropertyPicker` instances for project/phase/
   priority/assignee/label. Give the date child the menu-prefixed `idPrefix`, keep stable accessible
   trigger names, and wrap each non-date child with a menu-prefixed test id or equivalent scoped
   marker. Scope property-trigger queries within this labeled panel rather than relying on globally
   unique accessible names. Pass the same Row-level callbacks through unchanged (no `item`
   argument). When a callback is absent, omit that field entirely. Do not add API calls or
   mutation-queue logic here. Empty-state rendering for empty `labels`/`members` arrays, and
   the date-child close/containment contract, are deferred to Step 7 so Step 5 can define
   them with a genuine red test.

4. Run test — verify PASS:
   `npm run test -- client/src/components/tracker/TrackerRowKebabMenu.test.tsx`

4a. Write a regression (already-green) case for callback omission: omit `onPhaseChange` and
    assert the phase field is absent while the other available fields remain. Expected: PASS
    — Step 3 already implements this. Do not fold this assertion into Step 5's red suite.
    `npm run test -- client/src/components/tracker/TrackerRowKebabMenu.test.tsx`

5. Write the remaining failing tests for: empty-state when labels/members are empty (Story 5 Rule 2,
   Story 4 Example D) and date-child lifecycle/portal containment
   Test file: `client/src/components/tracker/TrackerRowKebabMenu.test.tsx`
   Level: unit
   Test intent: Given `labels={[]}` and `members={[]}` are passed with their handlers defined,
   When the kebab panel renders and the label/assignee sections are inspected, Then it shows
   exactly `No labels in this workspace` and `No members in this workspace` rather than omitting
   either section. Companion cases: open the date field, edit a date, then activate another
   field and assert the date commit fires once; click inside the portaled date fields and assert
   the kebab panel does not close before the date child handles the interaction; close the panel
   and assert focus returns to the mounted kebab anchor.
   Exercise through: rendering with empty `labels`/`members` arrays, scoped queries within the labeled panel, and real `TrackerRowDatePopover` interactions
   Test doubles: none
   Expected RED: Step 3 omits a field only when its callback is absent; it does not yet
   implement the empty-array copy or the date-child lifecycle/portal containment rules.

6. Run test — verify FAIL:
   `npm run test -- client/src/components/tracker/TrackerRowKebabMenu.test.tsx`

7. Implement: replace any `length > 0 &&` conditional omission for label/assignee sections
   with an always-rendered section that shows the picker when options exist, or the exact
   empty-state message when the options array is empty and the handler is present. Wire the
   date-child close/containment contract from T3. Do not change the Step 3 rule that a missing
   handler omits the field.

8. Run test — verify PASS:
   `npm run test -- client/src/components/tracker/TrackerRowKebabMenu.test.tsx`

9. Write failing test for: kebab trigger renders in TrackerRow with the lg:hidden class
   Test file: `client/src/components/tracker/TrackerRow.test.tsx` (this file does not exist yet
   — creating it here is acceptable as this is the first test needing it; T11 will add the
   bulk of this file's coverage afterward)
   Level: unit
   Test intent: Given a `TrackerRow` is rendered with all required props (item, statuses,
   priorities, projects, labels, members, and handler callbacks — construct a minimal fixture
   item/props set), When the row renders, Then a kebab trigger element is present in the DOM
   with a class name containing "lg:hidden" (jsdom cannot evaluate real media queries, so this
   test asserts the CSS class is applied, not actual visibility — do not attempt to simulate
   viewport width)
   Exercise through: rendering `<TrackerRow ... />` directly (not through `TrackerPage`) and
   querying for the kebab trigger by accessible name, then inspecting its `className`
   Test doubles: all `on*` props as `vi.fn()`
   Expected RED: no kebab trigger exists in `TrackerRow.tsx` yet

10. Run test — verify FAIL:
    `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

11. Implement: add a kebab (⋯) button to `TrackerRow.tsx` with a `lg:hidden` class and
    `data-testid={\`row-more-${item.key}\`}`, rendered
    only when at least one of the 6 field handler props (`onDateChange`, `onProjectChange`,
    `onPhaseChange`, `onPriorityChange`, `onAssigneeToggle`, `onLabelToggle`) is defined —
    since all 6 are optional (per T4/T5/T6/T9's scope boundary), a call-site supplying none of
    them (i.e. `TrackerPhaseSection.tsx`, unmodified, out of scope) renders no kebab trigger at
    all rather than an empty/broken one; when rendered, wire it to open a
    `TrackerRowKebabMenu` with a ref to the trigger, the menu-prefixed `idPrefix="tracker-row-menu-${item.key}"`, and only the
    props/handlers that are actually defined. The menu renders an empty-state for an available
    but empty labels/members array; a field whose handler is absent is omitted. Extend the
    "which picker" union to include `"kebab"`. The trigger itself is inside `pointer-events-auto`
    and has accessible name `More properties`. The row's picker-transition helper must close the
    active date child before switching to kebab, and the kebab close path must return focus to this
    trigger after the portaled panel is removed.

12. Run test — verify PASS:
    `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

13. Refactor while green: if `TrackerRow.tsx` now exceeds ~300 lines, extract the block that
    builds the 6 sets of `PickerOption[]` arrays (shared between the inline triggers and the
    props passed to `TrackerRowKebabMenu`) into a single local computation reused by both,
    rather than building them twice
    Re-run both: `npm run test -- client/src/components/tracker/TrackerRow.test.tsx` and `npm run test -- client/src/components/tracker/TrackerRowKebabMenu.test.tsx` — both must stay PASS

14. Commit:
    `git add client/src/components/tracker/TrackerRowKebabMenu.tsx client/src/components/tracker/TrackerRowKebabMenu.test.tsx client/src/components/tracker/TrackerRow.tsx client/src/components/tracker/TrackerRow.test.tsx`
    `git commit -m "feat(tracker): add mobile kebab menu for narrow-viewport property access"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 5, full GWT
`client/src/components/tracker/TrackerProperties.tsx:167,192` — the `length > 0 &&` omission pattern this task deliberately does NOT replicate for the kebab
`client/src/components/tracker/TrackerRow.tsx` (post-T9) — every prop/handler this component now needs to also pass into `TrackerRowKebabMenu`

## WHY THIS APPROACH
Complexity: standard
Justification: Pure composition (no new mutation logic), but requires correctly threading every prop/handler already built across T3-T9 into a second rendering surface, plus a deliberate, easy-to-miss deviation from an existing empty-state-omission precedent.

## SANDWICH CONTEXT
[CRITICAL: The kebab must use a CSS lg:hidden class, not a JS resize listener or matchMedia check — and must render in the DOM whenever at least one field handler is available]
You are implementing Task 10 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: kebab lists all available properties, uses a CSS-only breakpoint, and omits only fields whose handlers are absent
Files in scope: `client/src/components/tracker/TrackerRowKebabMenu.tsx`, `client/src/components/tracker/TrackerRowKebabMenu.test.tsx`, `client/src/components/tracker/TrackerRow.tsx`, `client/src/components/tracker/TrackerRow.test.tsx`
Available after: T9
Architecture rule: CSS-only breakpoint (`lg:hidden`), never a JS-computed viewport boolean; field availability is based only on callback presence
[RESTATE: lg:hidden for viewport, callback presence for field availability]

## DELIVERABLE
Given viewport width is 800px (below lg, above sm/md — not literally testable in jsdom, verified via class presence instead), When the kebab menu opens with all handlers, Then it lists all 6 properties
Given labels or members are empty and their handlers are available, When the kebab opens, Then those entries show the exact empty-state messages rather than being hidden
Given a field handler is absent, When the kebab opens, Then only that field is omitted
Given the date field is active, When the user edits a date and selects another field or clicks in
the portaled date panel, Then the date close/containment contract preserves the draft and commits it
exactly once
[derived] Given TrackerRow renders at any width, When inspected, Then the kebab trigger element is present in the DOM with a lg:hidden class

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `TrackerRowKebabMenu` is pure composition — no `api.updateTrackerItem` calls or mutation-queue logic inside it, only prop pass-through
  - The panel is positioned from its required anchor ref and uses one active-field state
  - The panel has an explicit accessible name, honors the active DatePopover portal as inside, and returns focus to the kebab trigger after close
  - Exact empty-state messages are shown (not omission) for empty labels/members when handlers exist
  - The kebab trigger itself renders only when at least one field handler prop is defined — `TrackerPhaseSection.tsx`'s call site (supplying none) gets no kebab at all, not a non-functional one
  - Tests written BEFORE implementation

Must-not-have:
  - Any JS-based viewport/media-query detection
  - Duplicating the mutation handlers instead of reusing the ones passed as props
  - Modifications to files outside listed scope

Open question risks:
  - None; empty-state copy is fixed so tests are deterministic

Rollback note:
  - New files + one new trigger in TrackerRow; revert removes the kebab entirely, all 6 fields remain inline-only (loses mobile reachability, matches pre-T10 state)

## STOP CONDITIONS
Done when: all 5 DELIVERABLE scenarios pass, commit created
Uncertain when: N/A
Escalate when: a Row-level callback from T4–T9 cannot be passed through unchanged (no `item` argument) — report which task's contract drifted rather than wrapping ad-hoc in the kebab
