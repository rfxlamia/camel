# Task T13 — Relocate settings feature module

**Phase:** 5
**Depends:** T12
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 13: Relocate settings feature module [depends: T12]

## OBJECTIVE
`git mv` leftover settings product files into `client/src/features/settings/` and `server/src/modules/settings/` with public `index.ts`. `SettingsPage.tsx` stays in pages/.

Files:
- Create: `client/src/features/settings/index.ts` and bodies from `client/src/components/LogoCropper.tsx`, `client/src/components/settings/ManageMembersSection.tsx`, `client/src/lib/settingsValidation.ts` + tests
  `server/src/modules/settings/index.ts` and body from `server/src/routes/settings.ts` + `settings.test.ts`
- Modify: `client/src/pages/SettingsPage.tsx` (specifier only), leftover `server/src/routes/workspaces.ts` (`checkCanEditSettings` via modules/settings index; leftover → module is allowed), `server/src/routes.ts`, `server/src/index.ts` if it imports `UPLOADS_DIR` from settings, `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] settings product leftovers relocate while SettingsPage stays
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given settings leftovers live under components/settings and routes/settings.ts
   When Cycle Map is evaluated
   Then:
   - `client/src/features/settings/index.ts` and `server/src/modules/settings/index.ts` exist
   - leftover `server/src/routes/settings.ts` is gone
   - `client/src/pages/SettingsPage.tsx` still exists

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/settings/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/settings/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv`; index barrels; SettingsPage 784 lines specifier-only; settings.ts 643 lines specifier-only

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/settings` and `npm run test --workspace=server -- src/modules/settings`

5. Refactor while green (bounded):
   - Do not split SettingsPage or settings.ts; revert fat-file format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(settings): relocate settings into feature modules"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: One FEATURES name per PR; pages stay
server/src/index.ts — may import UPLOADS_DIR from settings

## WHY THIS APPROACH
Justification: Same relocate packet shape for the settings FEATURES name.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: SettingsPage stays in pages/; do not split SettingsPage or routes/settings.ts; refs #131 only]
You are implementing T13 settings relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T12
Architecture rule: hubs import modules/settings index only
[RESTATE: SettingsPage stays in pages/; do not split SettingsPage or routes/settings.ts; refs #131 only]

## DELIVERABLE
[derived — no GWT in spec for settings by name] Given leftover settings product files and SettingsPage in pages/, When they git-mv into features/settings and modules/settings, Then guards pass, test file count is not down, and SettingsPage path is unchanged

All tests PASS. Commit exists with message matching `refactor(settings): relocate settings into feature modules`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map settings homes
  - Test file count not reduced
  - PR `refs #131`

Must-not-have:
  - Moving SettingsPage into features/
  - `closes #131`
  - God-file splits

Rollback note:
  - Revert the whole settings packet

## STOP CONDITIONS
Done when: Cycle Map and settings tests pass
Uncertain when: UPLOADS_DIR wiring cannot use the module index without logic change
Escalate when: one-way requires a second FEATURES name
