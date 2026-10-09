# Task T15 — Unify username wording

**Phase:** 5
**Depends:** T14
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 15: Unify username wording [depends: T14]

## OBJECTIVE
Wording unification (behavior change, user-approved table): `auth/oauth.ts` username message becomes the ASCII form `Username must be 3-32 characters: letters, numbers, underscore.` (same as `auth/router.ts`); export ONE message constant from `auth/auth-schemas.ts` (created in T5) and use it in both routes so the string exists once. Non-object-body wording: the planning-time inventory (`grep -rnE "Invalid request body|must be an object|body must|Invalid body" server/src --include=*.ts`, non-test) found NO drift — only `FOCUS_INVALID_BODY` in `focus-session-parse.ts` and field-level `columns[i] must be an object` in `validators/column.ts` — so nothing changes there. Field-specific messages and non-workspace `Invalid params` stay.

Steps:
1. Write failing test for: the unified wording
   Test file: `server/src/modules/auth/oauth.validation.test.ts` (modify the EN DASH expectation created in T5 to the ASCII message)
   Level: integration (supertest, same doubles as T5)
   Test intent: Given the oauth set-username endpoint (user with `username: null`), When the username is too short or has illegal characters Then 400 `toEqual({ error: "Username must be 3-32 characters: letters, numbers, underscore." })` with an ASCII hyphen (assert the dash char code is 45, not U+2013); Given register (`router.validation.test.ts` case) and oauth with the same invalid username Then the two response bodies are identical.
   Exercise through: HTTP via supertest, same setup as T5
   Test doubles: same as T5 (mock `db/kysely.js`, login limiter, stub `requireAuth` with `username: null`); not the validators
   Expected RED: oauth still returns the EN DASH message today
2. Run — verify FAIL: `npm run test --workspace=server -- src/modules/auth/oauth.validation.test.ts`
3. Implement (commit `fix(server): unify username validation wording`), update any other test pinning the EN DASH (`grep -rn "3–32" server/src client/src`) and list it; run `npm run test --workspace=server -- src/modules/auth` — verify PASS (DB-bound `router.integration.test.ts` needs `RUN_INTEGRATION=1` and a DB if available).

## REFERENCES LOADED
Spec — Rule 6 wording table, scenario "Oauth username wording"; `server/src/modules/auth/oauth.ts`, `auth-schemas.ts` (T5), `oauth.test.ts`, `oauth.validation.test.ts`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: one string unification; the body-wording inventory was resolved at planning time.

## SANDWICH CONTEXT
[CRITICAL: Only the approved wording table may change; the username message becomes the ASCII "3-32" form everywhere and exists as one constant]
You are implementing the remaining wording unification for #198 PR-5.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: approved wording table (Rule 6).
Files in scope: server/src/modules/auth/oauth.ts, server/src/modules/auth/router.ts (switch to the shared message constant), server/src/modules/auth/auth-schemas.ts, server/src/modules/auth/oauth.validation.test.ts
Available after: T14
Architecture rule: `.js` import extensions; no new validation rules.
[RESTATE: Only the listed wording change; list it and the updated tests in the PR description]

## DELIVERABLE
Given invalid oauth username, When submitted, Then the ASCII-hyphen message
Given register vs oauth with the same invalid username, When compared, Then identical bodies
Given `grep "3–32"`, When run, Then zero matches in non-doc source

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - One shared username message constant
  - All tests that pinned the old string updated and listed
Must-not-have:
  - New validation rules
  - Changing field-specific messages
Open question risks:
  - A client test or string match depends on the EN DASH → report NEEDS_CONTEXT instead of editing client source
Rollback note:
  - Revert the wording commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: a user-visible client string depends on the old dash
Escalate when: the wording change would break a client test
