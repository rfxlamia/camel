# Task T3 — Build TrackerRowDatePopover + formatDateRange helper

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Build TrackerRowDatePopover + formatDateRange helper [depends: T1]

## OBJECTIVE
Build a standalone, controlled date-range popover component (reusing `TrackerDateFields` and
`client/src/lib/popoverPlacement.ts`'s positioning primitives, mirroring how
`TrackerPropertyPicker` already uses them) and a pure date-range formatting helper. Both are
built and tested in isolation, with no wiring into `TrackerRow.tsx` or `TrackerPage.tsx` yet —
that wiring is T4.

Files:
- Create: `client/src/components/tracker/TrackerRowDatePopover.tsx`
- Test: `client/src/components/tracker/TrackerRowDatePopover.test.tsx`
- Modify: `client/src/lib/trackerUtils.ts`
- Modify: `client/src/lib/trackerUtils.test.ts`

Steps:

1. Write failing test for: formatDateRange — equal dates (Story 1 Rule 2 Example B)
   Test file: `client/src/lib/trackerUtils.test.ts`
   Level: unit

   Test intent:
   Given startDate="2026-08-06" and endDate="2026-08-06"
   When `formatDateRange(startDate, endDate)` is called
   Then it returns "6 Aug"

   Exercise through: the exported `formatDateRange` function directly

   Test doubles: none — pure function

   Expected RED: `formatDateRange` does not exist yet in `trackerUtils.ts`

2. Run test — verify FAIL:
   `npm run test -- client/src/lib/trackerUtils.test.ts`
   Expected failure: `formatDateRange is not a function` / import error

3. Implement minimal code to satisfy the test:
   File: `client/src/lib/trackerUtils.ts`
   Implement: `export function formatDateRange(startDate: string | null, endDate: string | null): string | null` with a private date-only formatter that parses the `YYYY-MM-DD` components and uses the fixed English month table `Jan`…`Dec`. Never call `new Date(iso)` or `toLocaleDateString`; the output must be locale- and timezone-independent. Return `null` when both are `null` (the caller renders the "Set date" placeholder, not this helper). If both dates are present but `startDate > endDate`, return `null` and let the caller reject the invalid range without sending a PATCH.

4. Run test — verify PASS:
   `npm run test -- client/src/lib/trackerUtils.test.ts`
   Expected: PASS

5. Write failing test for: formatDateRange — differing dates, same month (Example C)
   Test file: `client/src/lib/trackerUtils.test.ts`
   Level: unit
   Test intent: Given startDate="2026-08-06", endDate="2026-08-26", When formatDateRange is called, Then it returns "6–26 Aug"
   Exercise through: `formatDateRange` directly
   Test doubles: none
   Expected RED: current minimal implementation from Step 3 only handles the equal-date case, has no range branch

6. Run test — verify FAIL: `npm run test -- client/src/lib/trackerUtils.test.ts`

7. Implement: extend `formatDateRange` with a differing-dates branch, formatting as `"D–D Mon"` when month and year match

8. Run test — verify PASS: `npm run test -- client/src/lib/trackerUtils.test.ts`

9. Write failing test for: formatDateRange — differing months (Example E) and differing years (Example F)
   Test file: `client/src/lib/trackerUtils.test.ts`
   Level: unit
   Test intent:
   - Given startDate="2026-08-28", endDate="2026-09-03", Then returns "28 Aug–3 Sep"
   - Given startDate="2026-12-30", endDate="2027-01-03", Then returns "30 Dec 2026–3 Jan 2027"
   Exercise through: `formatDateRange` directly
   Test doubles: none
   Expected RED: Step 7's branch assumes same month/year, does not append month on the start side when they differ, and never appends year

10. Run test — verify FAIL: `npm run test -- client/src/lib/trackerUtils.test.ts`

11. Implement: extend the differing-dates branch to include month abbreviation on both sides
    whenever months differ, and year on both sides whenever years differ

12. Run test — verify PASS: `npm run test -- client/src/lib/trackerUtils.test.ts`

13. Write failing test for: formatDateRange — only one date set (Example G), neither set (Example H),
    and an invalid reversed range
    Test file: `client/src/lib/trackerUtils.test.ts`
    Level: unit
    Test intent:
    - Given startDate="2026-08-06", endDate=null, Then returns "6 Aug" (the single set date)
    - Given startDate=null, endDate="2026-08-26", Then returns "26 Aug" (the single set date)
    - Given startDate=null, endDate=null, Then returns null
    - Given startDate="2026-08-26", endDate="2026-08-06", Then returns null
    Exercise through: `formatDateRange` directly
    Test doubles: none
    Expected RED: current implementation does not handle a null side

14. Run test — verify FAIL: `npm run test -- client/src/lib/trackerUtils.test.ts`

15. Implement: add branches for exactly-one-set (format that single date), neither-set (return
    null), and reversed ranges (return null)

16. Run test — verify PASS: `npm run test -- client/src/lib/trackerUtils.test.ts`

17. Refactor while green: if the branching logic exceeds ~30 lines in one function, extract a
    small private helper for "format one date" reused by both the single-date and range
    branches (Rule of Three: the single-date format string appears 3 times — equal-dates,
    one-set, and each side of a range)
    Re-run: `npm run test -- client/src/lib/trackerUtils.test.ts` — must stay PASS

18. Commit:
    `git add client/src/lib/trackerUtils.ts client/src/lib/trackerUtils.test.ts`
    `git commit -m "feat(tracker): add formatDateRange helper for row date display"`

19. Write failing test for: TrackerRowDatePopover — opens pre-filled with current values
    Test file: `client/src/components/tracker/TrackerRowDatePopover.test.tsx`
    Level: unit

    Test intent:
    Given a `TrackerRowDatePopover` rendered with `startDate="2026-08-06"`, `endDate="2026-08-26"`, `open={true}`
    When it renders
    Then the underlying `TrackerDateFields` inputs show those pre-filled values

    Exercise through: render `<TrackerRowDatePopover startDate={...} endDate={...} triggerLabel="6–26 Aug" idPrefix="tracker-row-inline-CA-1" open={true} onOpenChange={vi.fn()} onCommit={vi.fn()} />` and query the date inputs by their existing accessible labels/roles. The test must also provide a mounted trigger anchor, as the component positions its portal from its own trigger ref.

    Test doubles:
    - `onOpenChange`, `onCommit` as `vi.fn()` — do NOT mock `TrackerDateFields` or the popover positioning module, render them for real

    Expected RED: `TrackerRowDatePopover.tsx` does not exist yet

20. Run test — verify FAIL:
    `npm run test -- client/src/components/tracker/TrackerRowDatePopover.test.tsx`
    Expected failure: module not found

21. Implement minimal code to satisfy the prefill test only:
    File: `client/src/components/tracker/TrackerRowDatePopover.tsx`
    Implement: a controlled component with props `{ startDate: string | null; endDate: string | null; triggerLabel: string; idPrefix: string; open: boolean; onOpenChange: (open: boolean) => void; onCommit: (dates: { startDate: string | null; endDate: string | null }) => void }`. Render the visible trigger button (`aria-label={\`Date: ${triggerLabel}\`}`, `data-testid={\`row-date-${idPrefix}\`}`) and use its ref as the portal anchor. Keep draft state as `string` (not `string | null`): on opening, initialize `draftStart`/`draftEnd` with `startDate ?? ""` and `endDate ?? ""` because `TrackerDateFields` requires `startDate: string` and `endDate: string`. Render `TrackerDateFields` with `layout="rail"`, those string drafts, and the supplied `idPrefix` in a portal positioned via `computePopoverPosition`/`POPOVER_WIDTH`, plus an accessible `Close date picker` button. This first implementation only satisfies the prefill/rendering contract; do not implement commit-on-close or validation yet, so the close button is intentionally not functional until Step 25.

22. Run test — verify PASS:
    `npm run test -- client/src/components/tracker/TrackerRowDatePopover.test.tsx`

23. Write the complete failing close-behavior suite: closing with changes commits both fields
    together (Story 1 Rule 1 Example B), and a controlled parent close commits before the panel
    disappears.
    Test file: `client/src/components/tracker/TrackerRowDatePopover.test.tsx`
    Level: unit

    Test intent:
    Given the popover is open with startDate=null, endDate=null
    When the user sets only the start date field to "2026-08-06" and then clicks the explicit close button in the popover
    Then `onCommit` is called exactly once with `{ startDate: "2026-08-06", endDate: null }` — both keys present in one call

    Exercise through: firing a change event on the start-date input, then clicking the popover's `Close date picker` button. Add companion cases in the same red suite that close through the trigger toggle, a document-level outside `pointerdown`, `Escape`, and a rerender from `open={true}` to `open={false}`; each path must use the same close function and produce the same commit/no-op behavior. The controlled-close case must assert that `onCommit` fires once before the panel is removed.

    Test doubles: `onCommit` as `vi.fn()`

    Expected RED: Step 21's minimal implementation renders the close control but does not yet
    call `onCommit` on any close path.

24. Run test — verify FAIL:
    `npm run test -- client/src/components/tracker/TrackerRowDatePopover.test.tsx`

25. Implement: wire the explicit close button, outside pointer-down, Escape, trigger toggle, and
    the controlled `open=true` → `open=false` transition to one idempotent `close()` handler. It
    validates the range first, then calls `onCommit({ startDate: draftStart || null, endDate: draftEnd || null })`
    only when either draft differs from its prop (see Step 27 below), and finally calls
    `onOpenChange(false)` for internal close requests. The controlled transition must commit once
    before the closed panel is removed without recursively calling the parent setter. An invalid
    non-empty range stays open, shows `End date must be on or after start date`, and does not
    commit. Mark the portal root with an item/surface-keyed attribute or expose an equivalent
    containment signal so a parent kebab outside-click handler can treat the active date portal as
    inside. A parent that switches or unmounts the date child must invoke this same close contract
    before removing it.

26. Run test — verify PASS:
    `npm run test -- client/src/components/tracker/TrackerRowDatePopover.test.tsx`

27. Write regression test for: closing with no changes does not commit (Story 1, no-op guard)
    Test file: `client/src/components/tracker/TrackerRowDatePopover.test.tsx`
    Level: unit
    Test intent: Given the popover is open with startDate="2026-08-06", endDate="2026-08-26", When the user closes the popover without editing either field, Then `onCommit` is never called
    Exercise through: clicking `Close date picker` with no prior field edits
    Test doubles: `onCommit` as `vi.fn()`
    Regression check: if Step 25's guard condition is missing or inverted, this fails; preserve
    the assertion and fix the guard before continuing.

28. Run regression test — verify PASS:
    `npm run test -- client/src/components/tracker/TrackerRowDatePopover.test.tsx`

29. Write regression test for: invalid date range stays open without committing
    Test file: `client/src/components/tracker/TrackerRowDatePopover.test.tsx`
    Level: unit
    Test intent: Given startDate="2026-08-26" and endDate="2026-08-06", When the user clicks `Close date picker`, Then `onCommit` is not called, `onOpenChange(false)` is not called, and the validation message is visible.
    Regression check: Step 25 defines the validation branch; this test locks its behavior.

30. Run regression test — verify PASS:
    `npm run test -- client/src/components/tracker/TrackerRowDatePopover.test.tsx`

31. If the regression fails, fix the ordered-range validation while keeping the single close
    path, then run the focused test until PASS.

32. Refactor while green: if this file exceeds ~150 lines, extract only the close/commit
    decision into a small local helper; do not add a generic popover abstraction.
    Re-run: `npm run test -- client/src/components/tracker/TrackerRowDatePopover.test.tsx`

33. Commit:
    `git add client/src/components/tracker/TrackerRowDatePopover.tsx client/src/components/tracker/TrackerRowDatePopover.test.tsx`
    `git commit -m "feat(tracker): add standalone date range popover component"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 1, all rules and examples
`client/src/components/tracker/TrackerDateFields.tsx` — reused as-is, `layout="rail"` prop
`client/src/components/tracker/TrackerPropertyPicker.tsx:1-16` — `createPortal` + `computePopoverPosition`/`POPOVER_WIDTH` pattern this component mirrors
`client/src/lib/popoverPlacement.ts` — positioning primitives reused directly

## WHY THIS APPROACH
Complexity: standard
Justification: A new component with real branching logic (draft state, commit-on-close, no-op guard,
controlled close, and portal containment) plus a pure formatting function with several distinct
formatting/validation branches — enough judgment involved (date math for cross-month/cross-year
formatting) to warrant standard rather than lightweight, but fully self-contained and testable
without touching either of the two shared hub files (`TrackerRow.tsx`, `TrackerPage.tsx`), which is
exactly why it's split from T4.

## SANDWICH CONTEXT
[CRITICAL: This component must not import from or modify TrackerRow.tsx or TrackerPage.tsx — it is built and tested fully standalone, wiring happens in T4]
You are implementing Task 3 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: reuse `TrackerDateFields` + `popoverPlacement.ts`, mirroring `TrackerPropertyPicker`'s existing portal pattern
Files in scope: `client/src/components/tracker/TrackerRowDatePopover.tsx`, `client/src/components/tracker/TrackerRowDatePopover.test.tsx`, `client/src/lib/trackerUtils.ts`, `client/src/lib/trackerUtils.test.ts`
Available after: T1 (`createItemMutationQueue` is unrelated; this task shares no files with T2 and may run in parallel with it)
Architecture rule: no changes to `TrackerRow.tsx`/`TrackerPage.tsx` in this task
[RESTATE: Fully standalone — no wiring into the row or page yet]

## DELIVERABLE
Given both dates set and equal, When formatDateRange is called, Then it returns a single formatted date
Given both dates set and differ (same month, different month, different year), When formatDateRange is called, Then it returns a compact range with month/year shown on both sides whenever they differ
Given only one date set, When formatDateRange is called, Then it returns that single date
Given neither date set, When formatDateRange is called, Then it returns null
Given the end date precedes the start date, When formatDateRange is called, Then it returns null
Given the popover closed with changes, When closed, Then onCommit fires once with both startDate and endDate together
Given the popover closed with no changes, When closed, Then onCommit does not fire
Given the parent changes `open` from true to false, When the draft differs, Then the same close path commits once before the panel disappears

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `formatDateRange` returns `null` (not an empty string) when both dates are unset — caller decides the placeholder text
  - Tests written BEFORE implementation for every branch
  - Explicit close, trigger toggle, outside pointer-down, Escape, and controlled parent close all use one idempotent close/commit path
  - The date portal exposes a containment signal that parent outside-click handlers can honor
  - Draft date values passed into `TrackerDateFields` are `string` (`null` coerced with `?? ""`); `onCommit` still emits `string | null`

Must-not-have:
  - Any wiring into `TrackerRow.tsx` or `TrackerPage.tsx`
  - Modifications to files outside the listed scope

Open question risks:
  - Exact placeholder copy for "Set date" is decided by the caller (T4), not this task — do not hardcode placeholder text here

Rollback note:
  - New files + additive helper function; safe to delete/revert independently of T1/T2

## STOP CONDITIONS
Done when: all formatDateRange branches pass, popover commit/no-op/invalid-range and close-path tests pass, 2 commits created
Uncertain when: N/A
Escalate when: this task's implementation needs to reach into TrackerRow.tsx or TrackerPage.tsx to pass a test — that's a scope leak into T4
