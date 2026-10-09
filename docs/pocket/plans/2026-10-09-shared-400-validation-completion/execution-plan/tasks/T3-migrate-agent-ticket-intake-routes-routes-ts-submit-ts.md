# Task T3 — Migrate agent ticket-intake routes (routes.ts, submit.ts)

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Migrate agent ticket-intake routes (routes.ts, submit.ts) [depends: T1]

## OBJECTIVE
Replace 7 inline 400s: `server/src/modules/agent/ticket-intake/routes.ts` (5) and `submit.ts` (2), behavior-identical.

Sites (message / condition):
- routes.ts: ws not integer → `workspaceId must be an integer` (x3 routes); `message` not a non-blank string → `message is required` (AFTER ws); `req.query.cardId` not integer → `cardId must be an integer` (AFTER ws; query value may be an array — legacy `Number(["1"])` is 1).
- submit.ts: ws not integer → `workspaceId must be an integer`; `parseSubmitBody(req.body)` returns null → `Invalid submit body` (AFTER ws). Use `sendValidationError(res, { error: "Invalid submit body" })` directly where there is no schema; do not rewrite `parseSubmitBody`.

Steps:
1. Write characterization test for: every 400 in the two files
   Test file: `server/src/modules/agent/ticket-intake/routes.validation.test.ts` (new)
   Level: integration (supertest, membership/LLM/Linear deps mocked)
   Test intent: Given the ticket-intake router with mocked `lookupMembership` and services, When each route is called with ws "abc", blank/absent `message`, `cardId=abc`, `cardId=1.5`, a malformed submit body, and ws "abc" together with a bad submit body Then 400 and `res.body` `toEqual({ error: <exact string> })`, ws message first; and Given `cardId` repeated (`?cardId=1&cardId=2`) Then outcome equals today's (pin whatever it is currently: record by running the baseline).
   Exercise through: HTTP via supertest, following the mock setup in `ticket-intake/routes.test.ts`
   Test doubles: mock lookupMembership, LLM, Linear client; do NOT mock validators or handlers
   Expected RED: characterization — passes on current code by design. Prove live: alter one expected string, see FAIL, restore.
2. Run baseline — verify PASS + mutation check: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.validation.test.ts`
3. Migrate the 7 sites preserving order. Run `npm run test --workspace=server -- src/modules/agent/ticket-intake` — verify PASS (existing `routes.test.ts`, `submit.test.ts`, `retry.test.ts` unmodified). Then run `npm run typecheck --workspace=server` and `make check` (lint, architecture and feature-module guards — the #197 AC requires the feature-module guard to pass) — verify PASS. Commit: `refactor(server): route ticket-intake 400s through shared validation helper`

## REFERENCES LOADED
Spec — Rule 1, "Existing tests untouched"; `server/src/modules/agent/ticket-intake/routes.ts`, `submit.ts`, `routes.test.ts`; `server/src/validators/http.ts`, `schemas.ts` (legacyIntegerParam from T1).

## WHY THIS APPROACH
Complexity: standard
Justification: 7 order-sensitive sites incl. a `req.query` array edge case and a non-zod custom body parser.

## SANDWICH CONTEXT
[CRITICAL: Behavior-preserving — identical status, message text, check order and `{ error }`-only body; legacyIntegerParam (not workspaceIdParam) at Number() sites]
You are implementing the ticket-intake 400 migration for #197 PR-1.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: parseWith/sendValidationError + legacyIntegerParam.
Files in scope: server/src/modules/agent/ticket-intake/routes.ts, submit.ts, routes.validation.test.ts
Available after: T1
Architecture rule: agent must not import chat; `.js` import extensions; no cross-feature deep imports.
[RESTATE: No behavior change in status, message, order or body shape]

## DELIVERABLE
Given ws "abc", When any ticket-intake route is called, Then 400 `{ error: "workspaceId must be an integer" }`
Given blank `message`, When posted, Then 400 `{ error: "message is required" }`
Given `cardId=abc`, When requested, Then 400 `{ error: "cardId must be an integer" }`
Given malformed submit body, When posted, Then 400 `{ error: "Invalid submit body" }`
Given the two files, When grepped for `status(400)`, Then zero matches
Given existing ticket-intake tests, When run, Then pass unmodified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Bodies pinned with `toEqual`
  - Array `cardId` behavior pinned to today's outcome
Must-not-have:
  - Rewriting `parseSubmitBody`
  - workspaceIdParam/positiveIdParam use
  - Edits to existing test files
Open question risks:
  - Repeated-query-param behavior unclear → pin observed baseline; if it surprises, report DONE_WITH_CONCERNS
Rollback note:
  - Revert the migration commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: baseline behavior of an edge case is non-deterministic
Escalate when: migration would change an observable status/message
