# Task T8 — Toggle-diff resolver helper

**Phase:** 3
**Depends:** T6
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
