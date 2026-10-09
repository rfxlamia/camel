# Task T4 — Wire date popover into TrackerRow + TrackerPage

**Phase:** 2
**Depends:** T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Wire date popover into TrackerRow + TrackerPage [depends: T3]

## OBJECTIVE
Replace the list-page row's current `<time>` element (showing `createdAt`) with a
`TrackerRowDatePopover` trigger displaying `formatDateRange(item.startDate, item.endDate)`
(or the "Set date" placeholder when null), and wire its `onCommit` through `TrackerPage.tsx`'s
mutation queue to `api.updateTrackerItem`. Preserve the existing `createdAt` `<time>` fallback
when `onDateChange` is absent so the separate read-only phase page remains unchanged.

Files:
- Modify: `client/src/components/tracker/TrackerRow.tsx`
- Modify: `client/src/components/tracker/TrackerSection.tsx`
- Modify: `client/src/pages/TrackerPage.tsx`
- Modify: `client/src/pages/TrackerPage.test.tsx`

**Correction from Phase 5 review:** `TrackerPage.tsx` does not render `TrackerRow` directly — it
renders `TrackerSection` (one call-site in `TrackerPage.tsx`, rendered once per group via
`.map()`), and `TrackerSection.tsx` is what actually instantiates `TrackerRow` (one call-site
in `TrackerSection.tsx`, rendered once per item via `.map()`; currently forwarding only `item`,
`statuses`, `priorities`, `projectLabel`, `onStatusChange`). Every step below that says "wire
into TrackerRow" means: add the prop to `TrackerRow`'s own interface AND thread it through
`TrackerSection.tsx`'s props and its `<TrackerRow ... />` call, then supply it at the one
`<TrackerSection ... />` call-site in `TrackerPage.tsx`.

**Scope boundary (user-confirmed):** `TrackerRow` is also rendered by
`client/src/components/tracker/TrackerPhaseSection.tsx` (used on `TrackerProjectPage.tsx`,
a separate drag-and-drop-enabled page). Inline editing does NOT extend to that page in this
plan — the user explicitly chose list-page-only scope. Every new `TrackerRow` prop this task
(and T5, T6, T9, T10) adds MUST be optional, and `TrackerRow` must render a sensible read-only
fallback when a prop is absent, so `TrackerPhaseSection.tsx` (left untouched, never updated to
pass the new props) keeps compiling and rendering exactly as it does today. For `onDateChange`
specifically: when absent, retain the current plain `<time>` rendering based on `item.createdAt`,
with no popover trigger. The date-range trigger exists only when the list-page handler is passed.

Steps:

1. Write failing test for: setting both dates for the first time from the row (Story 1, full flow)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration

   Test intent:
   Given item TE-4 has startDate=null, endDate=null, version=3, rendered via `render(<TrackerPage />)`
   When the user clicks the row's date trigger (shows "Set date"), sets start=2026-08-06 and end=2026-08-26 via the popover, and closes it
   Then:
   - `mockUpdateTrackerItem` is called once with `{ startDate: "2026-08-06", endDate: "2026-08-26", version: 3 }`
   - After the mocked response resolves, the row displays "6–26 Aug"
   - If the user edits the draft and activates the row's status trigger instead of using the
     explicit close control, the date draft is committed once before the status picker replaces
     it; no draft is silently discarded.

   Exercise through: clicking the row's date trigger by its accessible name, interacting with the popover's date inputs, closing it — same interaction style as the existing status-picker tests in this file

   Test doubles: `mockUpdateTrackerItem` (already mocked)

   Expected RED: `TrackerRow.tsx` still renders `createdAt` in a plain `<time>` element, no date trigger exists to click

2. Run test — verify FAIL:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`
   Expected failure: element not found for the date trigger's accessible name

3. Implement minimal code to satisfy the test:
   File: `client/src/components/tracker/TrackerRow.tsx`
   Implement: extend the shared `OpenPicker` union to include `"date"`; add `onDateChange?: (dates: { startDate: string | null; endDate: string | null }) => void` (OPTIONAL — see scope boundary above) to `TrackerRow`'s Props. When `onDateChange` is defined, render `TrackerRowDatePopover` inside a `pointer-events-auto` wrapper with `triggerLabel={formatDateRange(item.startDate ?? null, item.endDate ?? null) ?? "Set date"}`, `idPrefix={\`tracker-row-inline-${item.key}\`}`, `open={openPicker === "date"}`, and `onCommit={onDateChange}`. Route trigger/open changes through the row's single picker-transition helper rather than setting `openPicker` directly: when date is active and another picker is requested, invoke the DatePopover close contract before replacing the union value so a draft cannot be discarded. The popover component owns the trigger button. Give the date display enough width for the longest required cross-year format (do not retain the current `w-12` constraint; use a documented minimum width/truncation strategy). When `onDateChange` is undefined, retain today's plain `<time>` based on `item.createdAt`, with no popover and no click handler.

   Pass `onOpenChange={(open) => requestPicker(open ? "date" : null)}` (or the equivalent
   transition-helper callback) so the DatePopover can close the shared union through the same
   lifecycle path.

   File: `client/src/components/tracker/TrackerSection.tsx`
   Implement: add `onDateChange: (item: TrackerItem, dates: { startDate: string | null; endDate: string | null }) => void` to `TrackerSection`'s Props, pass `onDateChange={(dates) => onDateChange(item, dates)}` to its `<TrackerRow ... />` call (mirroring how `onStatusChange` is already threaded through this exact file today)

   File: `client/src/pages/TrackerPage.tsx`
   Implement: add `changeDate` through the shared mutation queue and the `applyItemPatch` contract (the helper is introduced in T5; until then, use the same `build(current)` shape locally). Build `{ startDate: dates.startDate, endDate: dates.endDate, version: current.version }`, optimistically update both dates through `updateItems`, replace with the hydrated response on success, apply a field-scoped rollback on ordinary failure, and show the established toast/refetch on `version_conflict`. Pass `onDateChange={(item, dates) => changeDate(item, dates)}` at the `<TrackerSection ... />` call-site.

4. Run test — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

5. Write regression test for: 409 on date save reverts (Story 1 Example G)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given a date change in flight, When `mockUpdateTrackerItem` rejects with a version_conflict ApiError, Then the row's date display reverts to its prior value, a toast reads "Someone else updated this item first — refreshed.", and `loadData` is triggered again (assert `mockListTrackerItems` called again)
   Exercise through: same row date-trigger interaction, with `mockUpdateTrackerItem.mockRejectedValueOnce(new ApiError(...))`
   Test doubles: `mockUpdateTrackerItem`, `mockShowToast`
   Regression check: if Step 3's catch branch doesn't call `loadData()` or `showToast` correctly,
   preserve the assertion and correct the branch before continuing.

6. Run regression test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

7. If Step 6 fails, fix the catch branch in `changeDate` to match the existing `changeStatus`
   409-handling shape exactly, then rerun the regression test.

8. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

9. Write regression test for: popover closed with no changes sends no PATCH, at integration level
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given item TE-4 has startDate=2026-08-06, endDate=2026-08-26, rendered via `render(<TrackerPage />)`, When the user opens the row's date popover and closes it without editing either field, Then `mockUpdateTrackerItem` is never called
   Exercise through: clicking the row's date trigger, then closing the popover with no edits (same close interaction as Step 1, minus the field edits)
   Test doubles: `mockUpdateTrackerItem`
   Regression check: `TrackerRowDatePopover` already owns the no-op behavior; this test verifies
   that the real `TrackerPage` wiring does not add a mutation. If it fails, write the failing
   assertion before changing the wiring.

10. Run test — verify PASS (verify, don't assume — if this fails, `changeDate` or the wiring in
    Step 3 is somehow calling the mutation even when `TrackerRowDatePopover` didn't fire
    `onCommit`, which would be a wiring bug, not a T3 defect):
    `npm run test -- client/src/pages/TrackerPage.test.tsx`

11. Refactor while green: `changeDate` and `changeStatus` now share near-identical
   optimistic-update/409-handling skeletons — per Rule of Three, this is only the 2nd
   occurrence, defer extraction until a 3rd handler repeats it (T5 will trigger this)
   Re-run: `npm run test -- client/src/pages/TrackerPage.test.tsx`

12. Commit:
    `git add client/src/components/tracker/TrackerRow.tsx client/src/components/tracker/TrackerSection.tsx client/src/pages/TrackerPage.tsx client/src/pages/TrackerPage.test.tsx`
    `git commit -m "feat(tracker): wire inline date range editing into tracker rows"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 1 full GWT
`client/src/pages/TrackerPage.tsx` (post-T2) — `changeStatus`'s queue-wired shape as the template
`client/src/components/tracker/TrackerRowDatePopover.tsx` (T3) — consumed as-is

## WHY THIS APPROACH
Complexity: standard
Justification: Wires an already-built, already-tested component into two hub files with a new mutation handler following an established pattern — mechanical but must correctly propagate the queue/ref pattern from T2.

## SANDWICH CONTEXT
[CRITICAL: changeDate must follow the exact same optimistic-update + version-checked + 409-revert-and-toast pattern as changeStatus from T2 — no new error-handling shape]
You are implementing Task 4 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: Option A — changeDate lives in TrackerPage.tsx, uses the same mutationQueueRef/itemsRef from T2
Files in scope: `client/src/components/tracker/TrackerRow.tsx`, `client/src/components/tracker/TrackerSection.tsx`, `client/src/pages/TrackerPage.tsx`, `client/src/pages/TrackerPage.test.tsx`
Available after: T3 (TrackerRowDatePopover, formatDateRange)
Architecture rule: all mutations via api.updateTrackerItem with version; no new endpoint
[RESTATE: changeDate mirrors changeStatus's optimistic/409 pattern exactly]

## DELIVERABLE
Given item has no dates, When the user sets a date range via the row popover, Then one PATCH is sent with both dates + version, and the row updates
Given a date save hits 409, When it occurs, Then the date reverts, a toast shows, and loadData() refetches
Given the popover closed with no changes, When closed, Then no PATCH is sent (verified at the integration level, Step 9-10, not just T3's unit level)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `formatDateRange` (T3) is imported and used for row display, not reimplemented inline
  - Tests written BEFORE implementation
  - `onDateChange` wired through the `TrackerSection` render call-site in `TrackerPage.tsx`, which forwards it into `TrackerRow` inside `TrackerSection.tsx`
  - `onDateChange` is OPTIONAL on `TrackerRow`'s Props — `TrackerPhaseSection.tsx` (out of scope, unmodified) must keep compiling and rendering a plain-text date fallback
  - Switching from an edited date picker to another row picker invokes the date close contract
    before replacing the shared `OpenPicker` value
  - The editable date column can display the longest specified cross-year format without clipping
    its only visible value or relying on the old `w-12` width

Must-not-have:
  - A second, divergent 409-handling implementation — must match `changeStatus`'s shape
  - Modifications to files outside listed scope
  - Making `onDateChange` a required prop on `TrackerRow` (breaks `TrackerPhaseSection.tsx`)

Open question risks:
  - None specific

Rollback note:
  - Revert restores the plain `createdAt` `<time>` display

## STOP CONDITIONS
Done when: all 3 DELIVERABLE scenarios pass, commit created
Uncertain when: N/A
Escalate when: TrackerRowDatePopover (T3) needs behavior changes to make this pass — report back, don't silently diverge from T3's tested contract
