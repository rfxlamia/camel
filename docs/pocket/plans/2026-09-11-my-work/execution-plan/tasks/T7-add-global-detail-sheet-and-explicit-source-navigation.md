# Task T7 — Add global detail sheet and explicit source navigation

**Phase:** 2
**Depends:** T6
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Add global detail sheet and explicit source navigation [depends: T6]

## OBJECTIVE

Provide URL-addressable global read/detail behavior that reauthorizes access, never changes the active workspace on row selection, and uses existing workspace/focus/unsaved-edit guards for explicit Board/Tracker navigation.

Files:

- Create: `client/src/components/my-work/MyWorkDetailSheet.tsx`
- Create: `client/src/lib/myWorkNavigation.ts`
- Modify: `client/src/pages/MyWorkPage.tsx`
- Create: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`

Steps:

1. Write failing test for: global detail preserves active workspace and URL state.
   Test file: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Level: component
   Test intent: Given Orbit active and AT-17 in Atlas, when detail opens/closes, then Atlas context is shown, Orbit remains active, and filters/page restore.
   Exercise through: MemoryRouter/detail/BoardContext seam.
   Test doubles: fake detail response/context; do not mock detail/URL helper.
   Expected RED: detail sheet does not exist.

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement detail sheet and route-state helper.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: stale detail reauthorization hides cached content.
   Test file: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Level: component/integration
   Test intent: Given access revoked after list load, when detail is requested, then unavailable appears without cached content/source action.
   Exercise through: detail API error boundary.
   Test doubles: fake unauthorized detail response; do not mock unavailable UI.
   Expected RED: reauthorization behavior is absent.

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement unavailable/error mapping.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: explicit source navigation uses existing guard.
   Test file: `client/src/components/my-work/MyWorkDetailSheet.test.tsx`
   Level: component/integration
   Test intent: Given non-active source item, when Open in Board/Tracker is selected with allowed/blocked/canceled guard, then only allowed transition navigates and blocked state is preserved.
   Exercise through: detail action/BoardContext guard.
   Test doubles: fake API/session inputs only; mount the real BoardContext focus/unsaved guard and router transition boundary.
   Expected RED: source guard behavior is absent.

10. Run test — verify FAIL:
   `npm run test --workspace=client -- src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement explicit source transition and page wiring.

12. Run test — verify PASS:
   `npm run test --workspace=client -- src/components/my-work/MyWorkDetailSheet.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

14. Commit:
   git add client/src/components/my-work/MyWorkDetailSheet.tsx client/src/lib/myWorkNavigation.ts client/src/pages/MyWorkPage.tsx client/src/components/my-work/MyWorkDetailSheet.test.tsx
    git commit -m "feat(my-work): add global detail navigation"

## REFERENCES LOADED

- Spec global detail, reauthorization, source navigation, and guard scenarios.
- `client/src/pages/TrackerDetailPage.tsx` — existing detail loading and event/error conventions.
- `client/src/components/ContextPanel.tsx` — closest existing detail-panel pattern; Board cards open through the nested `/board/card/:cardId` route using the numeric source-row id.
- `client/src/context/BoardContext.tsx` — workspace switch/focus/unsaved-edit guard callbacks.
- `client/src/App.tsx` and React Router docs — route/search-state behavior.

## WHY THIS APPROACH

Complexity: standard
Justification: Detail and source navigation have different authorization and transition semantics from list rendering; isolating them prevents silent workspace changes.

## SANDWICH CONTEXT

[CRITICAL: Selecting a row must never silently change activeWorkspaceId; only explicit source navigation may invoke existing workspace guards.]
You are implementing global read detail for My Work.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: global detail first, explicit guarded source navigation second.
Files in scope: detail sheet, navigation helper, My Work page wiring, and the detail test.
Available after: T6.
Architecture rule: reauthorize detail on the server and reuse existing focus/unsaved-edit guards.
[RESTATE: Selecting a row must never silently change activeWorkspaceId; only explicit source navigation may invoke existing workspace guards.]

## DELIVERABLE

Given a non-active workspace item, when its row is selected, then global detail opens without changing the active workspace.
Given access is revoked before detail, when detail is requested, then unavailable is shown without cached content.
Given source navigation is blocked, when the user cancels, then My Work state remains unchanged.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Detail tests cover global read, reauthorization failure, URL restoration, successful guarded transition, and blocked transition.
- Workspace/source identity is visible before navigation.
- Source navigation targets are explicit: Board → `/board/card/:cardId` (numeric source-row id, not the display key) and Tracker → `/tracker/:key`, both only after the workspace guard for non-active workspaces.

Must-not-have:

- No automatic workspace switch on row click.
- No detail cache rendered after server reauthorization failure.
- No direct mutation API calls.

Open question risks:

- Exact nested route versus query detail state may change route wiring without changing behavior.

Rollback note:

- Remove the detail sheet and route state; the list can remain read-only.

## STOP CONDITIONS

Done when: detail/guard tests pass and no row selection mutates activeWorkspaceId.
Uncertain when: existing guard callbacks cannot be safely reused from a global page.
Escalate when: implementing global detail requires weakening workspace authorization.
