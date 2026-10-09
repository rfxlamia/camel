# Task T2 — Migrate agent board routes (read-routes.ts, routes.ts)

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 2: Migrate agent board routes (read-routes.ts, routes.ts) [depends: T1]

## OBJECTIVE
Replace the 11 inline `res.status(400)` calls in `server/src/modules/agent/read-routes.ts` (6) and `server/src/modules/agent/routes.ts` (5) with `parseWith` + `sendValidationError`, using `legacyIntegerParam` for `Number()`/`Number.isInteger` checks. Status, message text, check order, and body shape (`{ error }` only, no `fieldErrors`) stay byte-identical. `read-routes.ts:64` (`res.status(statusCode)`) is NOT touched.

Sites (message / condition):
- read-routes: ws not integer → `workspaceId must be an integer`; ws OR board not integer → `Invalid params` (x4 routes); invalid `columnSlug` → `Invalid params`.
- routes: ws not integer → `workspaceId must be an integer`; `intent` not a non-blank string → `intent is required` (checked AFTER ws); ws OR board not integer → `Invalid params` (x2); `resolveMessageAction(body).kind === "invalid"` → `message or action is required` (checked AFTER params).

Steps:
1. Write characterization test for: every 400 in the two files
   Test file: `server/src/modules/agent/routes.validation.test.ts` (new)
   Level: integration (supertest over the real routers, service and membership mocked)
   Test intent: Given the routers registered with mocked service and mocked `assertWorkspaceMember`, When each route is called with: ws "abc"; ws "1.5"; ws/board "abc"; invalid columnSlug; blank/non-string/absent `intent`; invalid message/action body; and BOTH an invalid ws and a missing intent Then the response is 400 with `res.body` `toEqual({ error: <exact string above> })` and the first failing check wins (ws message before intent message). Also Given ws "1e2" or "0" Then request is NOT rejected with 400 (legacy leniency preserved; membership mock is reached).
   Exercise through: HTTP via supertest, following the setup in `read-routes.test.ts` (mock `../../auth.js` requireAuth and `./membership.js`)
   Test doubles: mock requireAuth, assertWorkspaceMember, service methods; do NOT mock the route handlers or validators
   Expected RED: characterization — passes on current code by design. Prove it is live: change one expected string, see FAIL, restore.
2. Run baseline — verify PASS and the mutation check: `npm run test --workspace=server -- src/modules/agent/routes.validation.test.ts`
3. Migrate the 11 sites (pattern: `const ws = parseWith(legacyIntegerParam("workspaceId must be an integer"), req.params.workspaceId); if (!ws.ok) return sendValidationError(res, ws.body);`; for the combined ws/board check use a `z.object` or two parses with `{ message: "Invalid params" }`), preserving order. Run: `npm run test --workspace=server -- src/modules/agent` — verify PASS (includes unchanged `read-routes.test.ts`, `routes.test.ts`, `routes.error-handling.test.ts`). Then run `npm run typecheck --workspace=server` and `make check` (lint, architecture and feature-module guards — the #197 AC requires the feature-module guard to pass) — verify PASS. Commit: `refactor(server): route agent board 400s through shared validation helper`

## REFERENCES LOADED
Spec — Rule 1, scenarios "Agent read route keeps pinned string", "Existing tests untouched", "Phase 1-2 keep lenient workspace id semantics"; `server/src/modules/agent/read-routes.ts`, `routes.ts`, `read-routes.test.ts`; `server/src/modules/settings/settings.validation.test.ts` (characterization pattern); `server/src/validators/http.ts`.

## WHY THIS APPROACH
Complexity: standard
Justification: 11 sites with order-sensitive checks and a combined-condition message; judgment needed to keep `Invalid params` semantics and check order identical.

## SANDWICH CONTEXT
[CRITICAL: Migration is behavior-preserving — same status, same message text, same check order, `{ error }` body only; do NOT use workspaceIdParam/positiveIdParam here]
You are implementing the agent board-route 400 migration for #197 PR-1.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: parseWith/sendValidationError + legacyIntegerParam; characterization tests pin bodies with toEqual.
Files in scope: server/src/modules/agent/read-routes.ts, server/src/modules/agent/routes.ts, server/src/modules/agent/routes.validation.test.ts
Available after: T1
Architecture rule: agent must not import chat; imports use `.js` extensions; validation stays before any service call.
[RESTATE: No behavior change — messages, order, status codes and body shape identical to today]

## DELIVERABLE
Given ws "abc" on any agent board route, When called, Then 400 `{ error: "workspaceId must be an integer" }` (or `Invalid params` where the route used the combined check)
Given blank `intent`, When posted, Then 400 `{ error: "intent is required" }`
Given invalid ws AND missing intent, When posted, Then the ws message wins
Given ws "1e2", When called, Then no 400 from validation (legacy leniency)
Given no `res.status(400)` in the two files, When grepped, Then zero matches
Given `read-routes.test.ts`, `routes.test.ts`, `routes.error-handling.test.ts`, When run, Then they pass unmodified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Each migrated site body pinned with `toEqual({ error })`
  - `grep -n "status(400)" server/src/modules/agent/read-routes.ts server/src/modules/agent/routes.ts` returns nothing
Must-not-have:
  - Any use of workspaceIdParam/positiveIdParam
  - Changes to `read-routes.ts:64` dynamic status
  - New `fieldErrors` keys
  - Edits to existing test files
Open question risks:
  - A route's real path/handler wiring differs from the assumption → report NEEDS_CONTEXT, do not guess
Rollback note:
  - Revert the migration commit; characterization test stays valid
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Message or order changed → STOP

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: a legacy edge case (array/empty query) behaves differently after migration
Escalate when: preserving behavior requires touching `read-routes.ts:64` or another out-of-scope file
