# Task T3 — Map agent guard errors to stable HTTP 503

**Phase:** 1
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Map agent guard errors to stable HTTP 503 [depends: T2]

## OBJECTIVE

**Regression baseline (write/run before any route implementation edits; these checks are expected to PASS today and are not RED cycles):** In `server/src/modules/agent/routes.test.ts`, independently characterize: no-pending regenerate confirmation returns existing no-op; unauthenticated request is 401; malformed route input is 400; non-member/missing board are 404; non-owner is 403; with switch disabled, invalid state is 409; unrelated service error keeps global handler response; and switch-off create preserves 201 behavior. Level: integration through Express/Supertest. Test doubles: use test auth/member/service state needed for each case; keep route, validator, mapper, and middleware real. Run `npm run test --workspace=server -- src/modules/agent/routes.test.ts` before any route source edit and confirm all baseline cases pass. Rerun after mapping changes.

1. Write a failing cross-unit create-board denial test using the real service and HTTP route.
   Test file: `server/src/modules/agent/routes.test.ts`  
   Level: integration  
   Test intent: Given switch enabled and valid authenticated member create input, When the real `createAgentBoardService` behind `createAgentRouter` invokes the shared guard, Then production-mode response is exactly HTTP 503 JSON `{ "error": "Agent spend is disabled by kill switch", "code": "AGENT_SPEND_KILL_SWITCH" }`, classifier is not called, and no board/conversation/column/event is written.  
   Exercise through: `createAgentRouter` mounted in Express with `createErrorHandler`, Supertest, and runtime config loaded with the switch enabled.  
   Test doubles: Mock auth/membership and inject spies for classifier/persistence/events through service dependency overrides; do not mock the service, guard, or router. No DB/LLM/network.  
   Expected RED: T2 service guard rejects, but the current HTTP boundary does not map its typed error to exact 503.
2. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
3. Add narrow typed mapping at create boundary; verify PASS; refactor while green.
4. Write a failing approval route mapping test.
   Test file: `server/src/modules/agent/routes.test.ts`  
   Level: integration  
   Test intent: Given valid owned pending board and switch enabled, When approval service throws typed guard error, Then exact HTTP 503 body is returned and pipeline is not started.  
   Exercise through: approve endpoint with real router dispatch.  
   Test doubles: Mock auth/membership, board/service result and pipeline; keep router/error mapper real.  
   Expected RED: approval rejection currently reaches generic handling rather than stable 503.
5. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
6. Add narrow mapping at approval boundary; verify PASS; refactor while green.
7. Write a failing message/confirmation route mapping test.
   Test file: `server/src/modules/agent/routes.test.ts`  
   Level: integration  
   Test intent: Given a valid spend-bearing board message and switch enabled, When service throws the typed error, Then exact HTTP 503 JSON is returned and no user/assistant message, board state change, event, or LLM call occurs.  
   Exercise through: board message endpoint.  
   Test doubles: Mock auth/membership and board state; spy message/state/event/LLM dependencies; keep route dispatch and mapper real.  
   Expected RED: route currently has no typed-error mapping around message service calls.
8. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
9. Do not edit the shared message-route boundary yet; keep this denial test red until the pending-confirmation denial test also fails.
10. Write a failing pending-confirmation HTTP mapping test.
   Test file: `server/src/modules/agent/routes.test.ts`  
   Level: integration  
   Test intent: Given pending regenerate intent and valid owned board while guard rejects, When confirmation route is called, Then exact 503 JSON is returned and no pending intent/state mutation/pipeline occurs.  
   Exercise through: agent message route with `confirm_regenerate` action.  
   Test doubles: Mock auth/membership and pending service state/side effects; keep route mapping real.  
   Expected RED: typed service rejection currently does not produce the stable response.
11. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
12. After both the spend-bearing message and pending-confirmation denial tests have failed against the unchanged route boundary, map only the typed error in the shared message handler for both branches; preserve DB-only/no-pending outcomes. Run `npm run test --workspace=server -- src/modules/agent/routes.test.ts` and verify both denial cases pass; refactor while green.
13. Rerun prewritten no-pending confirmation regression with switch enabled; verify successful no-op response and no 503.
14. Run regression: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
15. Confirm no-pending behavior remains green; this is not a RED cycle.
16. Rerun prewritten unauthenticated-request regression; verify exact existing HTTP 401 response/body precedes service invocation.
17. Run regression: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
18. Confirm auth precedence remains green; this is not a RED cycle.
19. Rerun prewritten malformed-input regression; verify exact existing HTTP 400 response/body and no service call.
20. Run regression: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
21. Confirm validation precedence remains green; this is not a RED cycle.
22. Rerun prewritten non-member/missing-board regression cases independently; verify existing HTTP 404 response/body wins before guard.
23. Run regression: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
24. Confirm each 404 path remains green; this is not a RED cycle.
25. Rerun prewritten non-owner regression; verify exact existing HTTP 403 response/body wins before guard.
26. Run regression: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
27. Confirm ownership precedence remains green; this is not a RED cycle.
28. Rerun prewritten invalid-state regression with switch disabled; verify exact current HTTP 409 response/body remains unchanged. Do not assert 409 precedence when switch is enabled, because the spec places the guard before the atomic approval update.
29. Run regression: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
30. Confirm switch-off state behavior remains green; this is not a RED cycle.
31. Rerun prewritten unrelated-error regression; verify ordinary service error still reaches existing global response/logging and is not mapped to 503.
32. Run regression: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
33. Confirm unrelated error behavior remains green; this is not a RED cycle.
34. Rerun prewritten default-off create regression; verify current HTTP 201 success response/body remains unchanged.
35. Run regression: `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
36. Confirm disabled response remains green; commit `fix(agent): preserve route errors and map spend guard`.

## REFERENCES LOADED

- Spec rules Deny new spend and Access/validation precedence; agent route mapping notes.
- `server/src/modules/agent/routes.ts`, `routes.test.ts`, `routes.error-handling.test.ts`, `route-validation.ts`, `membership.ts`, `server/src/middleware/error-handler.ts`.
- Express `5.2.1` (lockfile-resolved); official error handling guide `https://expressjs.com/en/guide/error-handling.html`; Context7 not available. Existing route/error tests show Supertest boundary patterns. Supertest `7.2.2` and Vitest `4.1.10` are installed; no unfamiliar APIs are proposed.

## WHY THIS APPROACH

Complexity: standard.  
Justification: Exact wire behavior is a cross-unit contract between agent service, router, and global error handling, and must be observed at HTTP level in production mode.

## SANDWICH CONTEXT

[CRITICAL: Map only the typed kill-switch error explicitly at the HTTP boundary; preserve all current auth, validation, membership, and access precedence.]  
You are implementing the agent HTTP response boundary for the Global Agent Spend Kill Switch.  
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
Design decision: typed assertion shared in agent; explicit error mapping in each HTTP surface.  
Files in scope: `server/src/modules/agent/routes.ts`, `server/src/modules/agent/routes.test.ts`; depends on T1 shared API and T2 service guards.  
Architecture rule: Unrelated exceptions continue to global error handling; error body must be stable in production, not development-only.  
[RESTATE: Map only the typed kill-switch error explicitly at the HTTP boundary; preserve all current auth, validation, membership, and access precedence.]

## DELIVERABLE

Given a valid member request that would start agent LLM work, When the guard rejects, Then HTTP 503 contains exactly both stable fields.  
Given invalid or unauthorized input, When the switch is on, Then the existing response wins.  
Given an unrelated failure, When it reaches the route boundary, Then existing global error handling remains in effect.

## QUALITY BAR

Must-have:
- Assert exact status and body in production mode for create, approval, and message/confirmation spend branches.
- Only typed kill-switch errors are mapped; errors from other causes continue normally.
- Preserve middleware, schema, membership, ownership, and no-op ordering.

Must-not-have:
- No broad catch that converts unrelated failures; no contract changes to other errors.

Open question risks:
- No unresolved user decision. Kill switch response remains only for valid authorized spend requests.

Rollback note:
- Revert route mapping/tests; no persistent data change.

Red flags:
- Error mapping based on message text or broad 503 catch → STOP.

## STOP CONDITIONS

Done when production-mode Supertest cases prove exact body and precedence.  
Uncertain when route returns an existing discriminated result rather than throwing the typed error; preserve its existing contract unless spec explicitly requires the guard.  
Escalate if mapping requires changing global sanitizer semantics.
