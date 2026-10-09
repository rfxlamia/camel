# EXECUTION PLAN — Tracker Row Inline Property Editing

**Date:** 2026-08-28
**Spec:** docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md
**Status:** revised after validation (second pass); pending implementation
**Total tasks:** 11

---

## Execution Overview

### Recommended Order
```
T1 → (T2 ∥ T3) → T4 → T5 → T6 → (T7 ∥ T8) → T9 → T10 → T11
```

T4–T6, T9, and T10 all modify `TrackerRow.tsx` and/or `TrackerPage.tsx` (and T4–T6/T9 also
touch `TrackerSection.tsx`), so those must stay sequential. Two pairs do not share files and
may run in parallel after their common predecessor:

### Parallelizable Groups
- **T2 ∥ T3** after T1: T2 is `TrackerPage.tsx` / `TrackerPage.test.tsx`; T3 is `trackerUtils.ts`
  plus the standalone date popover. T3 does not consume the queue.
- **T7 ∥ T8** after T6: T7 is `TrackerPage.tsx` / `TrackerPage.test.tsx`; T8 is `trackerUtils.ts`,
  `TrackerDetailPage.tsx`, and `TrackerCreateModal.tsx`. T9 depends on both.

### Constraints Reminder
**Architecture:** Client-only (`client/src/components/tracker/*`, `client/src/pages/TrackerPage.tsx`, `client/src/lib/trackerUtils.ts`). Must NOT touch `server/src/routes/tracker-items.ts` or Board/Card code. Every new trigger must follow `TrackerRowShell`'s `pointer-events-auto` opt-in pattern (the content wrapper is `pointer-events-none` by default — row 27 of `TrackerRowShell.tsx`) so it never also triggers the overlay navigation button. All mutations go through `api.updateTrackerItem(workspaceId, key, {...patch, version})` — no new endpoint.
**Out-of-scope:** description editing from the row, bulk/multi-row edit, `TrackerProjectsTab.tsx`, status picker's visual/UI redesign (only its mutation plumbing changes), Board/Card entities, a pending/saving visual indicator (documented follow-up, not required here). **Added during Phase 5 plan review, user-confirmed:** `TrackerProjectPage.tsx` and `client/src/components/tracker/TrackerPhaseSection.tsx` (a second, separate, drag-and-drop-enabled page that also renders `TrackerRow`) are explicitly out of scope — inline editing does not extend there in this plan. Every new `TrackerRow` prop is OPTIONAL so that call-site keeps compiling. When an editing handler is absent, the row preserves the existing read-only rendering for that property; in particular, the separate phase page continues to render its existing `createdAt` date column, not the list-page date-range editor.
**Assumptions at risk:** (1) no pending/saving indicator for queued mutations — low risk, queue guarantees eventual correctness; (2) exact empty-state copy strings are fixed below so tests remain deterministic; (3) the current server/API contract already accepts all combined item fields and returns a hydrated `TrackerItem`.

### Resolved implementation contracts

- **Live item state:** T2 creates one page-wide `itemsRef` containing the current array plus a per-item `mutationQueueRef`; the queue is keyed per item, while the ref is intentionally shared so every row observes the same authoritative list. T2 also creates `replaceItems(next)` and `updateItems(updater)`. `itemsRef.current = items` runs at render time; both helpers update the ref before calling `setItems`. Every authoritative item replacement—including initial/refresh `loadData`, mutation responses/rollbacks, and SSE changes—must use one of these helpers; no direct `setItems` calls remain for item state. `loadData` returns `true` only after the current sequence has committed its item list through `replaceItems`, and `false` for a stale or failed load. This avoids assigning a stale render snapshot after a functional update and gives 409 recovery an explicit completion signal.
- **Mutation helper:** T5 defines a typed private `applyItemPatch(itemId, build, errorMessage)` helper. `build(current)` runs inside the per-item queue and returns either `null` for a live no-op or `{ request, optimistic, rollback }`; `request` always includes `version: current.version`, and `optimistic` returns a complete `TrackerItem`. The helper applies the optimistic item with `updateItems`, sends the request, replaces it with the hydrated response, applies the field-scoped `rollback` for an immediate local restore on any failure, and additionally refetches on `version_conflict`. `rollback(latest)` must restore only the fields changed by that operation, preserving unrelated SSE/refetch updates. After a conflict, the item's queued tail is blocked until `loadData()` returns `true`; if recovery is stale or fails, remaining queued builders return without sending a request rather than using an unverified version. Field handlers only build field-specific request/optimistic/rollback values and never capture item state before enqueueing.
- **Date contract:** `formatDateRange` is deterministic and date-only. It parses `YYYY-MM-DD` components without `new Date(iso)` or locale-dependent formatting and returns exactly `D Mon`, `D–D Mon`, `D Mon–D Mon`, or `D Mon YYYY–D Mon YYYY` as required by the spec. The existing month-first helpers in the separate project/phase views are intentionally unchanged because their presentation contract differs.
- **Picker contract:** `TrackerRow` owns one `OpenPicker` union (`status | date | project | phase | priority | assignees | labels | kebab | null`). Every interactive child is inside `pointer-events-auto`. `TrackerRowDatePopover` owns its trigger and receives `triggerLabel`, `idPrefix`, and controlled open callbacks. Its close operation is idempotent and is also invoked when a parent changes it from `open` to `closed`; a parent must close the active date child through that same operation before switching or unmounting it. `TrackerRowKebabMenu` receives an `anchorRef`, owns one active field inside the panel, and portals its panel against that anchor. Its outside-click logic treats the active date portal as inside, and switching fields closes the previous child before clearing or replacing it. Outside click and Escape close the active picker; date close commits once only when drafts differ.
- **Row handler signatures:** Every `TrackerRow` field callback omits `item`. `TrackerSection` binds the row's item when forwarding to page handlers, matching today's `onStatusChange={(statusId) => onStatusChange(item, statusId)}`. Concrete Row types: `onDateChange?: (dates: { startDate: string | null; endDate: string | null }) => void`, `onProjectChange?: (projectId: number) => void`, `onPhaseChange?: (phaseId: number) => void`, `onPriorityChange?: (priorityId: number | null) => void`, `onAssigneeToggle?: (toggledId: number) => void`, `onLabelToggle?: (toggledId: number) => void`. `TrackerRowKebabMenu` receives those same Row-level callbacks and passes them through unchanged.
- **Accessible names and IDs:** Row triggers use stable names (`Date: ...`, `Project: ...`, `Phase: ...`, `Priority: ...`, `Assignees`, `Labels`, and `More properties`). Inline and kebab controls use distinct surface prefixes in their `data-testid`/date `idPrefix` values (`inline` versus `menu`) while remaining keyed by `item.key`; tests also query kebab content within its labeled panel. Date fields must never share DOM ids across rows or surfaces. The kebab panel has an explicit accessible name and focus returns to the kebab trigger after it closes.
- **Group keys and sentinel:** `projectGroupKey(projectId: number | null)` and `priorityGroupKey(priorityId: number | null)` are the only constructors for project/priority group keys; `null` maps to the existing `project:none`/`priority:none` keys. `NO_PRIORITY` is exported from `trackerUtils.ts` and imported by `TrackerProperties.tsx`, `TrackerCreateModal.tsx`, and all row priority consumers.
- **Test execution:** Run every command from the repository root with `npm run test`; focused paths are repository-relative (`npm run test -- client/src/...`). The root script currently runs the server suite before forwarding a focused client path, so the test environment must permit the server suite's existing listeners/database setup even for client checkpoints; do not substitute `npx vitest` or workspace-local commands. The final gate is `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- **TDD convention:** Within each task, all tests that define new behavior are written and run red before the corresponding implementation. Tests added later are explicitly labeled regression-only and must not be described as the source of a new implementation. If a regression test fails, write the failing assertion first, then fix it, then rerun the relevant command.
- **Page-test fixtures:** Before T2's first red run, extend `TrackerPage.test.tsx`'s status fixture with `Todo` without reordering the existing `Backlog`, `In Progress`, and `Done` entries, add `Low` to the priority fixture, and update the mocked `ApiError` to accept/store `code?: string`. Keep existing index-based fixtures working, but use option names and explicit IDs in new tests. Add explicit `CA-1`/`TE-1`/`TE-3`/`TE-4`/`TE-5` item fixtures as needed, plus `projectA`/`projectB`, a zero-phase project, and `Alice`/`Bob`/`Carol`/`Dave` fixtures before the tests that need them; do not rely on absent default data. In prose, `P1`/`P2` and `Ph1` are aliases for those fixture `.id` values, never literal string payloads.
- **Optimistic model mapping:** The `optimistic` function passed to `applyItemPatch` must return a complete `TrackerItem`. Status/priority/project/phase/date fields update their selected values in place. Assignee IDs map to `TrackerItemAssignee` via `{ id: member.userId, username: member.username, displayName: member.displayName }` looked up on the loaded `members` array — never assign a `WorkspaceMember` (which uses `userId` and includes `role`) onto `item.assignees`. Label IDs map to the matching `TrackerVocabulary` in the loaded `labels` array. If a toggled ID cannot be resolved from those options, abort that optimistic operation rather than constructing a partial item.
**Sequencing:** Pocket-development enforces the depends-on edges. The only legal parallel pairs are T2∥T3 and T7∥T8. T4–T6, T9, and T10 remain hard-sequential because they share `TrackerRow.tsx`, `TrackerSection.tsx`, and/or `TrackerPage.tsx`.

### File Structure Map

```
Rule: Shared per-item mutation queue (Story 6 Rule 2)
  Create: client/src/lib/trackerItemMutationQueue.ts          (created by: T1)
  Test:   client/src/lib/trackerItemMutationQueue.test.ts     (created by: T1)
  Modify: client/src/pages/TrackerPage.tsx                    (T2, T4, T5, T6, T7, T9)
  Modify: client/src/pages/TrackerPage.test.tsx               (T2)

Note: `TrackerPage.tsx` does NOT render `TrackerRow` directly — it renders `TrackerSection`
(one call-site, rendered once per group via `.map()`), which is what instantiates
`TrackerRow` (also one call-site in `TrackerSection.tsx`, rendered once per item via
`.map()`). Every rule below that touches
`TrackerRow.tsx` also touches `client/src/components/tracker/TrackerSection.tsx` to thread the
new props/handlers through. `TrackerRow` is also rendered by
`client/src/components/tracker/TrackerPhaseSection.tsx` (on the separate `TrackerProjectPage.tsx`)
— that call site is explicitly OUT OF SCOPE (user-confirmed) and is never modified by any task;
every new `TrackerRow` prop below is OPTIONAL specifically so that call site keeps compiling
and rendering its current read-only behavior unchanged.

Rule: Date range inline edit (Story 1)
  Create: client/src/components/tracker/TrackerRowDatePopover.tsx       (created by: T3)
  Test:   client/src/components/tracker/TrackerRowDatePopover.test.tsx  (created by: T3)
  Modify: client/src/lib/trackerUtils.ts                                (T3 — formatDateRange)
  Modify: client/src/lib/trackerUtils.test.ts                           (T3)
  Modify: client/src/components/tracker/TrackerRow.tsx                  (T4)
  Modify: client/src/components/tracker/TrackerSection.tsx              (T4)
  Modify: client/src/pages/TrackerPage.tsx                              (T4)
  Modify: client/src/pages/TrackerPage.test.tsx                         (T4)

Rule: Project/phase inline edit (Story 2)
  Modify: client/src/components/tracker/TrackerRow.tsx      (T5)
  Modify: client/src/components/tracker/TrackerSection.tsx  (T5 — also removes showProjectChip/projectLabel suppression)
  Modify: client/src/pages/TrackerPage.tsx                   (T5)
  Modify: client/src/pages/TrackerPage.test.tsx              (T5)
  Modify: client/src/lib/trackerUtils.ts                    (T5 — project/priority group-key helpers)

Rule: Priority inline edit (Story 3)
  Modify: client/src/components/tracker/TrackerRow.tsx      (T6)
  Modify: client/src/components/tracker/TrackerSection.tsx  (T6)
  Modify: client/src/pages/TrackerPage.tsx                   (T6)
  Modify: client/src/pages/TrackerPage.test.tsx              (T6 — also the cross-field race test, Story 6 Rule 2 Example C)
  Modify: client/src/lib/trackerUtils.ts                    (T6 — shared NO_PRIORITY/group key)
  Modify: client/src/components/tracker/TrackerProperties.tsx (T6 — consume shared NO_PRIORITY)
  Modify: client/src/components/tracker/TrackerCreateModal.tsx (T6 — consume shared NO_PRIORITY)

Rule: Assignee/label multi-toggle edit (Story 4)
  Modify: client/src/pages/TrackerPage.tsx                  (T7 — isolated fetch; T9 — wiring)
  Modify: client/src/pages/TrackerPage.test.tsx             (T7, T9)
  Modify: client/src/lib/trackerUtils.ts                    (T8 — resolveToggle helper)
  Modify: client/src/lib/trackerUtils.test.ts               (T8)
  Modify: client/src/pages/TrackerDetailPage.tsx             (T8 — consume resolveToggle)
  Modify: client/src/components/tracker/TrackerCreateModal.tsx (T8 — consume resolveToggle)
  Modify: client/src/components/tracker/TrackerRow.tsx      (T9)
  Modify: client/src/components/tracker/TrackerSection.tsx  (T9)

Rule: Mobile/narrow-viewport kebab (Story 5)
  Create: client/src/components/tracker/TrackerRowKebabMenu.tsx       (created by: T10)
  Test:   client/src/components/tracker/TrackerRowKebabMenu.test.tsx  (created by: T10)
  Modify: client/src/components/tracker/TrackerRow.tsx                 (T10)
  Create: client/src/components/tracker/TrackerRow.test.tsx            (created by: T10, Step 9 — extended by T11)

Rule: Single active picker per row (Story 6 Rule 1)
  Modify: client/src/components/tracker/TrackerRow.tsx        (incrementally, T3→T10)
  Modify: client/src/components/tracker/TrackerRow.test.tsx   (extended by T11 — created in T10)
```

---

## Pocket Packets

---

### Task 1: Shared per-item mutation queue module [prereq]

## OBJECTIVE
Build a generic, per-item-id sequential mutation queue: given repeated calls to enqueue an
async task under the same key, tasks run strictly in submission order, each starting only
after the previous one has settled (resolved or rejected) — and tasks under different keys
never block each other. This replaces the ad-hoc `inFlightStatusRef`/`queuedStatusRef`
latest-wins pattern that today only guards status against itself.

Files:
- Create: `client/src/lib/trackerItemMutationQueue.ts`
- Test: `client/src/lib/trackerItemMutationQueue.test.ts`

Steps:

1. Write the complete failing test suite for the queue before implementation:
   sequential ordering within one item's queue, per-item isolation, and rejection
   resilience
   Test file: `client/src/lib/trackerItemMutationQueue.test.ts`
   Level: unit

   Test intent:
   Given a queue instance and two tasks enqueued for the same itemId (id=1), the first
   task an unresolved promise the test controls manually
   When the second task is enqueued before the first resolves
   Then:
   - The second task's function has not been invoked yet
   - After the first task's controlled promise resolves, the second task's function is invoked
   - Both tasks' return values resolve in enqueue order

   Exercise through:
   - The queue's public `enqueue(itemId, task)` function only — no internals

   Test doubles:
   - None needed — use manually-controlled promises (a resolver captured via `new Promise((resolve) => { capturedResolve = resolve })`) to control timing deterministically
   - do NOT mock: the queue module itself

   Expected RED:
   - `trackerItemMutationQueue.ts` does not exist yet — import fails

   Add the isolation case before implementation: a pending task for itemId=1 must not
   delay a task for itemId=2. Add the rejection case before implementation: a second
   task for itemId=1 must still run after the first task rejects. All three cases should
   fail at the missing-module boundary before the implementation exists.

2. Run test — verify FAIL:
   `npm run test -- client/src/lib/trackerItemMutationQueue.test.ts`
   Expected failure: module not found / import error for `./trackerItemMutationQueue`

3. Implement minimal code to satisfy the test:
   File: `client/src/lib/trackerItemMutationQueue.ts`
   Implement:
   ```
   export function createItemMutationQueue() {
     const chains = new Map<number, Promise<unknown>>();
     function enqueue<R>(itemId: number, task: () => Promise<R>): Promise<R> {
       const prior = chains.get(itemId) ?? Promise.resolve();
     const next = prior.then(task, task);
     const settled = next.then(() => undefined, () => undefined);
     chains.set(itemId, settled);
     void settled.then(() => {
       if (chains.get(itemId) === settled) chains.delete(itemId);
     });
     return next;
     }
     return { enqueue };
   }
   ```
   (`prior.then(task, task)` runs `task` regardless of whether the prior settled or
   rejected — this is what lets a 409-rejected mutation not permanently jam the queue for
   that item, verified by the rejection case in the red suite above. The identity check removes
   settled chains without deleting a newer chain that was added for the same item.)

4. Run test — verify PASS:
   `npm run test -- client/src/lib/trackerItemMutationQueue.test.ts`
   Expected: PASS

5. Refactor while green (bounded):
   - Rule of three: not yet applicable, single function
   - Re-run test — must stay PASS

6. Commit:
   `git add client/src/lib/trackerItemMutationQueue.ts client/src/lib/trackerItemMutationQueue.test.ts`
   `git commit -m "feat(tracker): add per-item queue ordering and rejection tests"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 6 Rule 2, Design Decision (Option A)
`client/src/pages/TrackerDetailPage.tsx:232-238` — `enqueueMutation`'s promise-chain pattern, the single-item precedent this module generalizes to per-item-id

## WHY THIS APPROACH
Complexity: standard
Justification: Pure logic module with no DOM/React dependency — the concurrency behavior (ordering, isolation, rejection-resilience) is exactly the kind of thing that is fast and deterministic to unit-test with controlled promises, and is the highest-risk piece of the whole feature (a bug here causes silent data loss across every field). Isolating it from React makes it independently verifiable before any UI wiring exists.

## SANDWICH CONTEXT
[CRITICAL: This module must have zero React or DOM dependencies — it is pure TypeScript, importable and testable in complete isolation]
You are implementing the shared per-item mutation queue for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: Option A — this queue is consumed directly by `TrackerPage.tsx` (T2 onward), not distributed into a per-row hook.
Files in scope: `client/src/lib/trackerItemMutationQueue.ts`, `client/src/lib/trackerItemMutationQueue.test.ts`
Available after: none (prereq)
Architecture rule: no server changes, no new dependencies — plain TypeScript using only native Promises
[RESTATE: Zero React/DOM dependency — this is a plain data-structure module]

## DELIVERABLE
Given two tasks enqueued for the same itemId, When the first is still pending, Then the second does not start until the first settles
Given two tasks enqueued for different itemIds, When both are pending, Then they execute independently
Given a task rejects, When the next task for the same itemId is enqueued, Then it still runs

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `enqueue<R>(itemId: number, task: () => Promise<R>): Promise<R>` is the only public API surface
  - Tests written BEFORE implementation
  - No logic duplicated 3+ times

Must-not-have:
  - Any import of React, `react-dom`, or DOM APIs
  - Any reference to `TrackerItem`, `api.updateTrackerItem`, or any tracker-domain type — this module is generic

Open question risks:
  - None specific to this task

Rollback note:
  - New file, no existing behavior touched yet — safe to delete outright if this task is reverted

## STOP CONDITIONS
Done when: all 3 DELIVERABLE scenarios pass, tests green, 1 commit created
Uncertain when: N/A
Escalate when: any tracker-domain type creeps into this file

---

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

---

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

---

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

---

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

---

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

---

### Task 7: Labels/members isolated eager fetch [depends: T6]

## OBJECTIVE
Add `labels` and `members` fetches to `TrackerPage.tsx`'s `loadData()`, each isolated from the
existing primary `Promise.all([statuses, priorities, projects, items])`, degrading to `[]` on
failure. The auxiliary requests run in parallel after primary data is committed, cannot blank the
list or hold its initial spinner open, and check the same `loadSeqRef` before updating state.

Files:
- Modify: `client/src/pages/TrackerPage.tsx`
- Modify: `client/src/pages/TrackerPage.test.tsx`

Steps:

1. Write the complete failing T7 suite before implementation:
   - labels fetch succeeds and is called with `(workspaceId, "label")`
   - labels fetch failure leaves an existing row visible and does not show the full-page load
     failure UI
   - members fetch failure leaves an existing row visible
   - a stale labels/members response from an older load sequence cannot overwrite the newer
     options. Use manually-controlled promises and invoke the registered refresh callback to
     start the second sequence before resolving the first auxiliary request.
   - switching workspaces clears the previous workspace's labels/members before the new
     auxiliary responses arrive, so stale options cannot be used by an editable row
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test doubles: `mockListTrackerVocabularies` and `mockGetWorkspaceMembers`; branch the
   vocabulary mock by kind so status/priority remain successful, and use explicit labels/members
   whose names differ between the old and new sequences.
   Expected RED: the current page never requests labels/members, has no isolated auxiliary
   loader, and has no sequence guard for their responses.

2. Run the complete red suite:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`
   Expected failure: the new labels/members assertions fail before implementation exists.

3. Implement minimal code to satisfy the suite:
   File: `client/src/pages/TrackerPage.tsx`
   Implement: add `const [labels, setLabels] = useState<TrackerVocabulary[]>([])` and
   `const [members, setMembers] = useState<WorkspaceMember[]>([])`. Keep the primary
   `Promise.all([statuses, priorities, projects, items])` unchanged and keep its failure handling
   as the only source of `loadFailed`. After the primary data is committed and the primary
   `setLoading(false)` path has run, start `void loadAuxiliary(seq)` so auxiliary latency cannot
   hold the initial spinner open. Inside that local loader, start both requests in parallel with
   independent fallbacks:
   `api.listTrackerVocabularies(workspaceId, "label").catch(() => [])` and
   `api.getWorkspaceMembers(workspaceId).then((result) => result.members).catch(() => [])`.
   Await that pair, update labels/members only when `seq === loadSeqRef.current`, and discard
   stale results. Every rejection must be converted to its own `[]` fallback and must not escape
   into the primary `loadFailed` branch. Add a workspace-change effect that clears both arrays
   before the new workspace's auxiliary requests can resolve; do not clear them on an ordinary
   same-workspace refresh unless the workspace id changes.

4. Run the complete T7 suite — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

5. Refactor while green: keep the auxiliary loader local to `TrackerPage.tsx`; do not create a
   generic fetch framework for two concrete requests. Re-run:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

6. Commit:
    `git add client/src/pages/TrackerPage.tsx client/src/pages/TrackerPage.test.tsx`
    `git commit -m "feat(tracker): eagerly fetch labels and members with isolated failure handling"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 4 Rule 2, Example C/D
`client/src/pages/TrackerDetailPage.tsx` — precedent for isolating vocab/member fetch failures from the rest of the page
`client/src/components/tracker/TrackerCreateModal.tsx:92-102` — `getWorkspaceMembers` response shape (`memberList.members`)
`client/src/pages/TrackerPage.test.tsx:222-233` — `mockGetWorkspaceMembers`/`mockListTrackerVocabularies` already mocked with label/member support in `beforeEach`

## WHY THIS APPROACH
Complexity: lightweight
Justification: Additive fetches with a clear, small isolation pattern — no branching logic, no UI changes, mocks for this already exist in the test file's `beforeEach`.

## SANDWICH CONTEXT
[CRITICAL: labels/members fetches must NOT join the existing Promise.all — each needs its own independent try/catch so a failure in either can never blank the item list]
You are implementing Task 7 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: isolated fetches, matching TrackerDetailPage's precedent
Files in scope: `client/src/pages/TrackerPage.tsx`, `client/src/pages/TrackerPage.test.tsx`
Available after: T6
Architecture rule: failure isolation — never let labels/members rejection propagate into the existing loadFailed path
[RESTATE: Isolated try/catch per fetch — never joins the main Promise.all]

## DELIVERABLE
Given labels fetch succeeds, When page loads, Then labels state populated
Given labels fetch fails, When page loads, Then labels state is [], item list still renders normally
Given members fetch fails, When page loads, Then members state is [], item list still renders normally
Given an older auxiliary load resolves after a newer primary load, When it tries to update state,
Then its labels/members result is discarded and the newer options remain visible
Given the active workspace changes, When the new auxiliary requests are still pending, Then the
previous workspace's labels and members are already cleared

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Each fetch wrapped in its own try/catch, independent of the other and of the main Promise.all
  - Auxiliary loading starts after the primary loading flag is cleared and never controls the
    full-page spinner or `loadFailed` state
  - The `loadSeqRef` check covers both labels and members before committing either result
  - A workspace change clears stale labels/members before the next auxiliary result is committed
  - Tests written BEFORE implementation

Must-not-have:
  - Joining labels/members into the existing `Promise.all([statuses, priorities, projects, items])`
  - Modifications to files outside listed scope

Open question risks:
  - None specific

Rollback note:
  - Revert removes the two new state variables and fetches; no other behavior affected

## STOP CONDITIONS
Done when: all 5 DELIVERABLE scenarios pass, commit created
Uncertain when: N/A
Escalate when: N/A

---

### Task 8: Toggle-diff resolver helper [depends: T6]

## OBJECTIVE
Add a small, pure, generic helper to `trackerUtils.ts` that computes the next id array for a
toggle-based multi-select field: add the id if absent, remove it if present. Then replace the
same inline logic in `TrackerDetailPage.tsx` and `TrackerCreateModal.tsx` so `resolveToggle` is
the single source of truth before T9 consumes it.

Files:
- Modify: `client/src/lib/trackerUtils.ts`
- Modify: `client/src/lib/trackerUtils.test.ts`
- Modify: `client/src/pages/TrackerDetailPage.tsx`
- Modify: `client/src/components/tracker/TrackerCreateModal.tsx`

Steps:

1. Write the complete failing red suite before implementation:
   - `currentIds=[1]`, toggling `2` returns `[1, 2]`
   - `currentIds=[1, 2]`, toggling `2` returns `[1]`
   - `currentIds=[]`, toggling `5` returns `[5]`
   Test file: `client/src/lib/trackerUtils.test.ts`
   Level: unit
   Exercise through: `resolveToggle` directly; no mocks are needed because it is pure.
   Expected RED: `resolveToggle` does not exist yet.

2. Run the complete red suite — verify the missing-helper failure:
   `npm run test -- client/src/lib/trackerUtils.test.ts`

3. Implement the minimal generic helper:
   File: `client/src/lib/trackerUtils.ts`
   Implement: `export function resolveToggle(currentIds: number[], toggledId: number): number[] { return currentIds.includes(toggledId) ? currentIds.filter((id) => id !== toggledId) : [...currentIds, toggledId]; }`

4. Run the focused helper suite — verify PASS:
   `npm run test -- client/src/lib/trackerUtils.test.ts`

5. Refactor existing consumers while green: change `TrackerDetailPage.tsx`'s
   `resolvePropertyPatch` to call `resolveToggle` for assignees and labels, and replace
   `TrackerCreateModal.tsx`'s local `toggle` function with the same import. Do not alter their
   queue or request behavior. Run all three focused suites — each must PASS:
   `npm run test -- client/src/lib/trackerUtils.test.ts`
   `npm run test -- client/src/pages/TrackerDetailPage.test.tsx`
   `npm run test -- client/src/components/tracker/TrackerCreateModal.test.tsx`

6. Commit:
    `git add client/src/lib/trackerUtils.ts client/src/lib/trackerUtils.test.ts client/src/pages/TrackerDetailPage.tsx client/src/components/tracker/TrackerCreateModal.tsx`
    `git commit -m "refactor(tracker): share toggle resolution across property editors"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 4 Rule 1
`client/src/pages/TrackerDetailPage.tsx:210-230` — `resolvePropertyPatch`'s inline toggle-diff logic to replace with the shared helper
`client/src/components/tracker/TrackerCreateModal.tsx:184-185` — local toggle logic to replace with the shared helper

## WHY THIS APPROACH
Complexity: lightweight
Justification: Tiny, pure, fully deterministic function — no judgment beyond porting existing inline logic into a named export.

## SANDWICH CONTEXT
[CRITICAL: This function must be generic over number[] — no TrackerItem or assignee/label-specific typing, so it can be reused identically for both assigneeIds and labelIds in T9]
You are implementing Task 8 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: extracted helper, ported from TrackerDetailPage's resolvePropertyPatch
Files in scope: `client/src/lib/trackerUtils.ts`, `client/src/lib/trackerUtils.test.ts`, `client/src/pages/TrackerDetailPage.tsx`, `client/src/components/tracker/TrackerCreateModal.tsx`
Available after: T6 (shares no files with T7; may run in parallel with it)
Architecture rule: pure function, no side effects, no tracker-domain types in the signature
[RESTATE: Generic over number[] — reusable for both assignee and label ids]

## DELIVERABLE
Given an id absent from the current list, When resolveToggle is called, Then it's added
Given an id present in the current list, When resolveToggle is called, Then it's removed
Given an empty current list, When resolveToggle is called with any id, Then the result is a single-element list

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Function signature is `(currentIds: number[], toggledId: number) => number[]`, no tracker-specific types
  - Tests written BEFORE implementation
  - Existing detail and create-modal consumers import `resolveToggle`; no duplicate toggle implementation remains

Must-not-have:
  - Any reference to `TrackerItem`, assignees, or labels by name in this function's implementation
  - Modifications to files outside listed scope

Open question risks:
  - None specific

Rollback note:
  - New pure function, safe to delete independently

## STOP CONDITIONS
Done when: all 3 DELIVERABLE scenarios pass, commit created
Uncertain when: N/A
Escalate when: N/A

---

### Task 9: Wire assignee/label pickers into TrackerRow + TrackerPage [depends: T7, T8]

## OBJECTIVE
Turn the row's assignee avatars and label chips into `TrackerPropertyPicker` `multiple`-mode
triggers, wire their toggle patches through the shared mutation queue using `resolveToggle`
(T8) and `itemsRef` (T2) so rapid sequential toggles on the same item compute correctly
against live settled state rather than stale click-time snapshots.

Files:
- Modify: `client/src/components/tracker/TrackerRow.tsx`
- Modify: `client/src/components/tracker/TrackerSection.tsx`
- Modify: `client/src/pages/TrackerPage.tsx`
- Modify: `client/src/pages/TrackerPage.test.tsx`

**Correction from Phase 5 review + scope boundary (same as T4/T5/T6):** `members`, `labels`,
`onAssigneeToggle`, `onLabelToggle` thread through `TrackerSection.tsx`, not directly from
`TrackerPage.tsx` to `TrackerRow`. All four are OPTIONAL on `TrackerRow`'s Props — when
absent, the assignee avatars and label chips render exactly as they do today (read-only),
matching `TrackerPhaseSection.tsx`'s unmodified, out-of-scope call site.

Steps:

Before the first red run, extend `mockGetWorkspaceMembers` so the default fixture includes
Alice (`userId: 7`), Bob (`userId: 8`), Carol (`userId: 9`), and Dave (`userId: 10`), each
with `username`/`displayName` matching those names. Existing tests that only query Alice/Bob
must keep passing. Then draft the complete T9 red suite in the test file: assignee add,
assignee remove, assignee live-state race, label add, label remove, and 409 mid-queue recovery.
The later numbered entries describe each assertion and its verification checkpoint; they are
not permission to implement a behavior before its assertion exists.

1. Write failing test for: toggling an assignee adds them (Story 4 Example A)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given item CA-1 has assignees=[Alice] (`TrackerItemAssignee.id` 7, matching Alice's `userId`), When the user opens the row's assignee picker and toggles Bob (`userId` 8), Then `mockUpdateTrackerItem` is called with `{ assigneeIds: [7, 8], version }`
   Exercise through: clicking the row's assignee trigger, selecting Bob in the multi-select picker
   Test doubles: `mockUpdateTrackerItem`
   Expected RED: today's assignee avatars in `TrackerRow.tsx` are plain, non-interactive spans

2. Run test — verify FAIL:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

3. Implement minimal code to satisfy the test:
   File: `client/src/components/tracker/TrackerRow.tsx`
   Implement: add `members?: WorkspaceMember[]`, `labels?: TrackerVocabulary[]`,
   `onAssigneeToggle?: (toggledId: number) => void`,
   `onLabelToggle?: (toggledId: number) => void` (all OPTIONAL); when
   `members`/`onAssigneeToggle` are both defined, replace the assignee avatar block with a
   `TrackerPropertyPicker multiple` trigger with accessible name `Assignees` and
   `data-testid={\`row-inline-assignees-${item.key}\`}`, options built the same way
   `TrackerProperties.tsx`'s `assigneeOptions` are built (`id: String(m.userId)`, selected via
   `item.assignees` ids); when either is undefined, keep today's plain read-only avatar display; apply the identical
   defined/undefined split for the label chip block using `labels`/`onLabelToggle`/`labelOptions`,
   with accessible name `Labels` and `data-testid={\`row-inline-labels-${item.key}\`}`;
   extend the "which picker" union to include `"assignees"` and `"labels"`

   File: `client/src/components/tracker/TrackerSection.tsx`
   Implement: add `members: WorkspaceMember[]`, `labels: TrackerVocabulary[]`,
   `onAssigneeToggle: (item: TrackerItem, toggledId: number) => void`,
   `onLabelToggle: (item: TrackerItem, toggledId: number) => void` to `Props`. Bind item at the
   Row call-site the same way status/date already do:
   `onAssigneeToggle={(toggledId) => onAssigneeToggle(item, toggledId)}` and
   `onLabelToggle={(toggledId) => onLabelToggle(item, toggledId)}`. Pass `members` and `labels`
   straight through.

   File: `client/src/pages/TrackerPage.tsx`
   Implement: add `changeAssignee` and `changeLabel` through `applyItemPatch`. Each builder reads
   `itemsRef.current` inside the queued closure, uses `resolveToggle`, and builds the request with
   the current version. The optimistic `assignees` array is `TrackerItemAssignee[]`: map each id
   through `members.find((m) => m.userId === id)` to `{ id: member.userId, username: member.username, displayName: member.displayName }`. Optimistic `labels` are the matching `TrackerVocabulary` objects from the loaded `labels` state. If a toggled ID cannot be resolved, return
   `null` and do not send a partial optimistic item. Pass `members`, `labels`, and both handlers
   through the `<TrackerSection ... />` call-site.

4. Run test — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

5. Execute the pre-written regression case for: rapid sequential toggles compute against live settled state, not stale snapshot (Story 4 Example B — the core race-condition fix)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration

   Test intent:
   Given item CA-1 has assignees=[Alice] (`TrackerItemAssignee.id` 7), version=5, with `mockUpdateTrackerItem` set up
   so the FIRST call (toggling Bob, `userId` 8) resolves only after the test explicitly triggers it
   (via a manually-controlled promise, same technique as T1's queue tests), returning
   `{ ...current, assignees: [{ id: 7, username: "alice", displayName: "Alice" }, { id: 8, username: "bob", displayName: "Bob" }], version: 6 }`
   When the user toggles Bob, then immediately toggles Carol (`userId` 9) before Bob's call resolves
   Then:
   - `mockUpdateTrackerItem` is called first with `{ assigneeIds: [7, 8], version: 5 }` (Bob added to Alice)
   - Only after that call is manually resolved does the second call fire, with `{ assigneeIds: [7, 8, 9], version: 6 }` — computed against the SETTLED state (including Bob and the new version), not the pre-Bob snapshot
   - Neither toggle is dropped; final displayed assignees are Alice, Bob, Carol

   Exercise through: clicking the row's assignee trigger twice in quick succession, toggling different members each time, with the mock controlling exact resolution timing

   Test doubles: `mockUpdateTrackerItem` (manually-controlled promise for the first call, resolved value for the second)

   Regression check: if `changeAssignee`'s closure reads `item.assignees` (the value captured when the row was rendered / the toggle was clicked) instead of `itemsRef.current`'s live value at execution time, the second call computes `assigneeIds: [7, 9]` (missing Bob) instead of `[7, 8, 9]`.

6. Run regression test — verify PASS (verify, don't assume — Step 3's sketch already reads
   `itemsRef.current.find(...)` INSIDE the enqueued closure, which is the correct pattern, so
   this may already pass; if Step 3's actual implementation instead captured `item.assignees`
   from the outer scope before calling `enqueue`, this fails with the second call's
   `assigneeIds` argument as `[7, 9]` instead of `[7, 8, 9]`):
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

7. (If Step 6 fails, fix the implementation.) Verify `changeAssignee`'s enqueued task reads `itemsRef.current.find(...)` INSIDE
   the async function body (not destructured from the outer `item` parameter before the
   `enqueue` call) — this is the exact bug the test targets; fix by moving the
   `current.assignees` read to occur at the top of the enqueued async closure, not before it

8. Run test — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

9. Execute the pre-written regression case for: label toggle follows the identical pattern
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given an item with labels=[Feature], When the user toggles the Bug label in the row's label picker, Then `mockUpdateTrackerItem` is called with `{ labelIds: [Feature.id, Bug.id], version }`
   Exercise through: clicking the row's label trigger, toggling a label
   Test doubles: `mockUpdateTrackerItem`
   Regression check: `changeLabel` should already use the same helper path as `changeAssignee`;
   if it fails, write the failing assertion before changing the implementation.

10. Run test — verify PASS (verify): `npm run test -- client/src/pages/TrackerPage.test.tsx`

10a. Execute the pre-written regression case for: toggling an assignee off removes them
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration
    Test intent: Given item CA-1 has assignees=[Alice, Bob] (ids 7 and 8), When the user
    toggles Alice in the row's assignee picker, Then `mockUpdateTrackerItem` is called with
    `{ assigneeIds: [8], version }` and the row no longer shows Alice as selected.
    Exercise through: opening the assignee picker and toggling the already-selected Alice option
    Test doubles: `mockUpdateTrackerItem`
    Regression check: `resolveToggle` already covers remove at unit level; this locks the
    page wiring for the off path, not only add.

10b. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

10c. Execute the pre-written regression case for: toggling a label off removes it
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration
    Test intent: Given an item with labels=[Feature, Bug], When the user toggles Feature in
    the row's label picker, Then `mockUpdateTrackerItem` is called with
    `{ labelIds: [Bug.id], version }`.
    Test doubles: `mockUpdateTrackerItem`

10d. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

11. Execute the pre-written regression case for: 409 mid-toggle-queue reverts that step and resumes the rest (Story 4, final scenario)
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration

    Test intent:
    Given item CA-1 has assignees=[Alice] (`TrackerItemAssignee.id` 7), version=5, When the user toggles Bob (`userId` 8)
    then immediately toggles Carol (`userId` 9) before Bob's call resolves, and the FIRST
    (`mockUpdateTrackerItem` for Bob) is rejected with a `version_conflict` ApiError, with
    `mockListTrackerItems`'s refetch (triggered by `loadData()`) set to return CA-1 with
    assignees=[{ id: 7, username: "alice", displayName: "Alice" }, { id: 10, username: "dave", displayName: "Dave" }]
    (Dave's `userId` 10 — a value distinguishable from both the pre-toggle state
    [Alice] and the naively-expected-but-wrong post-Bob state [Alice, Bob]) and version=9
    Then:
    - The Bob toggle reverts visibly (row shows [Alice, Dave] after the refetch, not [Alice, Bob])
    - A toast reads "Someone else updated this item first — refreshed."
    - The second queued toggle (Carol) still fires afterward, computed against the REFETCHED
      state — asserting the exact PATCH payload `{ assigneeIds: [7, 10, 9], version: 9 }`
      (Alice + Dave, from the refetch, plus Carol) — a test that only passes if the
      implementation actually re-reads the refetched state before computing Carol's toggle;
      an implementation that stalls, drops Carol, or computes against any other assignee set
      fails this specific assertion (test-strategy-audit finding — the prior wording had no
      way to distinguish a correct refetch-then-resume from a stale-read bug)

    Exercise through: same double-toggle interaction as Step 5, with the first mock call
    rejecting instead of resolving

    Test doubles: `mockUpdateTrackerItem`, `mockShowToast`, `mockListTrackerItems` (for the refetch, returning the distinguishable [Alice, Dave]/version=9 state above)

    Regression check: if `changeAssignee`'s catch branch doesn't call `loadData()`, if the queue
    doesn't continue to the next task after a rejection, or if Carol's toggle is computed
    against any state other than the refetched [Alice, Dave] (this exercises T1's
    rejection-resilience guarantee at the integration level with a payload precise enough to
    catch a stale-read implementation that Step 5's happy-path test cannot)

12. Run regression test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

13. If Step 12 fails, align `changeAssignee`/`changeLabel`'s catch branches with the established
    409-handling shape from `changeStatus`/`changeDate`/`changeProject`/`changePriority`, then
    rerun the regression test.

14. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

15. Refactor while green: `changeAssignee` and `changeLabel` are now near-identical except for
    the field name (`assigneeIds` vs `labelIds`) and source array (`assignees` vs `labels`) —
    Rule of Three has now fired across the whole file for the optimistic/409 skeleton; if
    `applyItemPatch` (from T5) doesn't already parameterize cleanly over toggle-based fields,
    extend it now rather than leaving two near-duplicate functions
    Re-run: `npm run test -- client/src/pages/TrackerPage.test.tsx` — must stay PASS

16. Commit:
    `git add client/src/components/tracker/TrackerRow.tsx client/src/components/tracker/TrackerSection.tsx client/src/pages/TrackerPage.tsx client/src/pages/TrackerPage.test.tsx`
    `git commit -m "feat(tracker): add inline assignee and label toggle editing to tracker rows"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 4, full GWT, especially Example B
`client/src/components/tracker/TrackerProperties.tsx:96-114` — `assigneeOptions`/`labelOptions` construction pattern reused
`client/src/lib/trackerUtils.ts` (post-T8) — `resolveToggle` consumed here
`client/src/pages/TrackerPage.tsx` (post-T7) — `labels`/`members` state consumed here

## WHY THIS APPROACH
Complexity: standard
Justification: The core race-condition scenario (Step 5-8) requires precise closure-timing correctness that's easy to get subtly wrong (reading stale vs. live state) — this is the exact bug class the edge-case hunter flagged in the grinding session, so it gets dedicated, explicit test coverage rather than being folded into a lighter task.

## SANDWICH CONTEXT
[CRITICAL: The enqueued task's closure MUST read itemsRef.current at execution time, inside the async function body — never capture assignee/label state before calling enqueue, or rapid sequential toggles will silently drop each other]
You are implementing Task 9 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: Option A — changeAssignee/changeLabel reuse mutationQueueRef/itemsRef from T2, resolveToggle from T8
Files in scope: `client/src/components/tracker/TrackerRow.tsx`, `client/src/components/tracker/TrackerSection.tsx`, `client/src/pages/TrackerPage.tsx`, `client/src/pages/TrackerPage.test.tsx`
Available after: T7 and T8 (T7∥T8 must both complete first)
Architecture rule: read itemsRef.current inside the enqueued closure, not before enqueue is called; members/labels/onAssigneeToggle/onLabelToggle are OPTIONAL on TrackerRow's Props; Row callbacks omit `item`
[RESTATE: Live-state read inside the closure, at execution time — this is the load-bearing constraint for this whole task]

## DELIVERABLE
Given item has assignees=[Alice], When user toggles Bob, Then patch sent assigneeIds=[Alice.id,Bob.id]
Given item has assignees=[Alice, Bob], When user toggles Alice off, Then patch sent assigneeIds=[Bob.id]
Given two rapid toggles (Bob then Carol) before the first settles, When both settle, Then final assigneeIds=[Alice,Bob,Carol], computed via live state at execution time
Given labels toggle used, Then same add and remove pattern with labelIds
Given a 409 mid-queue, Then that step reverts+toasts+refetches, remaining queued toggles resume against refetched state

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `itemsRef.current` read happens inside the enqueued async closure body, verified by the Step 5-8 test passing
  - `resolveToggle` (T8) imported and used, not re-implemented inline
  - Assignee/label ordinary failures restore only their own field; a 409 tail proceeds only after
    `loadData()` has synchronously updated `itemsRef` with the authoritative list
  - Optimistic assignees are `TrackerItemAssignee` objects mapped from `member.userId`, never `WorkspaceMember`
  - `members`, `labels`, `onAssigneeToggle`, `onLabelToggle` are OPTIONAL on `TrackerRow`'s Props, threaded through `TrackerSection.tsx` with item bound at the Section→Row call-site
  - Tests written BEFORE implementation

Must-not-have:
  - Reading assignee/label state from the `item` parameter captured before `enqueue` is called
  - Making any of the four new props required on `TrackerRow` (breaks `TrackerPhaseSection.tsx`)
  - Modifications to files outside listed scope

Open question risks:
  - None specific — this task resolves the exact concurrency risk the edge-case hunter flagged

Rollback note:
  - Revert restores plain, non-interactive assignee avatars and label chips

## STOP CONDITIONS
Done when: all 5 DELIVERABLE scenarios pass (especially the race-condition scenario), commit created
Uncertain when: N/A
Escalate when: the race-condition test (Step 5) cannot be made to pass without changing T1's queue module itself — report back rather than patching T1 silently from within this task

---

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

---

### Task 11: TrackerRow.test.tsx — unit regression suite [depends: T10]

## OBJECTIVE
Round out `TrackerRow.test.tsx` (started in T10 with the kebab-class test) with the
cross-cutting unit-level coverage that can only be fully exercised once every trigger exists:
single-picker-mutex across all 8 triggers (status + 6 new property triggers + kebab), independent state across
rows, read-only compatibility, navigation isolation, and placeholder rendering.

Files:
- Modify: `client/src/components/tracker/TrackerRow.test.tsx`
- Modify: `client/src/components/tracker/TrackerRow.tsx` (only if the regression test exposes a
  row-state fix; otherwise no production change is made)

Test harness: mark the file as jsdom and mock `react-router`'s `useNavigate`, or wrap every
render in `MemoryRouter`, because `TrackerRowShell` calls `useNavigate` even for direct Row tests.
Use a stable `mockNavigate` so every new trigger can prove it does not navigate.

Steps:

1. Write regression tests for: opening one picker closes another on the same row (Story 6 Example A)
   Test file: `client/src/components/tracker/TrackerRow.test.tsx`
   Level: unit

   Test intent:
   Given `TrackerRow` rendered directly with a fully-populated fixture, exercise this pairwise
   transition table: `status → date`, `date → project`, `project → phase`, `phase → priority`,
   `priority → assignees`, `assignees → labels`, `labels → kebab`, and `kebab → status`. For each
   transition, click the source trigger and then the destination trigger. Then the source content
   is gone and only the destination picker is open. When the source is `date` after a draft edit,
   also assert its `onDateChange` callback fires exactly once before the destination opens.

   Exercise through: the transition table above, asserting source content is gone and destination
   content is present after each click pair; scope kebab child queries within its labeled panel.

   Test doubles: all `on*` props as `vi.fn()`

   Regression check: if `TrackerRow`'s "which picker" union state isn't correctly wired to close
   on any other trigger's click — this exercises all 8 trigger values and the date close contract
   across
   T3 (added "date"), T5 (added "project", "phase"), T6 (added "priority"), T9 (added
   "assignees", "labels"), T10 (added "kebab") — verifying the whole accumulated state
   machine works, not any single field in isolation

2. Run regression test — verify PASS (this may already pass if each prior task correctly extended
   the same single state variable rather than introducing parallel booleans — verify by
   running, don't assume; if it fails, that reveals an earlier task introduced a
   second/independent open-state instead of extending the shared union):
   `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

3. (Implement fix only if Step 2 failed — consolidate any independent boolean state found back
   into the single "which picker" union, or correct the date-close transition in
   `TrackerRow.tsx`. If this conditional production fix is needed, include it in the task commit;
   otherwise keep this task test-only.)

4. Write regression test for: "Set project" placeholder renders and is clickable when item has no project
   Test file: `client/src/components/tracker/TrackerRow.test.tsx`
   Level: unit
   Test intent: Given a fixture item with `projectId: null`, When `TrackerRow` renders, Then a "Set project" element is present and clicking it opens the project picker
   Exercise through: rendering with the null-project fixture, querying and clicking
   Test doubles: `onProjectChange` as `vi.fn()`
   Regression check: behavior specified and implemented in T5; if it fails, preserve the
   assertion, fix the Row, and rerun.

5. Run test — verify PASS (verify): `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

6. Write regression test for: "Set phase" placeholder, same pattern
   Test file: `client/src/components/tracker/TrackerRow.test.tsx`
   Level: unit
   Test intent: Given a fixture item with a project but `phaseId: null`, When `TrackerRow` renders, Then a "Set phase" element is present and clickable
   Exercise through: same pattern as Step 4, for phase
   Test doubles: `onPhaseChange` as `vi.fn()`
   Regression check: behavior specified and implemented in T5; if it fails, preserve the
   assertion, fix the Row, and rerun.

7. Run test — verify PASS (verify): `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

8. Write regression test for: "Set date" placeholder when both dates unset (Story 1 Example H)
   Test file: `client/src/components/tracker/TrackerRow.test.tsx`
   Level: unit
   Test intent: Given a fixture item with `startDate: null, endDate: null`, When `TrackerRow` renders, Then a "Set date" element is present
   Exercise through: rendering with the null-dates fixture, querying
   Test doubles: `onDateChange` as `vi.fn()`
   Regression check: behavior specified and implemented in T4; if it fails, preserve the
   assertion, fix the Row, and rerun.

9. Run test — verify PASS (verify): `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

10. Write regression test for: two rows keep independent picker state
    Given Row A and Row B both render with editable assignee pickers, When both triggers are
    opened, Then both rows retain their own open popover and choosing a field on Row B does not
    close or mutate Row A's local picker state.

11. Write regression test for: read-only date compatibility and navigation isolation
    Given a Row rendered without `onDateChange`, Then it still renders the existing `createdAt`
    `<time>` value and no date trigger. Given the editable Row, When each representative new
    trigger (date, project, phase, priority, assignee, label, and kebab) is clicked, Then
    `mockNavigate` remains unused. Also assert the new controls, including the kebab trigger and
    its labeled panel, live beneath the
    `pointer-events-auto` content path.

12. Run the complete Row test file — verify PASS:
    `npm run test -- client/src/components/tracker/TrackerRow.test.tsx`

13. Refactor while green: if this test file has accumulated 3+ near-identical fixture-item
    constructions across its tests (from T10's test plus Steps 1-9), extract a shared
    `makeRowItem(overrides)` helper at the top of the file (test-file-local, not exported —
    this is normal test-fixture practice, not a Rule of Three violation of production code)
    Re-run: `npm run test -- client/src/components/tracker/TrackerRow.test.tsx` — must stay PASS

14. Commit:
    If Step 3 required the conditional production fix, stage both
    `client/src/components/tracker/TrackerRow.tsx` and the test; otherwise stage only
    `client/src/components/tracker/TrackerRow.test.tsx`.
    `git commit -m "test(tracker): add unit regression suite for row picker mutex and placeholders"`

15. Run the full repository test suite once, to confirm the entire feature's tests pass together
    (not just each file in isolation):
    `npm run test`
    Expected: all tests PASS, including every file touched across T1-T11. Then run the remaining
    repository gates from the repository root: `npm run typecheck`, `npm run lint`, and
    `npm run build`; all four commands must pass before the plan is marked complete.

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 6 Rule 1, Story 2 Examples A/C, Story 1 Example H
`client/src/components/tracker/TrackerRow.tsx` (post-T10) — the fully-wired component under test

## WHY THIS APPROACH
Complexity: standard
Justification: This is the first point where the accumulated "which picker" state machine (extended incrementally across 6 prior tasks) can be exercised as a whole, and where fast, isolated unit tests (mounting `TrackerRow` directly, not the whole `TrackerPage`) are more appropriate than further integration tests — this is a deliberate test-level choice, not an afterthought.

## SANDWICH CONTEXT
[CRITICAL: This task's tests must render TrackerRow directly (not through TrackerPage) — they are unit tests verifying the row component's own state machine, not integration tests of data fetching or mutation]
You are implementing Task 11 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: dedicated unit-level regression suite, distinct from TrackerPage.test.tsx's integration coverage
Files in scope: `client/src/components/tracker/TrackerRow.test.tsx`
Available after: T10
Architecture rule: unit-level only — render `TrackerRow` directly with mock props, do not render `TrackerPage`
[RESTATE: Render TrackerRow directly, not TrackerPage — this is unit-level verification]

## DELIVERABLE
Given a picker open on a row, When another trigger on the SAME row is clicked, Then the first closes and the second opens
Given two rows have pickers open, When a trigger on one row is used, Then the other row's picker state remains independent
Given item has no project, When row renders, Then "Set project" placeholder is present and clickable
Given item has no phase, When row renders, Then "Set phase" placeholder is present and clickable
Given both dates unset, When row renders, Then "Set date" placeholder is present
Given a read-only Row has no `onDateChange`, When it renders, Then the existing `createdAt` time remains visible and no date trigger exists
Given any new Row trigger is clicked, Then row navigation is not invoked

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Every test in this file renders `TrackerRow` directly, not `TrackerPage`
  - The mutex matrix covers all 8 trigger values, including date commit-before-switch and kebab panel scoping
  - Tests written BEFORE any fixes they reveal are needed
  - Full root `npm run test` run confirms no cross-file regressions

Must-not-have:
  - Re-testing mutation/API/queue behavior already covered in `TrackerPage.test.tsx` (T2, T4, T5, T6, T7, T9) — this file is for the row's own presentational/state-machine logic only
  - Modifications to files outside listed scope

Open question risks:
  - None specific

Rollback note:
  - Test-only additions; safe to revert independently

## STOP CONDITIONS
Done when: all listed DELIVERABLE scenarios pass, the full root test/typecheck/lint/build gate
passes, and the commit is created
Uncertain when: N/A
Escalate when: the full-suite run in Step 15 surfaces a regression in a file this task didn't touch — report which file/test, do not fix it silently within this task's scope

---

## Final verification gate

After T11's feature tests pass, run these commands from the repository root, in order:

```text
npm run test
npm run typecheck
npm run lint
npm run build
```

The plan is not complete until all four commands pass. Record any environment-only blocker
separately from a test or type/lint/build failure; do not silently mark the plan complete.

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-------------------|
| T1 | Shared per-item mutation queue module | prereq | standard | Sequential ordering, per-item isolation, rejection-resilience |
| T2 | Wire status through shared queue | T1 | standard | 3 rapid clicks; synchronized refetch recovery; existing tests unmodified |
| T3 | Build TrackerRowDatePopover + formatDateRange | T1 (∥ T2) | standard | All format/validation branches; every close path; controlled-close commit |
| T4 | Wire date popover into row + page | T3 | standard | Full date-save flow; field-scoped 409 revert; picker-switch preservation |
| T5 | Project/phase inline edit | T4 | standard | Always-visible chips; no-op guard; nullable group keys; group uncollapse |
| T6 | Priority inline edit | T5 | standard | Shared sentinel; nullable No-priority group; no-op and cross-field races |
| T7 | Labels/members isolated eager fetch | T6 (∥ T8) | lightweight | Fetch isolation; workspace reset; failure never blanks list |
| T8 | Toggle-diff resolver helper | T6 (∥ T7) | lightweight | Add/remove/empty-list diff cases |
| T9 | Wire assignee/label pickers | T7, T8 | standard | Race-condition fix — live state at execution time |
| T10 | Mobile kebab menu | T9 | standard | All 6 properties; empty-states; date portal lifecycle; CSS-only breakpoint |
| T11 | TrackerRow.test.tsx unit regression suite | T10 | standard | 8-trigger mutex matrix; placeholders; navigation isolation; full-suite pass |
