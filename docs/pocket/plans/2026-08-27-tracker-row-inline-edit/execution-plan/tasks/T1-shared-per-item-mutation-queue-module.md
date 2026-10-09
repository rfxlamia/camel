# Task T1 — Shared per-item mutation queue module

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
