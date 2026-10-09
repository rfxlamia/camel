# Task T2 — Wire status change through the shared queue

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 2: Wire status change through the shared queue [depends: T1]

## OBJECTIVE
Replace `TrackerPage.tsx`'s `inFlightStatusRef`/`queuedStatusRef` latest-wins mechanism in
`changeStatus` with a call through T1's `createItemMutationQueue().enqueue(...)`, preserving
every existing visible behavior (optimistic update, 409 revert+toast+refetch, no-op guard,
group auto-uncollapse) while changing the underlying guarantee from "collapse to latest pick"
to "process every pick in order."

Files:
- Modify: `client/src/pages/TrackerPage.tsx`
- Modify: `client/src/pages/TrackerPage.test.tsx`

Steps:

0. Before the first red run, extend the page-test fixtures in `TrackerPage.test.tsx`:
   - Append a `Todo` status object without reordering the existing `Backlog`, `In Progress`,
     and `Done` entries, so `statuses[0]`/`statuses[1]`/`statuses[2]` and every index-based
     assertion keep working. Give `Todo` a `position` between Backlog and In Progress so the
     picker lists it in workflow order; new tests query it by name, not by array index.
   - Append a `Low` priority object to the priority fixture the same way.
   - Change the mocked `ApiError` class to `constructor(message: string, status: number, code?: string)`
     storing `this.code = code`, matching `client/src/api.ts`. The 409 recovery case below
     constructs `new ApiError("conflict", 409, "version_conflict")`. Existing tests that
     construct `new ApiError(message, status)` must keep compiling.

1. Write failing test for: 3 rapid status clicks are all processed, not collapsed (Story 6 Example D)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration

   Test intent:
   Given item CA-1 starts at status "Backlog", with `mockUpdateTrackerItem` set up to resolve
   each call sequentially with an incrementing version (mirroring the existing
   `makeItem({..., version: N})` helper already in this file)
   When the user rapidly clicks through "Todo", then "In Progress", then "Done" on the same row
   (fire all 3 picker clicks synchronously, as the existing "defers a second status pick" test
   at line 358 already does for 2 clicks)
   Then:
   - `mockUpdateTrackerItem` is eventually called exactly 3 times (not 1, not 2)
   - The 3 calls happen in order: Todo, then In Progress, then Done
   - The item ends displaying status "Done"

   Exercise through:
   - Clicking the row's status picker trigger and option, same as the existing status tests in this file

   Test doubles:
   - `mockUpdateTrackerItem` (already mocked at the top of this file) — do NOT mock
     `TrackerPage` or `TrackerRow`, render them for real via `render(<TrackerPage />)`

   Expected RED:
   - Today's `queuedStatusRef` (a `Map<id, statusId>`, single value) collapses the 3 rapid
     clicks into at most 2 total `mockUpdateTrackerItem` calls (first in-flight call + one
     more reflecting only the last queued pick) — this test's assertion of exactly 3 calls
     currently fails

   Add one recovery case to this same red suite before implementation: when the first status
   mutation receives `version_conflict`, its queued successor must wait for the authoritative
   `loadData()` refresh; if that refresh fails or is stale, the successor must be skipped rather
   than sending a request with the pre-refresh version. A later successful refresh must clear the
   per-item recovery block so a new user action can proceed.

2. Run test — verify FAIL:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`
   Expected failure: assertion `expect(mockUpdateTrackerItem).toHaveBeenCalledTimes(3)` fails, actual count is 2

3. Implement minimal code to satisfy the test:
   File: `client/src/pages/TrackerPage.tsx`
   Implement:
   - Add `const mutationQueueRef = useRef(createItemMutationQueue())` near the top of the component (alongside the existing refs).
   - Add `const itemsRef = useRef<TrackerItem[]>(items)` and assign `itemsRef.current = items` once during render so the ref follows the latest committed state.
   - Add the local helpers `replaceItems(next)` and `updateItems(updater)`. `replaceItems` assigns the exact next array to `itemsRef.current` before calling `setItems(next)`. `updateItems` computes `const next = updater(itemsRef.current)`, assigns the ref, and calls `setItems(next)`. Route every item-list replacement through these helpers, including the authoritative item-list assignment in `loadData`, mutation responses/rollbacks, and SSE updates; never assign `itemsRef.current = items` after a functional state update.
   - Change `loadData` to return `Promise<boolean>`: return `true` only after the current sequence commits `itemList` through `replaceItems`, and return `false` for a stale sequence, a failed request, or `activeWorkspaceId === null`. On a successful current refresh, clear the page-local `recoveryBlockedItemIdsRef` entries for ids present in the refreshed list. This return value is required by every later 409 recovery path.
   - Add a page-local `recoveryBlockedItemIdsRef = useRef(new Set<number>())`. A version-conflict handler adds the item id before awaiting `loadData()`; a successful refresh clears it, while a stale/failed refresh leaves it set. An enqueued task whose id is blocked returns without building or sending a request, so an already-queued tail cannot mutate against an unverified version.
   - Rewrite `changeStatus` to remove `inFlightStatusRef`/`queuedStatusRef` entirely; instead call `mutationQueueRef.current.enqueue(item.id, async () => { if (recoveryBlockedItemIdsRef.current.has(item.id)) return; const current = itemsRef.current.find((it) => it.id === item.id); if (!current) return; ...existing optimistic-update + api.updateTrackerItem + 409-handling + group-uncollapse logic, reading `current.status.id`/`current.version` instead of the outer closure's `item`/`version` })`.
   - Keep the existing no-op guard (`if (current.status.id === statusId) return`) but check it against `itemsRef.current`'s live value, not the closure's `item`. The optimistic item and every response/revert must update both React state and the ref through the helpers.

4. Run test — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`
   Expected: PASS

5. Refactor while green (bounded):
   - `changeStatus`'s body is now the template every later field-handler (T4-T9) will copy —
     if it exceeds ~50 lines, extract the "optimistic update + patch + 409 revert + toast +
     refetch" skeleton into a small local helper function within `TrackerPage.tsx` (not a
     new file yet — wait until a second handler duplicates it exactly, per Rule of Three,
     which will naturally happen in T4)
   - Re-run full test file: `npm run test -- client/src/pages/TrackerPage.test.tsx` — must stay PASS

6. Commit:
   `git add client/src/pages/TrackerPage.tsx client/src/pages/TrackerPage.test.tsx`
   `git commit -m "refactor(tracker): route status changes through shared per-item mutation queue"`

7. Run the full existing test file to confirm no regressions on already-passing tests:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`
   Expected: PASS — specifically re-verify `"defers a second status pick until the first request settles"` (line 358) and `"restores the previous status when the update fails"` (line 346) still pass unmodified; both are compatible with the new queue per Preflight analysis, but must be confirmed empirically, not assumed

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 6 Rule 2 Example D, Story 1 Rule 3 (409 pattern to preserve)
`client/src/pages/TrackerPage.tsx:250-300` — existing `changeStatus`, `inFlightStatusRef`, `queuedStatusRef`, group-uncollapse logic being replaced
`client/src/pages/TrackerPage.test.tsx:324-393` — existing status tests that must keep passing

## WHY THIS APPROACH
Complexity: standard
Justification: Rewires a working, tested handler to a new concurrency primitive without changing its external contract — requires careful preservation of every existing branch (optimistic update, no-op guard, 409 handling, group uncollapse) while swapping the internal queuing mechanism. Doing this on status first (before any new field) proves the queue against a known-good baseline before building 5 more handlers on top of it.

## SANDWICH CONTEXT
[CRITICAL: Every existing status test in TrackerPage.test.tsx must still pass unmodified — this task changes the queuing mechanism, not the observable behavior of status changes]
You are implementing Task 2 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: Option A — `mutationQueueRef` and `itemsRef` live in `TrackerPage.tsx`, not in a per-row hook. All item state transitions use the `replaceItems`/`updateItems` helpers from this task.
Files in scope: `client/src/pages/TrackerPage.tsx`, `client/src/pages/TrackerPage.test.tsx`
Available after: T1 (`createItemMutationQueue`)
Architecture rule: no server changes; `itemsRef` must be updated synchronously by the item-state helpers, not by a `useEffect` or by assigning the render snapshot after a functional `setItems` call.
[RESTATE: All existing status tests (409 revert, no-op guard, 2-click defer, group uncollapse) must pass unmodified]

## DELIVERABLE
Given item TE-1 starts at status "Backlog", When the user rapidly clicks "Todo", "In Progress", "Done", Then 3 sequential PATCH calls are made in order and the item ends at "Done"
Given a status change succeeds, When it resolves, Then the row displays the new status (existing behavior, re-verified)
Given a status change hits 409, When it occurs, Then the status reverts, a toast shows, and loadData() refetches (existing behavior, re-verified)
[must-not] Given the queue is in place, When any existing status test in the file runs, Then it must NOT need modification to pass

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `replaceItems`/`updateItems` synchronously keep `itemsRef.current` and React state on the same next array
  - `loadData` uses `replaceItems` for its authoritative item list and returns an explicit success/failure result
  - A failed or stale 409 recovery cannot release queued work against an unverified item version
  - `inFlightStatusRef`/`queuedStatusRef` fully removed, no dead code left behind
  - `Todo` is appended to the status fixture without reordering existing entries; mocked `ApiError` stores optional `code`
  - Tests written BEFORE implementation
  - Every existing status test in `TrackerPage.test.tsx` passes without modification

Must-not-have:
  - Any change to `TrackerRow.tsx` in this task — status's UI is explicitly out of scope, only its plumbing changes
  - Modifications to files outside the listed scope

Open question risks:
  - None specific to this task

Rollback note:
  - Client-only change; git revert restores `inFlightStatusRef`/`queuedStatusRef`

## STOP CONDITIONS
Done when: new 3-click test passes, all pre-existing status tests pass unmodified, commit created
Uncertain when: an existing status test fails after the rewrite and cannot be reconciled without changing its assertions — report NEEDS_CONTEXT rather than editing the test's expected values
Escalate when: TrackerRow.tsx needs changes to make this task pass (indicates scope leak)
