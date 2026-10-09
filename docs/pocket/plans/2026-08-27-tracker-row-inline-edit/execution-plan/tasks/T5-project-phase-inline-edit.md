# Task T5 — Project/phase inline edit

**Phase:** 2
**Depends:** T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Project/phase inline edit [depends: T4]

## OBJECTIVE
Make the project chip always render in the row (including when grouped by project or when
the item has no project — "Set project" placeholder), add a new phase chip element (also
always rendered, "Set phase" placeholder), wire both to pickers through the mutation queue
with a no-op guard on re-picking the current project, and extend group auto-uncollapse to
project changes when grouped by project.

Files:
- Modify: `client/src/components/tracker/TrackerRow.tsx`
- Modify: `client/src/components/tracker/TrackerSection.tsx`
- Modify: `client/src/pages/TrackerPage.tsx`
- Modify: `client/src/pages/TrackerPage.test.tsx`
- Modify: `client/src/lib/trackerUtils.ts`
- Modify: `client/src/lib/trackerUtils.test.ts` (numeric and `null` group-key contracts)

**Correction from Phase 5 review:** the project-chip suppression this task removes
(Story 2 Example B) does NOT live in `TrackerRow.tsx` — it lives in `TrackerSection.tsx`,
which today computes `projectLabel={showProjectChip && item.projectId != null ? projectNames.get(item.projectId) : null}`
before ever calling `TrackerRow`. Fixing Example B means removing `showProjectChip`'s use as a
suppression flag in `TrackerSection.tsx` (its `Props` field and the ternary), not touching
suppression logic inside `TrackerRow.tsx` (which never had any — `TrackerRow.tsx` just renders
whatever `projectLabel` it's given). `TrackerPage.tsx` passes `showProjectChip` into
`TrackerSection` today; that prop can be removed from `TrackerSection`'s call-site in
`TrackerPage.tsx` too, once nothing in `TrackerSection.tsx` reads it. As in T4, `TrackerRow`
does not receive props directly from `TrackerPage.tsx` — everything routes through
`TrackerSection.tsx`.

**Scope boundary (user-confirmed, same as T4):** `projects`, `onProjectChange`, and
`onPhaseChange` are all OPTIONAL on `TrackerRow`'s Props. When `projects` is undefined, the
project and phase chips render nothing at all (not a placeholder) — this exactly matches
`TrackerPhaseSection.tsx`'s current behavior (it shows no project/phase indicator on its rows
today), which stays unmodified and out of scope.

Steps:

1. Before the first red run, update the existing project-chip assertions as a fixture/contract
   migration: the loose-item test expects the new `Set project` trigger, the grouped-by-project
   test expects the trigger to remain present, and the project-deletion test keeps its
   row-preservation assertion while checking the new trigger contract. Then write the failing
   test for: project chip renders as placeholder when item has no project (Story 2 Example A).
   In the same pre-implementation red suite, add direct `trackerUtils.test.ts` cases for numeric
   and `null` `projectGroupKey`/`priorityGroupKey` inputs; these helper tests must exist before
   Step 24 implements the exports.
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration

   Test intent:
   Given an item with no `projectId`, rendered via `render(<TrackerPage />)`
   When the row renders
   Then a clickable "Set project" element is present in that row (query by accessible name/role)

   Exercise through: rendering the tracker list and querying the row for the project trigger

   Test doubles: none beyond existing mocks

   Expected RED: today's `TrackerRow.tsx` only renders the project chip when `projectLabel` is truthy (`{projectLabel && (...)}`) — omits it entirely when there's no project

2. Run test — verify FAIL:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

3. Implement minimal code to satisfy the test:
   File: `client/src/components/tracker/TrackerRow.tsx`
   Implement: replace the `projectLabel?: string | null` prop with `projects?: TrackerProject[]` (OPTIONAL full list, mirroring `TrackerDetailPage.tsx`'s `projects` state shape); when `projects` is defined, derive `const selectedProject = projects.find((p) => p.id === item.projectId)` and render a `TrackerPropertyPicker` trigger showing `selectedProject?.name ?? "Set project"`, options built from `projects` the same way `TrackerDetailPage.tsx`'s `projectOptions` are built, with `aria-label={\`Project: ${selectedProject?.name ?? "Set project"}\`}` and `data-testid={\`row-inline-project-${item.key}\`}`; when `projects` is undefined, render nothing for the project chip (matches today's `TrackerPhaseSection.tsx` behavior); extend the "which picker" union type to include `"project"`

   File: `client/src/components/tracker/TrackerSection.tsx`
   Implement: remove the `showProjectChip: boolean` field from `Props` and the `projectLabel={showProjectChip && item.projectId != null ? ... : null}` computation; add `projects: TrackerProject[]` to `Props` and pass `projects={projects}` straight through to `<TrackerRow ... />` unconditionally (no groupBy-based suppression)

   File: `client/src/pages/TrackerPage.tsx`
   Implement: update the `<TrackerSection ... />` call-site to pass `projects={projects}` instead of `showProjectChip`/computing `projectNames` for suppression purposes (the existing `projectNames` Map may still be needed elsewhere in this file — only remove its use as a suppression input to `TrackerSection`, verify before deleting the Map itself)

4. Run test — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

5. Write regression test for: project chip still shows when grouped by project (Story 2 Example B)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given the tracker view is grouped by project (existing `groupBy` control set to "project"), When a row renders, Then its project trigger is still present (not omitted as redundant with the group header)
   Exercise through: switching the group-by control (existing test helper/interaction already used by `"regroups by project without losing or duplicating an item"` at line 617), then querying the row for its project trigger
   Test doubles: none
   Regression check: this confirms the suppression removal survives the Page → Section → Row
   path. If it fails, write the failing assertion before correcting the wiring.

6. Run regression test — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

7. If the regression fails, remove any remaining suppression left in `TrackerSection.tsx` or
   its call-site in `TrackerPage.tsx` before proceeding; Step 8 is the required rerun.

8. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

9. Write failing test for: phase chip renders, placeholder when unset (Story 2 Example C)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given an item with a project but no phase, When the row renders, Then a clickable "Set phase" element is present
   Exercise through: rendering and querying the row
   Test doubles: none
   Expected RED: `TrackerRow.tsx` has no phase element at all today

10. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerPage.test.tsx`

11. Implement: derive `const selectedPhase = selectedProject?.phases.find((p) => p.id === item.phaseId)` (only reachable when `projects` is defined, per Step 3); add a phase `TrackerPropertyPicker` trigger to `TrackerRow.tsx` showing `selectedPhase?.name ?? "Set phase"`, options from `selectedProject?.phases ?? []` (empty state when zero phases — Story 2 Example F), rendered only when `projects` is defined (same optional-prop gating as the project chip), with `aria-label={\`Phase: ${selectedPhase?.name ?? "Set phase"}\`}` and `data-testid={\`row-inline-phase-${item.key}\`}`; add `onPhaseChange?: (phaseId: number) => void` to `TrackerRow`'s Props (OPTIONAL, same scope-boundary reasoning); extend the "which picker" union to include `"phase"`; thread `onPhaseChange` through `TrackerSection.tsx`'s Props and its `<TrackerRow ... />` call, same pattern as `onDateChange` in T4

12. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

12a. Write the phase mutation/no-op cases into the red suite before implementing the handler:
     selecting a phase sends the current project and phase in one PATCH, and re-picking the
     current phase sends no PATCH.
     Test file: `client/src/pages/TrackerPage.test.tsx`
     Level: integration
     Test intent: Given item TE-3 has `projectId=P1`, `phaseId=null`, and `version=2`, When the
     user selects `Ph1` in the phase picker, Then exactly one update is sent with
     `{ projectId: P1, phaseId: Ph1, version: 2 }`, and the phase trigger shows `Ph1`.
     The same pre-implementation red suite also covers re-picking the current `Ph1`: no PATCH
     is sent and the phase remains unchanged.
     Test doubles: `mockUpdateTrackerItem`
     Expected RED: the row has no phase mutation path yet.

12b. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerPage.test.tsx`

12c. Implement `changePhase(item, phaseId)` in `TrackerPage.tsx`. Enqueue by item id, read the
     live item inside the async closure, return without a request when `current.phaseId === phaseId`,
     and otherwise build `{ projectId: current.projectId ?? null, phaseId, version: current.version }`.
     Apply the optimistic phase through `updateItems`, replace it with the hydrated response, apply
     a phase-scoped rollback on ordinary failure, and use the established 409 toast/refetch behavior.
     Thread the handler through Page → Section → Row. Do not wire a kebab surface here — that is T10.

12d. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

13. Write failing test for: changing project sends one combined patch and resets phase (Story 2 Example D)
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration
    Test intent: Given item TE-3 has projectId=P1, phaseId=Ph1, version=2, When the user picks P2 in the row's project picker, Then `mockUpdateTrackerItem` is called once with `{ projectId: P2, phaseId: null, version: 2 }` (single call, not two), and the row's phase chip immediately shows "Set phase"
    Exercise through: clicking the row's project trigger and selecting a different project
    Test doubles: `mockUpdateTrackerItem`
    Expected RED: no `changeProject` handler exists yet

14. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerPage.test.tsx`

15. Implement: add `changeProject(item, projectId)` using the same live-state/queue contract as
    `changePhase`. Return without a request when `current.projectId === projectId`; otherwise send
    exactly one `{ projectId, phaseId: null, version: current.version }` request and optimistically
    clear `phaseId`, with a project/phase-scoped rollback on ordinary failure. Add
    `onProjectChange?: (projectId: number) => void` to `TrackerRow`'s Props, thread it through
    `TrackerSection.tsx`, and supply it at the Page call-site.

16. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

17. Write regression test for: re-picking the current project is a no-op (Story 2 Example E)
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration
    Test intent: Given item TE-3 has projectId=P1 and phaseId=Ph1, When the user re-picks P1
    (already selected) in the row's project picker, Then `mockUpdateTrackerItem` is never called
    and the phase remains Ph1.
    Exercise through: clicking the row's project trigger and selecting the already-selected option
    Test doubles: `mockUpdateTrackerItem`
    Regression check: the no-op case was included in the project mutation red suite before
    Step 15; this separate assertion protects it after subsequent wiring/refactors.

18. Run regression test — verify PASS:
    `npm run test -- client/src/pages/TrackerPage.test.tsx`

19. (If Step 18 fails, fix the guard and rerun the regression test before continuing.)

19a. Write regression test for: no-op guard reads live projectId at execution time, not a
    stale pre-enqueue capture (test-strategy-audit finding — Steps 13-18 above only ever
    have one project mutation in flight at a time, so none of them can distinguish a
    correctly-live guard from one that captured `projectId` before calling `enqueue`)
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration

    Test intent:
    Given item TE-3 has projectId=P1, version=2, with `mockUpdateTrackerItem`'s first call
    (picking P2) returning a manually-controlled promise the test resolves explicitly
    When the user picks P2 in the row's project picker, then — before that first call
    resolves — re-picks P1 (the item's ORIGINAL project) in the same picker
    Then:
    - The second pick is NOT silently treated as a no-op (it must not compare against the
      item's pre-mutation `projectId=P1` captured before `enqueue`, which would look like
      "re-picking the current project" and wrongly skip the call)
    - Once the first call is manually resolved (returning `projectId: P2, phaseId: null,
      version: 3`), the second call fires with `{ projectId: P1, phaseId: null, version: 3 }`
      — a real mutation, because the item's LIVE project at that point is P2, not P1

    Exercise through: clicking the row's project trigger twice in quick succession, picking
    P2 then P1, with the mock controlling exact resolution timing (same technique as T9
    Step 5)

    Test doubles: `mockUpdateTrackerItem` (one manually-controlled promise, one resolved value)

    Regression check: if Step 15's no-op guard captures `current.projectId` from a value read
    before `enqueue` is called (rather than inside the enqueued closure), it would compare
    the second pick (P1) against the ORIGINAL pre-mutation projectId (P1) and wrongly treat
    it as a no-op, skipping the second `mockUpdateTrackerItem` call entirely.

19b. Run test — verify PASS (this should already pass given Step 15's closure-timing fix —
    verify by running, don't assume; if it fails, the guard is reading a captured value
    instead of `itemsRef.current` inside the closure):
    `npm run test -- client/src/pages/TrackerPage.test.tsx`

20a. Write regression test for: re-picking the current phase is a no-op (Story 2 Example C)
     Test file: `client/src/pages/TrackerPage.test.tsx`
     Level: integration
     Test intent: Given item TE-3 has project P1 and phase Ph1, When the user re-picks Ph1,
     Then no PATCH is sent and the phase remains unchanged.
     Regression check: the phase no-op assertion was included with the pre-implementation phase
     mutation cases in Step 12a; this confirms it remains intact.

20b. Run regression test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

20c. If the regression fails, fix the live phase no-op guard and rerun the test until PASS.

21. Write regression test for: zero-phase project shows empty state (Story 2 Example F)
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration
    Test intent: Given a project with zero phases is selected on an item, When the row's phase picker is opened, Then the listbox shows the existing `TrackerPropertyPicker` empty copy `No matches` and no `role="option"` entries. Do not add a second empty-state implementation or change `TrackerPropertyPicker`.
    Exercise through: opening the row's phase picker and querying the listbox
    Test doubles: none
    Regression check: `TrackerPropertyPicker.tsx` already renders `No matches` when `filtered.length === 0` (including `options=[]`). This assertion locks that existing copy.

21a. Run test — verify PASS:
    `npm run test -- client/src/pages/TrackerPage.test.tsx`

22. Write failing test for: project change auto-uncollapses destination group when grouped by project (Story 2, final scenario)
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration
    Test intent: Given the tracker is grouped by project, and the group for P2 is currently collapsed (use the existing collapse-toggle interaction this file already tests elsewhere), When the user changes an item's project from P1 to P2 via the row, Then P2's group is no longer collapsed after the change resolves
    Exercise through: collapsing P2's group first, then performing the project change, then querying whether P2's group content is visible
    Test doubles: `mockUpdateTrackerItem`
    Expected RED: `changeProject`'s current implementation (from Step 15) doesn't touch `collapsedKeys` at all

23. Run test — verify FAIL: `npm run test -- client/src/pages/TrackerPage.test.tsx`

23a. Run the helper test — verify FAIL:
     `npm run test -- client/src/lib/trackerUtils.test.ts`
     Expected failure: the group-key exports do not exist yet.

24. Implement: first add/export `projectGroupKey(projectId: number | null)` and
    `priorityGroupKey(priorityId: number | null)` beside `statusGroupKey` in `trackerUtils.ts`.
    Each helper must return the existing `project:none`/`priority:none` key for `null` and the
    numeric key otherwise. Use them in both the corresponding group builders and auto-uncollapse
    paths instead of repeating key literals. The direct unit assertions from Step 1 must pass
    before relying on the helpers in page integration tests. Then extend `changeProject`'s
    success branch to call `setCollapsedKeys` the same way `changeStatus` already does for status
    groups, keyed to `projectGroupKey(projectId)` and guarded by `groupBy === "project"`.

25. Run both focused suites — verify PASS:
    `npm run test -- client/src/lib/trackerUtils.test.ts`
    `npm run test -- client/src/pages/TrackerPage.test.tsx`

26. Refactor while green: `changeStatus`, `changeDate`, `changeProject`, and `changePhase` now
    share the optimistic-update/409-revert skeleton. Extract the typed private helper
    `applyItemPatch(itemId, build, errorMessage)` inside `TrackerPage.tsx` (not a new file).
    `build(current)` must execute inside the queue and return either `null` for a live no-op or
    `{ request, optimistic, rollback }`; `request` includes the current version,
    `optimistic` returns a complete `TrackerItem`, and `rollback(latest)` restores only the fields
    changed by this operation while preserving unrelated SSE/refetch fields. The helper calls
    `updateItems` for optimistic, success, and immediate failure-revert transitions, and calls
    `loadData()` additionally for `version_conflict`. Mark the item as recovery-blocked before
    refetching; release that
    block only when `loadData()` returns `true`, otherwise skip the remaining queued tail. Refactor
    all four handlers to use it without moving any live-state read outside the queued closure.
    Re-run: `npm run test -- client/src/pages/TrackerPage.test.tsx` — must stay PASS

27. Commit:
    `git add client/src/components/tracker/TrackerRow.tsx client/src/components/tracker/TrackerSection.tsx client/src/pages/TrackerPage.tsx client/src/pages/TrackerPage.test.tsx client/src/lib/trackerUtils.ts client/src/lib/trackerUtils.test.ts`
    `git commit -m "feat(tracker): add inline project and phase editing to tracker rows"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 2, full GWT
`client/src/pages/TrackerDetailPage.tsx:403-410` — `selectedProject`/`selectedPhase`/`projectOptions`/`phaseOptions` derivation pattern reused
`client/src/pages/TrackerPage.tsx` (post-T4) — `changeDate` as the handler skeleton template
`client/src/components/tracker/TrackerSection.tsx` — `showProjectChip`/`projectLabel` suppression logic being removed here, not in `TrackerRow.tsx`

## WHY THIS APPROACH
Complexity: standard
Justification: Changes `TrackerRow`'s prop contract (`projectLabel` → `projects`), adds a brand-new row element (phase) that didn't exist, and introduces the first no-op guard + group-auto-uncollapse extension beyond status — enough surface area and judgment (empty-state handling, guard placement) to be standard rather than lightweight.

## SANDWICH CONTEXT
[CRITICAL: Project change must always send projectId and phaseId together in one PATCH call — never two separate calls — except when the no-op guard skips the call entirely]
You are implementing Task 5 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: Option A — changeProject lives in TrackerPage.tsx, reuses mutationQueueRef/itemsRef from T2
Files in scope: `client/src/components/tracker/TrackerRow.tsx`, `client/src/components/tracker/TrackerSection.tsx`, `client/src/pages/TrackerPage.tsx`, `client/src/pages/TrackerPage.test.tsx`, `client/src/lib/trackerUtils.ts`, `client/src/lib/trackerUtils.test.ts`
Available after: T4
Architecture rule: single combined PATCH for project+phase reset; no separate calls; the no-op guard's live-state read (current.projectId) must happen inside the enqueued closure, not before enqueue is called
[RESTATE: One PATCH with both projectId and phaseId, never two calls — and the no-op guard reads live state inside the closure]

## DELIVERABLE
Given item has no project, When row renders, Then shows "Set project" placeholder, clickable
Given grouped-by-project view, When row renders, Then project trigger still shows
Given item has no phase, When row renders, Then shows "Set phase" placeholder, clickable
Given item has a project and a phase, When a different phase is selected, Then one PATCH sends the current project, the new phase, and the current version
Given current phase is re-picked, When submitted, Then no PATCH is sent and the phase remains unchanged
Given project changed to a different project, When submitted, Then single PATCH { projectId, phaseId: null, version }
Given project re-picked as the same current project, When submitted, Then no PATCH sent
Given selected project has zero phases, When phase picker opened, Then the listbox shows `No matches` and no selectable options
Given grouped-by-project view and destination group collapsed, When project changed inline, Then destination group auto-uncollapses
Given a project pick races an in-flight project mutation for the same item (Step 19a — test-strategy-audit finding), When the second pick's target equals the item's ORIGINAL (pre-mutation) project, Then it is NOT wrongly treated as a no-op — it fires as a real mutation because the live project differs by then

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `TrackerRow`'s `projects` prop fully replaces `projectLabel` — no dual/legacy prop left behind
  - `projects`, `onProjectChange`, `onPhaseChange` are OPTIONAL on `TrackerRow`'s Props — `TrackerPhaseSection.tsx` (unmodified, out of scope) must keep compiling with no project/phase chips rendered
  - `changePhase` reads `current.phaseId` and `current.projectId` inside the queued closure and uses the shared optimistic/409 helper
  - `applyItemPatch` requires field-scoped rollback and never restores a whole stale `TrackerItem` snapshot
  - The `showProjectChip`/`projectLabel` suppression is removed from `TrackerSection.tsx`, not (re)implemented in `TrackerRow.tsx`
  - No-op guard reads `current.projectId` INSIDE the enqueued closure (Step 15), not from a value captured before `enqueue` is called — proven by Step 19a's race test, not just by inspection
  - `projectGroupKey` and `priorityGroupKey` are shared helpers; group construction and auto-uncollapse do not repeat key literals
  - Both group-key helpers map `null` to the existing loose-group keys and have direct unit coverage
  - Tests written BEFORE implementation

Must-not-have:
  - Two separate PATCH calls for a project change (must be one combined call)
  - Making `projects`/`onProjectChange`/`onPhaseChange` required props on `TrackerRow` (breaks `TrackerPhaseSection.tsx`)
  - Modifications to files outside listed scope

Open question risks:
  - None specific

Rollback note:
  - Revert restores `projectLabel`-based conditional chip and removes the phase element entirely

## STOP CONDITIONS
Done when: all 10 DELIVERABLE scenarios pass, commit created
Uncertain when: N/A
Escalate when: Step 21's `No matches` assertion fails because `TrackerPropertyPicker` no longer treats empty `options` as an empty filtered list — report back; do not add a second empty-state UI in the row
