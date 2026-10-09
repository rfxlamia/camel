# Task T5 — Migrate auth routes (router.ts, oauth.ts)

**Phase:** 2
**Depends:** T2, T3, T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Migrate auth routes (router.ts, oauth.ts) [depends: T2, T3, T4]

## OBJECTIVE
Replace 7 inline 400s in `server/src/modules/auth/router.ts` (5) and `oauth.ts` (2), BYTE-IDENTICAL messages (including oauth's EN DASH "3–32" vs router's ASCII "3-32"). Create `server/src/modules/auth/auth-schemas.ts` with schemas that WRAP the existing functions (`validateUsername`, `USERNAME_RE`, `validateDisplayName`) instead of reimplementing them; the two username checks in router.ts (`validateUsername` invalid, then `USERNAME_RE` mismatch) merge into one schema with the same message.

Sites (message / condition / order):
- router.ts `/register`: (1) `validateUsername(username ?? "")` invalid OR `USERNAME_RE` mismatch → `Username must be 3-32 characters: letters, numbers, underscore.`; (2) password not string or < 8 → `Password must be at least 8 characters.`; (3) `validateDisplayName(displayName ?? "")` invalid → body `{ error: displayNameValidation.error }` (message comes from the validator; NO `fieldErrors`). `req.body` may be undefined (`req.body ?? {}`) — keep tolerance.
- router.ts `/login`: username or password not strings → `Username and password are required.`
- oauth.ts: username invalid → `Username must be 3–32 characters: letters, numbers, underscore.` (EN DASH, unchanged until T15); password not string or < 8 → `Password must be at least 8 characters.`

Steps:
1. Write characterization tests for: every 400 in both files
   Test file: `server/src/modules/auth/router.validation.test.ts` and `server/src/modules/auth/oauth.validation.test.ts` (new; do not edit `oauth.test.ts`)
   Level: integration (supertest; db and bcrypt-heavy paths mocked — validation runs before DB access)
   Test intent: Given the auth router (and the oauth handler) with `db` mocked, When registering with username "ab", username with illegal chars ("a b!"), missing username, undefined body, password "short", non-string password, displayName failing validation, and username+password both invalid Then 400 with `res.body` `toEqual` the exact strings above (no `fieldErrors` key), username message before password before displayName. When logging in with a non-string username or password Then 400 `Username and password are required.`. For oauth: invalid username → EN DASH message; short password → password message.
   Exercise through: HTTP via supertest following `router.integration.test.ts`/`oauth.test.ts` mock setup, but without needing a live DB
   Test doubles: mock `db/kysely.js`; pass a no-op `rateLimiter` to `createAuthRouter`; double the account-lockout limiter used by `/login` (`accountLockoutMiddleware` records attempts in a shared module-level in-memory limiter when Redis is absent — mock `./login-limiter.js` or use a distinct username per case and clear state in `beforeEach`, otherwise later cases can return 429 instead of 400); for the oauth routes (`/set-username`, `/set-password`, behind `requireAuth` and a `req.user.username === null` precheck that otherwise returns 409) replace `requireAuth` with a stub that sets a user whose `username` is `null`, exactly as `oauth.test.ts` does; do NOT mock the validators or schemas
   Expected RED: characterization — passes on current code by design. Prove live via a one-character mutation (e.g. the dash).
2. Run baseline — verify PASS + mutation check: `npm run test --workspace=server -- src/modules/auth/router.validation.test.ts src/modules/auth/oauth.validation.test.ts`
3. Create `auth-schemas.ts`; migrate the 7 sites. Run `npm run test --workspace=server -- src/modules/auth` — verify PASS (existing `oauth.test.ts`, `oauth-bridge*.test.ts`, `login-limiter*.test.ts` unmodified; `router.integration.test.ts` needs a DB — run if available). Then run `npm run typecheck --workspace=server` and `make check` (lint, architecture and feature-module guards — the #197 AC requires the feature-module guard to pass) — verify PASS. Commit: `refactor(server): route auth 400s through shared validation helper`

## REFERENCES LOADED
Spec — Rule 1, "Auth register keeps its message", "Non-object register body keeps today's behavior"; `server/src/modules/auth/router.ts`, `oauth.ts`, `oauth.test.ts`, `server/src/validators/input-length.ts`, `server/src/auth.ts` (USERNAME_RE).

## WHY THIS APPROACH
Complexity: standard
Justification: user-visible messages with intentionally different dashes, a validator-supplied message, order-dependent checks and an undefined-body tolerance.

## SANDWICH CONTEXT
[CRITICAL: Auth messages are user-visible — keep them BYTE-IDENTICAL (oauth EN DASH "3–32" stays; router ASCII "3-32" stays); wording unification belongs to T15]
You are implementing the auth 400 migration for #197 PR-2.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: parseWith/sendValidationError; schemas wrap existing validators; body `{ error }` only.
Files in scope: server/src/modules/auth/router.ts, oauth.ts, auth-schemas.ts, router.validation.test.ts, oauth.validation.test.ts
Available after: T1
Architecture rule: `.js` import extensions; schema file <=300 lines; no new fieldErrors.
[RESTATE: Byte-identical auth messages and check order]

## DELIVERABLE
Given username "ab", When registering, Then 400 `{ error: "Username must be 3-32 characters: letters, numbers, underscore." }`
Given an oauth username that is too short, When submitted, Then 400 with the EN DASH message
Given short password, When registering or setting password via oauth, Then 400 `{ error: "Password must be at least 8 characters." }`
Given undefined `req.body`, When registering, Then same status/text as before the migration
Given displayName failing validation, When registering, Then body equals `{ error: <validator message> }` exactly
Given no `res.status(400)` in the two files, When grepped, Then zero matches
Given existing auth tests, When run, Then pass unmodified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Both username checks in router.ts become one schema with the same message
  - Messages compared with `toEqual` including dash characters
Must-not-have:
  - Changing the EN DASH or any wording
  - Reimplementing validateUsername/validateDisplayName logic
  - Edits to `oauth.test.ts`
Open question risks:
  - Existing tests pin a message in a way the new files do not cover → add cases to the new files, never edit old ones
Rollback note:
  - Revert the migration commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Any message byte differs → STOP

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: undefined-body behavior differs after migration
Escalate when: preserving a message requires reimplementing validator logic
