# Task T6 — Priority inline edit

**Phase:** 2
**Depends:** T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Priority inline edit [depends: T5]

## OBJECTIVE
Turn the row's priority glyph into a `TrackerPropertyPicker` trigger identical in structure
to the status picker, including the "No priority" sentinel, a no-op guard on re-picking the
current priority, and group auto-uncollapse when grouped by priority.

Files:
- Modify: `client/src/components/tracker/TrackerRow.tsx`
- Modify: `client/src/components/tracker/TrackerSection.tsx`
- Modify: `client/src/pages/TrackerPage.tsx`
- Modify: `client/src/pages/TrackerPage.test.tsx`
- Modify: `client/src/lib/trackerUtils.ts` (shared `NO_PRIORITY` and group-key helpers)
- Modify: `client/src/components/tracker/TrackerProperties.tsx` (consume shared `NO_PRIORITY`)
- Modify: `client/src/components/tracker/TrackerCreateModal.tsx` (consume shared `NO_PRIORITY`)

**Correction from Phase 5 review:** as in T4/T5, `onPriorityChange` threads through
`TrackerSection.tsx` (its Props and its `<TrackerRow ... />` call), not directly from
`TrackerPage.tsx` to `TrackerRow`. Unlike `projects`, the `priorities` prop `TrackerRow`
already requires is unaffected here — only the new `onPriorityChange` handler is added, and it
is OPTIONAL (same scope-boundary reasoning as T4/T5: when absent, the priority glyph stays
read-only, matching `TrackerPhaseSection.tsx`'s current display-only behavior).

The existing `NO_PRIORITY = "none"` sentinel must be exported from the shared tracker utility
module and imported by `TrackerProperties.tsx`, `TrackerCreateModal.tsx`, and this row
implementation. Remove both existing local literals so there is one source of truth for the
sentinel, not a second string literal.

Steps:

1. Before the first red run, extend the same red suite with the priority change, "No priority"
   null branch, current-value no-op, live-state no-op race, grouped-by-priority uncollapse
   (including the `priority:none` destination), and cross-field project→priority queue cases.
   Then write the failing test for: priority picker
   changes priority (Story 3 Example A)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given an item with a priority, When the user clicks the row's priority glyph and selects a different priority, Then `mockUpdateTrackerItem` is called with `{ priorityId: <newId>, version }`
   Exercise through: clicking the row's priority trigger by accessible name and selecting an option
   Test doubles: `mockUpdateTrackerItem`
   Expected RED: today's priority glyph in `TrackerRow.tsx` is a plain `<span>`, not a picker trigger

2. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerPage.test.tsx`

3. Implement minimal code to satisfy the test:
   File: `client/src/components/tracker/TrackerRow.tsx`
   Implement: export the existing `NO_PRIORITY = "none"` sentinel from `trackerUtils.ts` and
   update both `TrackerProperties.tsx` and `TrackerCreateModal.tsx` to import it. Add `onPriorityChange?: (priorityId: number | null) => void`
   to `Props` (OPTIONAL); when defined, replace the priority `<span>` with a
   `TrackerPropertyPicker` trigger whose options use the shared sentinel and whose accessible name
   is `Priority: <name or No priority>` with `data-testid={\`row-inline-priority-${item.key}\`}`; when undefined, keep the current read-only `<span>`;
   extend the "which picker" union to include `"priority"`

   File: `client/src/components/tracker/TrackerSection.tsx`
   Implement: add `onPriorityChange: (item: TrackerItem, priorityId: number | null) => void` to `Props`, pass `onPriorityChange={(priorityId) => onPriorityChange(item, priorityId)}` to `<TrackerRow ... />`

   File: `client/src/pages/TrackerPage.tsx`
   Implement: add `changePriority` using `applyItemPatch` from T5. The builder reads the live
   nullable priority ID inside the queued closure, returns `null` for a current-value no-op, and
   otherwise builds `priorityId` plus the current version. Its optimistic item contains the selected
   vocabulary object or `null`, with a priority-scoped rollback on ordinary failure; wire
   `onPriorityChange` through the `<TrackerSection ... />` call-site

4. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

5. Write regression test for: selecting "No priority" (Story 3 Example A, null branch)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given an item with a priority set, When the user selects "No priority" in the row's picker, Then `mockUpdateTrackerItem` is called with `{ priorityId: null, version }`
   Exercise through: same interaction, selecting the "No priority" option
   Test doubles: `mockUpdateTrackerItem`
   Regression check: the null branch was included in the priority red suite before Step 3; this
   assertion protects the shared sentinel mapping.

6. Run regression test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

7. (If Step 6 fails, fix the shared sentinel mapping and rerun before continuing.)

8. Write regression test for: re-picking current priority is a no-op (Story 3 Example B)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given an item's priority is already "High", When the user clicks "High" again, Then `mockUpdateTrackerItem` is not called
   Exercise through: clicking the row's priority trigger and selecting the already-selected option
   Test doubles: `mockUpdateTrackerItem`
   Regression check: the no-op case was included in the priority red suite before Step 3; this
   confirms the guard still uses the selected nullable value.

9. Run regression test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

10. (If Step 9 fails, fix the no-op guard and rerun before continuing.)

10a. Write regression test for: no-op guard reads live priorityId at execution time, not a
    stale pre-enqueue capture (test-strategy-audit finding — same closure-timing class as
    T5 Step 19a, applied to priority; Steps 1-10 above never have two priority mutations
    for the same item in flight at once, so none of them can distinguish a live guard
    from a stale-capture one)
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration

    Test intent:
    Given item TE-1 has priority="High", version=2, with `mockUpdateTrackerItem`'s first
    call (picking "Low") returning a manually-controlled promise the test resolves explicitly
    When the user picks "Low" in the row's priority picker, then — before that call resolves —
    re-picks "High" (the item's ORIGINAL priority) in the same picker
    Then:
    - The second pick is NOT treated as a no-op (it must not compare against the item's
      pre-mutation priority captured before `enqueue`)
    - Once the first call is manually resolved (returning `priorityId: <Low.id>, version: 3`),
      the second call fires with `{ priorityId: <High.id>, version: 3 }` — a real mutation,
      because the live priority at that point is "Low", not "High"

    Exercise through: clicking the row's priority trigger twice in quick succession, picking
    "Low" then "High", with the mock controlling exact resolution timing (same technique as
    T5 Step 19a / T9 Step 5)

    Test doubles: `mockUpdateTrackerItem` (one manually-controlled promise, one resolved value)

    Regression check: this guards the same closure-timing contract as T5 Step 19a after the
    handler is wired through `applyItemPatch`.

10b. Run test — verify PASS (should already pass given `applyItemPatch`'s closure-timing
    guarantee — verify by running, don't assume):
    `npm run test -- client/src/pages/TrackerPage.test.tsx`

11. Write failing test for: priority change auto-uncollapses destination group when grouped by priority
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration
    Test intent: Given the tracker is grouped by priority and the destination priority group is collapsed, When the user changes an item's priority from the row, Then the destination group is no longer collapsed
    Exercise through: same pattern as T5 Step 22-23, keyed to priority group instead of project group
    Test doubles: `mockUpdateTrackerItem`
    Expected RED: `changePriority` doesn't touch `collapsedKeys` yet

12. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerPage.test.tsx`

13. Implement: extend `changePriority`'s success path to uncollapse the destination priority
    group, mirroring T5 Step 24's logic exactly but for `groupBy === "priority"`; pass the nullable
    selected id through `priorityGroupKey` so selecting "No priority" targets `priority:none`.

14. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

15. Refactor while green: verify `changePriority` calls the existing `uncollapseGroupFor`
    helper created in T5 and passes `priorityGroupKey(priorityId)`. If the T5 helper's typed
    `TrackerGroupBy` contract does not yet accept priority, extend that helper once; do not
    create a second group-uncollapse implementation or repeat `priority:${id}` literals.
    Re-run: `npm run test -- client/src/pages/TrackerPage.test.tsx` — must stay PASS

16. Execute the pre-written regression test for: two different field types on the same item no longer race (Story 6
    Rule 2 Example C — cross-unit scenario, first point where two distinct mutation handlers
    both exist to test against each other)
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration

    Test intent:
    Given item TE-5 has version=4, with `mockUpdateTrackerItem`'s first call (the project
    change) returning a manually-controlled promise the test resolves explicitly, and its
    second call (the priority change) set up to resolve immediately once invoked
    When the user changes the item's project, then immediately changes its priority before the
    project mutation resolves
    Then:
    - The project mutation is sent first, with `version: 4`
    - The priority mutation does NOT fire until the project mutation's controlled promise is
      resolved by the test
    - Once resolved (project mutation settles with `version: 5` in its response), the priority
      mutation fires reading `version: 5`, not the stale `version: 4`
    - Neither mutation receives a 409 in this flow

    Exercise through: clicking the row's project trigger and picking a new project, then
    immediately clicking the row's priority trigger and picking a new priority, before manually
    resolving the first mock call

    Test doubles: `mockUpdateTrackerItem` (one manually-controlled promise, one immediate
    resolution)

    Regression check: this is the exact scenario the shared queue (T1) and per-item live-state
    read (T2, T5's Step 15 fix) were built to solve — if `changeProject` or `changePriority`
    (via `applyItemPatch`) reads `version` from a value captured before `enqueue` rather than
    from `itemsRef.current` inside the queued closure, the priority mutation fires with the
    stale `version: 4` and this test's third assertion fails

17. Run test — verify PASS (this should already pass given T1/T2/T5's closure-timing fixes —
    verify by running, don't assume; if it fails, the bug is in `applyItemPatch` or one of the
    handlers built on it, not in T1's queue module itself):
    `npm run test -- client/src/pages/TrackerPage.test.tsx`

18. Commit:
    `git add client/src/components/tracker/TrackerRow.tsx client/src/components/tracker/TrackerSection.tsx client/src/pages/TrackerPage.tsx client/src/pages/TrackerPage.test.tsx client/src/lib/trackerUtils.ts client/src/components/tracker/TrackerProperties.tsx client/src/components/tracker/TrackerCreateModal.tsx`
    `git commit -m "feat(tracker): add inline priority editing to tracker rows"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 3, full GWT
`client/src/components/tracker/TrackerProperties.tsx:81-95` — `priorityOptions` + `NO_PRIORITY` sentinel pattern reused
`client/src/pages/TrackerPage.tsx` (post-T5) — `applyItemPatch` helper, `changeProject`'s no-op guard and uncollapse pattern as templates

## WHY THIS APPROACH
Complexity: standard
Justification: Reuses `applyItemPatch` (T5) and mirrors `changeStatus`/`changeProject` for its own picker, but this is also the first point where two independently-built mutation handlers (project, priority) coexist — so it's the natural place to add the cross-field race regression test (Step 16-17) that proves the whole shared-queue design actually holds across field types, not just within one field. That extra verification responsibility is why this is standard rather than lightweight.

## SANDWICH CONTEXT
[CRITICAL: Must reuse the applyItemPatch helper from T5 — no third divergent optimistic-update implementation — and the cross-field race test (Step 16) must pass before this task is done]
You are implementing Task 6 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: Option A — changePriority reuses applyItemPatch from T5
Files in scope: `client/src/components/tracker/TrackerRow.tsx`, `client/src/components/tracker/TrackerSection.tsx`, `client/src/pages/TrackerPage.tsx`, `client/src/pages/TrackerPage.test.tsx`, `client/src/lib/trackerUtils.ts`, `client/src/components/tracker/TrackerProperties.tsx`, `client/src/components/tracker/TrackerCreateModal.tsx`
Available after: T5
Architecture rule: reuse applyItemPatch, do not hand-roll a 4th mutation pattern; live-state reads happen inside the enqueued closure
[RESTATE: Reuse applyItemPatch — no new mutation pattern — and prove it with the cross-field race test]

## DELIVERABLE
Given priority picker used, When a new priority or "No priority" selected, Then patch sent accordingly
Given current priority re-picked, When submitted, Then no PATCH sent
Given grouped-by-priority destination collapsed, When priority changed inline, Then destination group auto-uncollapses
Given a project change and a priority change fire in quick succession on the same item, When processed, Then they execute sequentially through the shared queue, each reading the latest settled version — no false 409 between them
Given a priority pick races an in-flight priority mutation for the same item (Step 10a — test-strategy-audit finding), When the second pick's target equals the item's ORIGINAL (pre-mutation) priority, Then it is NOT wrongly treated as a no-op — it fires as a real mutation because the live priority differs by then

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Reuses `applyItemPatch` and `uncollapseGroupFor` helpers, does not duplicate their logic
  - `NO_PRIORITY` has one definition in `trackerUtils.ts`; both existing property consumers import it
  - `priorityGroupKey(null)` targets the existing `priority:none` group and is covered by a direct unit test
  - `onPriorityChange` is OPTIONAL on `TrackerRow`'s Props, threaded through `TrackerSection.tsx`
  - The cross-field race test (Step 16-17) passes, proving no stale-version false-409 between project and priority changes on the same item
  - The priority no-op guard's own race test (Step 10a) passes, proving it reads live priorityId, not a stale capture
  - Tests written BEFORE implementation

Must-not-have:
  - A new/different error-handling shape from status/project/date
  - Making `onPriorityChange` a required prop on `TrackerRow` (breaks `TrackerPhaseSection.tsx`)
  - Modifications to files outside listed scope

Open question risks:
  - None specific

Rollback note:
  - Revert restores plain priority glyph display

## STOP CONDITIONS
Done when: all 5 DELIVERABLE scenarios pass, commit created
Uncertain when: N/A
Escalate when: `applyItemPatch` (T5) doesn't fit priority's shape without modification, or the cross-field race test (Step 16) fails and the root cause traces back to T1's queue module itself — report back rather than patching T1 silently from within this task
