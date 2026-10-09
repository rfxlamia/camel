# Task T15 — Relocate notifications feature module

**Phase:** 5
**Depends:** T14
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 15: Relocate notifications feature module [depends: T14]

## OBJECTIVE
`git mv` leftover notifications product files into `client/src/features/notifications/` and `server/src/modules/notifications/` with public `index.ts`. `InboxPage.tsx` stays in pages/.

Files:
- Create: `client/src/features/notifications/index.ts` and bodies from `client/src/hooks/useNotifications.ts`, `client/src/context/NotificationsContext.tsx` + tests
  `server/src/modules/notifications/index.ts` and bodies from `server/src/notifications/**`
- Modify: `client/src/pages/InboxPage.tsx` (specifier only), leftover `client/src/layout/AppLayout.tsx` (`NotificationsProvider` via notifications index), leftover `client/src/layout/sidebar/Sidebar.tsx` (`useNotificationsContext` via notifications index), leftover InboxPage/AppLayout tests if they `vi.mock` NotificationsContext, `server/src/routes.ts`, `server/src/index.ts` (notifications init/scheduler), `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] notifications leftovers relocate while InboxPage stays
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover notifications live under hooks/context and server/src/notifications/
   When Cycle Map is evaluated
   Then:
   - `client/src/features/notifications/index.ts` and `server/src/modules/notifications/index.ts` exist
   - leftover `server/src/notifications/router.ts` is gone
   - leftover `client/src/hooks/useNotifications.ts` is gone
   - `client/src/pages/InboxPage.tsx` still exists

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `server/src/modules/notifications/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/modules/notifications/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv`; index barrels; InboxPage specifier-only; leftover AppLayout and Sidebar import the notifications index (`NotificationsProvider` / `useNotificationsContext`); leftover tests that `vi.mock` NotificationsContext retarget; 383-line InboxPage not moved

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/notifications src/pages/InboxPage.test.tsx` and `npm run test --workspace=server -- src/modules/notifications`

5. Refactor while green (bounded):
   - Do not split fat files; revert format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(notifications): relocate notifications into feature modules"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: One FEATURES name per PR; pages stay
server/src/notifications/router.ts — leftover legacy tree

## WHY THIS APPROACH
Justification: Same relocate packet shape; InboxPage is a leftover orchestrator.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: InboxPage stays in pages/; do not close #131; one FEATURES name only]
You are implementing T15 notifications relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T14
Architecture rule: hubs import modules/notifications index only
[RESTATE: InboxPage stays in pages/; do not close #131; one FEATURES name only]

## DELIVERABLE
[derived] Given leftover notifications product files and InboxPage in pages/, When they git-mv into features/notifications and modules/notifications, Then guards pass, test file count is not down, and InboxPage path is unchanged

All tests PASS. Commit exists with message matching `refactor(notifications): relocate notifications into feature modules`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map notifications homes
  - Test file count not reduced
  - PR `refs #131`

Must-not-have:
  - Moving InboxPage into features/
  - `closes #131`
  - Runtime notification behavior changes

Rollback note:
  - Revert the whole notifications packet

## STOP CONDITIONS
Done when: Cycle Map and notifications tests pass
Uncertain when: scheduler/init cannot mount via index without logic change
Escalate when: one-way requires a second FEATURES name
