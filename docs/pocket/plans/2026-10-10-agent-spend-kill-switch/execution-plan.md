# EXECUTION PLAN — Global Agent Spend Kill Switch

**Date:** 2026-10-10
**Spec:** docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md
**Status:** draft
**Total tasks:** 7

---

## Execution Overview

### Recommended Order
```
T1 → T2 → T3; T4, T5, T6, T7 can run in parallel after T1
```

> Dependency order above is recommended; pocket skill enforces actual parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T4, T5, T6, T7 | T1 completes |
| Group B | T3 | T2 completes |

### Constraints Reminder
**Architecture:** Keep the shared guard in `server/src/modules/agent/`; export cross-feature APIs only through `server/src/modules/agent/index.ts`. Put assertions at spend-entry boundaries before domain writes, pending-regenerate claims, stream headers, or new LLM work. Guard direct pipeline methods at invocation start; do not add mid-run checks. Preserve NodeNext `.js` imports, `recordActivity()` behavior on existing mutations, and error precedence. Do not deep-import agent feature files from chat.
**Out-of-scope:** No client/UI, DB/schema/migration, quota/meter/dashboard/admin endpoint, cancellation of in-flight work, SDK/`runChatTurn` guard, or CI/grep guard for future call sites. Do not change existing rate-limit semantics.
**Assumptions at risk:** Config is startup-only; deployment uses Docker Compose v2 and changing env requires server recreation which may interrupt active runs. Ticket-not-configured response and existing validation/access/rate-limit errors remain first. Pending regenerate denial is tested with an isolated controllable assertion, not a claim that production env hot-reloads.
**Sequencing:** T2 and T3 both touch agent HTTP boundaries; T3 waits for T2 to prevent overlapping route edits. T4–T7 touch separate modules/files and may proceed after the shared contract in T1.

### File Structure Map

```
Rule: Default-off flag and shared typed denial contract
  Create: server/src/modules/agent/spend-kill-switch.ts (created by: T1)
  Create: server/src/modules/agent/spend-kill-switch.test.ts (created by: T1)
  Modify: server/src/config.ts
  Modify: server/src/modules/agent/index.ts
  Test:   server/src/__tests__/config.test.ts

Rule: Deny board creation and approval before spend/state changes
  Modify: server/src/modules/agent/service.ts
  Modify: server/src/modules/agent/routes.ts
  Create: server/src/modules/agent/spend-kill-switch.service.test.ts (created by: T2)
  Create: server/src/modules/agent/routes.spend-kill-switch.test.ts (created by: T2)

Rule: Deny board conversation and regenerate spend while preserving no-op/DB-only paths
  Modify: server/src/modules/agent/board-conversation.ts
  Modify: server/src/modules/agent/routes.ts
  Create: server/src/modules/agent/spend-kill-switch.conversation.test.ts (created by: T3)
  Create: server/src/modules/agent/spend-kill-switch.regenerate-concurrency.test.ts (created by: T3)
  Test:   server/src/modules/agent/routes.spend-kill-switch.test.ts

Rule: Direct pipeline entrypoints reject only new work
  Modify: server/src/modules/agent/pipeline.ts
  Create: server/src/modules/agent/spend-kill-switch.pipeline.test.ts (created by: T4)

Rule: Chat send/retry denied before stream and persistence
  Modify: server/src/modules/chat/message-stream.ts
  Create: server/src/modules/chat/message-stream.send-kill-switch.test.ts (created by: T5)
  Create: server/src/modules/chat/message-stream.retry-kill-switch.test.ts (created by: T5)
  Test:   server/src/modules/chat/routes.test.ts

Rule: Ticket extraction denied while first classifier turn stays available
  Modify: server/src/modules/agent/ticket-intake/routes.ts
  Test:   server/src/modules/agent/ticket-intake/routes.test.ts

Rule: Operator configures and recreates production server
  Modify: server/.env.example
  Modify: deploy/.env.production.template
  Modify: deploy/docker-compose.prod.yml
  Create: deploy/README.md (created by: T7)
```

## Pocket Packets

---

### Task 1: Add startup config and shared spend-denial contract [prereq]

## OBJECTIVE

Establish the single flag and agent-owned assertion/error contract required by all spend boundaries. Export its public API only from `modules/agent/index.ts`. If the three HTTP surfaces need identical response mapping, provide one narrow response helper that recognizes only this typed error; each boundary must still explicitly invoke it in its own catch path. Do not add a generic server utility or import agent internals from another feature.

1. Write failing tests for:
   - Config behavior using the existing `resolveConfig`/module-reload convention: absent and `false` resolve to off; `true` resolves to on; any other string fails the existing enum validation. Test file: `server/src/__tests__/config.test.ts`. Level: unit. Test intent: Given each env value, When config is resolved, Then the flag is default-off / reflects the valid value / rejects invalid values. Exercise through: config resolver and exported config. Test doubles: isolate env and module cache only; do not mock Zod or the config resolver. Expected RED: the current schema has no `AGENT_SPEND_KILL_SWITCH` field, so the new property/value assertions fail.
   - Shared assertion/error behavior. Test file: `server/src/modules/agent/spend-kill-switch.test.ts`. Level: unit. Test intent: Given the switch is off, When the assertion runs, Then it returns normally; Given it is on, When the assertion runs, Then it throws a recognizable typed error with stable message and code `AGENT_SPEND_KILL_SWITCH`. Exercise through: the public assertion/error API exported by the agent module. Test doubles: mock only the config module value; do not mock the assertion or error. Expected RED: no shared assertion/type currently exists, and no enabled-switch denial contract can be observed.
2. Run and verify the focused tests fail for those behavioral assertions (not because of unrelated setup): `npm run test --workspace=server -- src/__tests__/config.test.ts src/modules/agent/spend-kill-switch.test.ts`.
3. Implement config, the new domain-scoped helper, focused unit tests, and `index.ts` exports; run the same command to verify PASS. Refactor while green. Commit: `feat(agent): add spend kill switch contract`.
4. Regression check (not an artificial RED): verify config without the variable and with `false` continues to allow the existing default path. Record that this is expected to pass before the guard is wired into call sites; do not manufacture a failure.

## REFERENCES LOADED
- `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md` — Rules 1, 2, and acceptance verification; exact error contract and startup-only semantics.
- `server/src/config.ts`, `server/src/__tests__/config.test.ts` — Zod enum/default and env isolation patterns.
- `server/src/modules/agent/index.ts` — agent module public API boundary.
- `server/src/modules/agent/service.test.ts` — existing service test style.
- `server/package.json` — Zod 4.4.3, Vitest 4.1.10; Zod enum guidance checked against official docs and `v4.4.3` release. No new dependency.
- External docs gap: Context7 unavailable. No new Zod API is proposed; the enum/default API already used in this repository is retained. No material behavior beyond that established pattern is assumed.

## WHY THIS APPROACH
Complexity: standard.
Justification: This task anchors config, a public feature-module contract, and a stable typed error needed by independently implemented HTTP boundaries.

## SANDWICH CONTEXT
[CRITICAL: Shared agent-spend APIs must be exported cross-feature only through `server/src/modules/agent/index.ts`; no chat-to-agent deep import or agent-to-chat dependency.]
You are implementing the shared prerequisite for the Global Agent Spend Kill Switch.
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`
Design decision: Option B — one typed assertion at spend entry points; explicit narrow HTTP mapping at each boundary.
Files in scope: `server/src/config.ts`, `server/src/__tests__/config.test.ts`, `server/src/modules/agent/spend-kill-switch.ts`, `server/src/modules/agent/spend-kill-switch.test.ts`, `server/src/modules/agent/index.ts`.
Available after: none (prerequisite).
Architecture rule: server imports use NodeNext `.js` extensions; keep the helper domain-scoped and under the feature module.
[RESTATE: Shared agent-spend APIs must be exported cross-feature only through `server/src/modules/agent/index.ts`; no chat-to-agent deep import or agent-to-chat dependency.]

## DELIVERABLE
Given `AGENT_SPEND_KILL_SWITCH` is absent or `false`, When config resolves, Then spend remains allowed by default.
Given the flag is `true`, When the shared assertion runs, Then a typed denial with stable message/code is raised.
Given the flag has any value other than `true` or `false`, When config resolves, Then existing fail-fast enum validation rejects it.

## QUALITY BAR
Must-have:
  - Default exactly to `false`; accept only string values `true` and `false`.
  - One typed error/assertion contract; expose cross-feature symbols through agent `index.ts` only.
  - Keep test code out of this plan; the implementer writes tests during the RED step.
  - TDD for new denial behavior; existing default behavior is a baseline regression check and must not be given a fake RED.
Must-not-have:
  - No generic `utils.ts`, client changes, schema/migrations, new dependencies, or in-flight cancellation.
Open question risks:
  - Startup-only env and Compose v2 recreation assumptions remain as in the spec; if either proves false, report NEEDS_CONTEXT.
Rollback note:
  - Remove the flag/helper/export and revert config changes; no data rollback. Recreating the server can interrupt active runs.

## STOP CONDITIONS
Done when: config cases and shared assertion tests pass; only listed files changed.
Uncertain when: Zod's existing enum/default pattern does not produce the validated values documented by the spec.
Escalate when: cross-feature use requires a deep import or a generic helper outside the agent module.

---

### Task 2: Gate board creation and approval at the agent HTTP boundary [depends: T1]

## OBJECTIVE

Protect create and approve service entrypoints before any classifier/detector, DB mutation, activity/event write, or pipeline start; map the typed error to the exact HTTP 503 JSON at the route boundary. Preserve ownership/workspace/validation precedence.

1. Write failing tests for:
   - Board creation denial. Test file: `server/src/modules/agent/spend-kill-switch.service.test.ts`. Level: unit. Test intent: Given switch on and an authorized valid intent, When the real board service handles creation, Then typed denial occurs before classifier and board/conversation/column/event writes. Exercise through: `createAgentBoardService` public method. Test doubles: fake classifier, DB/dependency methods, and event publisher; do not mock the service or assertion. Expected RED: current service invokes the classifier and proceeds with persistence because it has no guard.
   - Approval denial. Test file: `server/src/modules/agent/spend-kill-switch.service.test.ts`. Level: unit. Test intent: Given an owned pending board and switch on, When the real service approves it, Then denial occurs before status-period detection, atomic status update, event, or pipeline work and the board remains pending. Exercise through: real service `approveBoard`. Test doubles: fake board lookup/update, detector, and publisher; do not mock the service. Expected RED: the current service runs the detector/update without the switch.
   - Create HTTP denial through the real service. Test file: `server/src/modules/agent/routes.spend-kill-switch.test.ts`. Level: integration (Supertest through Express router). Test intent: Given a valid authenticated member and switch on, When board creation is requested, Then, in a test app configured as production with the global error handler mounted, exact HTTP 503 JSON `{ "error": "Agent spend is disabled by kill switch", "code": "AGENT_SPEND_KILL_SWITCH" }` is returned with no extra fields, and each real-service boundary is independently verified untouched: classifier, `insertBoard`, `insertConversation`, `insertColumns`, activity/event writes, and pipeline start. Exercise through: `createAgentRouter(overrides)` with the real service and real assertion. Test doubles: auth/membership and spyable external DB/LLM/event dependencies; do not mock router, service, or guard. Expected RED: current handler reaches the classifier and does not return the specified denial.
   - Approval HTTP denial through the real service. Test file: `server/src/modules/agent/routes.spend-kill-switch.test.ts`. Level: integration. Test intent: Given an owned pending board and switch on, When approval is requested, Then, in a production-configured test app with the global error handler mounted, exact HTTP 503 JSON `{ "error": "Agent spend is disabled by kill switch", "code": "AGENT_SPEND_KILL_SWITCH" }` is returned with no extra fields, and each relevant boundary is independently verified untouched: status-period detector, status update, activity/event writes, and route-triggered `runPipeline`; malformed/non-member access regressions retain their existing 400/403 response. Exercise through: `createAgentRouter(overrides)` with real service/assertion. Test doubles: auth/membership and spyable external DB/LLM/event dependencies only; do not mock route, service, or guard. Expected RED: current handler performs service work and returns success or normal error rather than the contract 503.
2. Run focused failures: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.service.test.ts src/modules/agent/routes.spend-kill-switch.test.ts`.
3. Write a malformed-request precedence regression. Test file: `server/src/modules/agent/routes.spend-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and malformed workspace/board/body input, When the endpoint is called, Then the existing HTTP 400 response remains before the spend assertion. Exercise through: public agent HTTP routes. Test doubles: auth and membership only as needed; keep validation and real route/service/guard active. Expected RED: none expected; this is preserved behavior.
4. Run this precedence regression: `npm run test --workspace=server -- src/modules/agent/routes.spend-kill-switch.test.ts`.
5. Write an authentication precedence regression. Test file: `server/src/modules/agent/routes.spend-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and no authenticated user, When create/approve is requested, Then the existing HTTP 401 wins before membership or spend admission. Exercise through: public agent HTTP route. Test doubles: auth boundary only; keep route/guard real. Expected RED: none expected; preserve existing middleware behavior.
6. Run this authentication regression: `npm run test --workspace=server -- src/modules/agent/routes.spend-kill-switch.test.ts`.
7. Write a membership/access precedence regression. Test file: `server/src/modules/agent/routes.spend-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and the user is not a workspace member or does not own/access the board, When create/approve is requested, Then the existing 403/404 response wins before spend admission. Exercise through: public route and real service ownership checks. Test doubles: auth/membership and external persistence only; do not mock route/service/guard. Expected RED: none expected; preserve existing access behavior.
8. Run this membership/access regression: `npm run test --workspace=server -- src/modules/agent/routes.spend-kill-switch.test.ts`.
9. Write a default-off board create/approve regression. Test file: `server/src/modules/agent/routes.spend-kill-switch.test.ts`. Level: integration. Test intent: Given switch off and valid authorized create/approve requests, When requests are made through the router, Then current successful behavior is preserved. Exercise through: public route and real service. Test doubles: external DB/LLM/event boundaries only; do not mock route/service/guard. Expected RED: none expected; do not manufacture a failure.
10. Run the default-off regression: `npm run test --workspace=server -- src/modules/agent/routes.spend-kill-switch.test.ts`.
11. Add assertions before spend-bearing effects and explicit route handling for typed denial. Keep route error handling narrow so unrelated errors retain current behavior. Re-run focused denial and regression files to verify PASS; refactor while green. Commit: `feat(agent): gate board creation and approval`.

## REFERENCES LOADED
- `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md` — board creation, approval, exact body, error precedence, no-write rules.
- `server/src/modules/agent/service.ts` — `createBoard`, `approveBoard`, dependency injection and mutation ordering.
- `server/src/modules/agent/routes.ts` — `createAgentRouter(overrides)`, validation/membership order, route handling and pipeline launch.
- `server/src/modules/agent/service-deps.ts`, `server/src/modules/agent/service.test.ts` — service dependency/test patterns.
- `server/src/modules/agent/routes.validation.test.ts`, `server/src/modules/agent/routes.error-handling.test.ts` — Express/Supertest route patterns and preserved errors.
- `server/package.json` — Express 5.2.1, Supertest 7.2.2, Vitest 4.1.10. External documentation not version-pinned/fully verified for these test APIs; repository tests establish local conventions, and the task introduces no new API usage. Keep risk limited to established APIs.

## WHY THIS APPROACH
Complexity: standard.
Justification: Service ordering and HTTP error mapping must jointly preserve no-write and error-precedence guarantees; the route test crosses the real router/service seam.

## SANDWICH CONTEXT
[CRITICAL: An authorized create/approve denial must happen before any domain write or pipeline launch; 400/403 access and validation outcomes still take precedence.]
You are implementing the board create/approve portion of the Global Agent Spend Kill Switch.
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`
Design decision: Use the T1 typed assertion and explicit boundary mapping.
Files in scope: `server/src/modules/agent/service.ts`, `server/src/modules/agent/routes.ts`, `server/src/modules/agent/spend-kill-switch.service.test.ts`, `server/src/modules/agent/routes.spend-kill-switch.test.ts`.
Available after: T1 shared config/error API.
Architecture rule: Keep auth, params/body validation, workspace membership, ownership, and existing access checks ahead of the assertion; NodeNext imports use `.js`.
[RESTATE: An authorized create/approve denial must happen before any domain write or pipeline launch; 400/403 access and validation outcomes still take precedence.]

## DELIVERABLE
Given switch on and a valid authorized board intent, When creation is requested, Then exact HTTP 503 is returned before classifier or any board/conversation/column/event write.
Given switch on and an owned pending board, When approval is requested, Then exact HTTP 503 is returned before optional period detection, status/event mutation, or pipeline launch.
Given a malformed create/approve request and switch on, When the route is called, Then the existing 400 response remains first.
Given the caller is unauthenticated and switch is on, When the route is called, Then the existing 401 response remains first.
Given the caller lacks workspace membership or board access and switch is on, When the route is called, Then the existing 403/404 response remains first.

## QUALITY BAR
Must-have:
  - Test through the real service and route with fakes only at external persistence/LLM/event boundaries.
  - Verify no persistence/event/pipeline calls for denied create/approve.
  - Map only the typed kill-switch error to exact 503; preserve other route/global error behavior.
  - Treat default-off behavior as regression, not a fabricated RED.
Must-not-have:
  - Do not gate DB-only operations or change auth/validation/access/rate-limit order.
  - No new dependencies, migration, or unrelated route edits.
Open question risks:
  - Compose/startup semantics are operational assumptions, not solved here.
Rollback note:
  - Revert this task's service/route changes; no data migration. Server recreation for rollback may stop active runs.

## STOP CONDITIONS
Done when: service side-effect and router contract/precedence tests pass; only listed files changed.
Uncertain when: current service dependency injection cannot isolate persistence/LLM effects without changing unrelated boundaries.
Escalate when: implementing the guard would require moving it after a write or changing established auth/access precedence.

---

### Task 3: Gate conversation and regenerate branches without consuming pending intent [depends: T1, T2] [test-risk]

## OBJECTIVE

Guard only conversation branches that will start LLM work, before messages or pending-regenerate state change. Map the typed error at the message route while retaining no-op, cancel, running-board DB-only behavior, and existing catch semantics. T2 owns create/approve route mapping; this task owns the message endpoint and conversation branches.

1. Write a failing test for pending-board clarification. Test file: `server/src/modules/agent/spend-kill-switch.conversation.test.ts`. Level: unit. Test intent: Given an authorized pending non-status board and switch on, When a message enters LLM clarification, Then typed denial occurs before user/assistant message writes or LLM invocation. Exercise through: real `sendMessage`. Test doubles: fake DB, classifier, and publisher; do not mock service, branch selection, or assertion. Expected RED: current service writes/calls the LLM path without a guard.
2. Run and verify this test fails: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.conversation.test.ts`.
3. Write a failing test for status-period detection. Test file: `server/src/modules/agent/spend-kill-switch.conversation.test.ts`. Level: unit. Test intent: Given a pending status-report board and switch on, When period detection is selected, Then typed denial escapes the fallback catch before message/intent mutations. Exercise through: real `sendMessage`. Test doubles: fake DB, detector and publisher; do not mock the service, branch selector, assertion, or fallback. Expected RED: current path calls the detector and its catch can convert an ordinary error into fallback assistant text.
4. Run and verify this test fails: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.conversation.test.ts`.
5. Write a failing test for completed-board follow-up. Test file: `server/src/modules/agent/spend-kill-switch.conversation.test.ts`. Level: unit. Test intent: Given a completed board and switch on, When follow-up would be classified, Then typed denial occurs before classifier invocation, message writes, or pending-regenerate state creation. Exercise through: real `sendMessage`. Test doubles: fake DB, classifier and event dependencies; do not mock service or assertion. Expected RED: current branch invokes classification or writes without a guard.
6. Run and verify this test fails: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.conversation.test.ts`.
7. Write a failing test for pending regenerate denial through HTTP. Test file: `server/src/modules/agent/routes.spend-kill-switch.test.ts`. Level: integration (Supertest through router plus real service). Test intent: Given pending intent exists and an isolated config value changes from allow during setup to deny for confirmation, When confirmation is posted, Then, with test config set to production and the global error handler mounted, exact 503 JSON with only the specified `error` and `code` fields is returned, intent remains pending, and no status/output/event/pipeline mutation occurs. Exercise through: real message route and service. Test doubles: DB/event/pipeline/LLM boundaries and a test-only config module mock whose mutable exported config object is read by the real assertion; stage intent through the real `sendMessage` with the test flag off, then change the value to on between requests. Do not fake the pending map or mock assertion/route/service, and do not imply production config reload behavior. Expected RED: current confirmation consumes pending intent and launches the pipeline.
8. Run and verify this test fails: `npm run test --workspace=server -- src/modules/agent/routes.spend-kill-switch.test.ts`.
9. Write a failing test that a denied pending intent remains usable. Test file: `server/src/modules/agent/routes.spend-kill-switch.test.ts`. Level: integration (Supertest through router plus real service). Test intent: Given a pending intent, When one confirmation is denied and a later confirmation is allowed, Then the later request consumes the original intent and starts its pipeline exactly once. Exercise through: real message route and service. Test doubles: DB/event/pipeline/LLM boundaries and a test-only config module mock whose mutable exported config object is read by the real assertion; stage intent through the real `sendMessage` with the test flag off, then change the value between requests. Do not fake the pending map or mock assertion/route/service, and do not imply production hot reload. Expected RED: current confirmation deletes the pending intent before the denial, so the later allowed request becomes a no-op and does not start the pipeline.
10. Run and verify this test fails: `npm run test --workspace=server -- src/modules/agent/routes.spend-kill-switch.test.ts`.
11. Write a regression test for no-pending confirmation. Test file: `server/src/modules/agent/spend-kill-switch.conversation.test.ts`. Level: unit. Test intent: Given switch on and no pending intent, When confirmation is requested, Then the existing no-op result `{ ok: true }` is returned and there are no LLM calls or state changes. Exercise through: real `confirmRegenerateBoard`. Test doubles: fake board lookup, DB and LLM; use a fresh board id with the real pending map left empty, and do not mock service or branch logic. Expected RED: none expected for this preserved baseline; run as a regression check and do not manufacture a failure.
12. Run the no-pending regression check: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.conversation.test.ts`.
13. Write a cancel-path regression test. Test file: `server/src/modules/agent/spend-kill-switch.conversation.test.ts`. Level: unit. Test intent: Given a test-only config value is off while real `sendMessage` stages pending regenerate state, then is set on before cancellation, When the real service cancels it, Then the existing cancel response/state behavior remains available and no LLM is invoked. Exercise through: real `sendMessage` followed by real `cancelRegenerateBoard`. Test doubles: test-only config value, fake DB and LLM boundaries; use the real pending map and do not mock service or branch selection. Expected RED: none expected; preserve baseline behavior.
14. Run the cancel regression: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.conversation.test.ts`.
15. Write a running-board DB-only regression test. Test file: `server/src/modules/agent/spend-kill-switch.conversation.test.ts`. Level: unit. Test intent: Given switch on and board is already running, When a message uses the DB-only branch, Then the existing message response/write remains available and no LLM is invoked. Exercise through: real `sendMessage`. Test doubles: fake DB and LLM boundaries; do not mock service or branch selection. Expected RED: none expected; preserve baseline behavior.
16. Run the running-board regression: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.conversation.test.ts`.
17. Write a default-off conversation regression test. Test file: `server/src/modules/agent/spend-kill-switch.conversation.test.ts`. Level: unit. Test intent: Given the switch is off and a pending board message needs LLM clarification, When real `sendMessage` runs, Then the existing classifier runs and the conversation follows its current behavior without kill-switch denial. Exercise through: real service method. Test doubles: test config value, fake classifier/DB/event dependencies; do not mock service or assertion. Expected RED: none expected; preserve existing behavior without manufacturing a failure.
18. Run the default-off conversation regression: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.conversation.test.ts`.
19. Write a concurrent regenerate regression test. Test file: `server/src/modules/agent/spend-kill-switch.regenerate-concurrency.test.ts`. Level: integration (real service methods sharing the real module pending map). Test intent: Given a test-only config value is off and the real service's completed-board `sendMessage` returns a staged `pendingRegenerate` result, When the test then runs two `confirmRegenerateBoard` calls concurrently, Then the original staged intent is claimed once and exactly one pipeline starts. Stage and assert the real service result before issuing the concurrent confirmations against the same real map. Exercise through: real `sendMessage` followed by concurrent public `confirmRegenerateBoard` calls. Test doubles: external DB/LLM/event/pipeline dependencies only; do not mock the service, config assertion path, pending map, or claim logic. The test-only config value does not assert production hot reload. Expected RED: none expected; current atomic claim is existing behavior to preserve, so run this as a regression check, not a fabricated failure.
20. Run the concurrency regression: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.regenerate-concurrency.test.ts`.
21. Add assertions before message inserts and pending-regenerate deletion; keep the pending check/claim adjacent and synchronous; leave pending intent untouched when assertion throws so it is available for a later allowed confirmation; let typed denial escape status-period fallback catches; map the typed error explicitly in the message route. Re-run `npm run test --workspace=server -- src/modules/agent/routes.spend-kill-switch.test.ts src/modules/agent/spend-kill-switch.conversation.test.ts src/modules/agent/spend-kill-switch.regenerate-concurrency.test.ts` to verify HTTP denial/pending preservation, default-off/no-op/cancel/running-path, and atomic concurrency checks all pass; refactor while green. Commit: `feat(agent): gate conversation spend branches`.

## REFERENCES LOADED
- `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md` — clarification, period detection, follow-up, regenerate, no-op, DB-only, and concurrency semantics.
- `server/src/modules/agent/board-conversation.ts` — branch ordering, message inserts, in-memory pending regenerate claim, fallback catch.
- `server/src/modules/agent/routes.ts` — message action route and typed error boundary.
- `server/src/modules/agent/service.test.ts`, `server/src/modules/agent/routes.test.ts` — existing service and route patterns.
- `server/src/modules/agent/service-deps.ts` — external dependency boundaries.
- `server/package.json` — Vitest 4.1.10, Supertest 7.2.2; version-specific external test docs not verified, so use only established repository APIs/patterns.

## WHY THIS APPROACH
Complexity: deep.
Justification: Branch selection, in-memory pending state, a catch/fallback boundary, and HTTP mapping interact; tests need to observe persistence and retry preservation without changing concurrency semantics.

## SANDWICH CONTEXT
[CRITICAL: Do not consume pending regenerate state or write a message before the assertion; do not add an await between pending check/claim; typed denial must not be swallowed by period-detection fallback.]
You are implementing spend admission for board conversation and regeneration.
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`
Design decision: Guard at spend-bearing service branches; keep no-op/DB-only branches open.
Files in scope: `server/src/modules/agent/board-conversation.ts`, `server/src/modules/agent/routes.ts`, `server/src/modules/agent/spend-kill-switch.conversation.test.ts`, `server/src/modules/agent/spend-kill-switch.regenerate-concurrency.test.ts`, `server/src/modules/agent/routes.spend-kill-switch.test.ts`.
Available after: T1 helper API and T2 create/approve route behavior.
Architecture rule: No guard in the middle of a running pipeline; use agent public API; preserve authorization and existing no-LLM branch behavior.
[RESTATE: Do not consume pending regenerate state or write a message before the assertion; do not add an await between pending check/claim; typed denial must not be swallowed by period-detection fallback.]

## DELIVERABLE
Given a pending non-status board message selects clarification while switch is on, When sent, Then exact denial occurs before message writes.
Given a pending status-report message selects period detection while switch is on, When sent, Then exact denial occurs before message/intent writes and is not converted into fallback assistant text.
Given a completed board follow-up would classify while switch is on, When sent, Then it is denied before messages or pending intent are written.
Given pending regenerate exists and assertion denies confirmation, When confirmation is requested, Then exact HTTP 503 is returned and pending intent/state remain unchanged.
Given switch is on and no pending regenerate intent exists, When confirmation is requested, Then the existing `{ ok: true }` no-op response is returned without LLM work or state changes.
Given switch is on and a cancel or running-board DB-only path is requested, When it is processed, Then existing behavior remains available without LLM work.
Given switch is off and a pending-board conversation needs LLM clarification, When the message is sent, Then the existing classifier/response behavior continues.
[derived] Given a pending regenerate intent was preserved by a denial, When a later confirmation is allowed, Then the original intent is consumed and its pipeline starts exactly once.
[derived] Given two confirmations race for an intent staged by the real service, When both requests complete, Then exactly one pipeline starts.

## QUALITY BAR
Must-have:
  - Real service and route execution with fakes only at persistence, LLM, and event boundaries.
  - Verify pending intent survives a denial and remains usable on a later allowed confirmation.
  - Preserve no-op confirmation, cancellation, and running-board DB-only behavior.
  - Do not add mid-run guards or an await in the pending claim section.
Must-not-have:
  - No pending-state writes on denied requests, broad catch conversion, schema/UI work, or changes to in-flight pipeline behavior.
Open question risks:
  - Production config is startup-only; controllable assertion in the pending-state test is test isolation, not hot reload.
Rollback note:
  - Revert conversation/route guard changes; no persistent state conversion. Restart/recreate risk remains.

## STOP CONDITIONS
Done when: branch-denial, pending-preservation, exact HTTP contract, and preserved-path tests pass.
Uncertain when: pending intent cannot be isolated without altering the current concurrency model.
Escalate when: keeping the denial requires consuming pending intent, changing cancel semantics, or adding a mid-run check.

---

### Task 4: Guard direct pipeline entrypoints without interrupting active runs [depends: T1] [test-risk]

## OBJECTIVE

Protect direct service invocation of `runPipeline` and `triggerExecution`, even when no route caller exists. Assert once at each method's invocation start; `triggerExecution` must assert before its catch/failed-state handling. Do not put checks inside card iteration or execution helpers.

1. Write failing tests for:
   - Direct `runPipeline` denial. Test file: `server/src/modules/agent/spend-kill-switch.pipeline.test.ts`. Level: unit. Test intent: Given switch on, When the real service's `runPipeline` is invoked directly, Then typed denial escapes before pipeline-card work, LLM, events, or state writes. Exercise through: public service method returned by `createAgentBoardService`. Test doubles: fake all pipeline/DB/event/LLM dependencies; do not mock the pipeline method or guard. Expected RED: current method begins pipeline work without admission.
   - Direct `triggerExecution` denial before catch. Test file: `server/src/modules/agent/spend-kill-switch.pipeline.test.ts`. Level: unit. Test intent: Given switch on, When `triggerExecution` is called directly, Then typed error escapes and no generating event, executeCard, output, failed-state update, or LLM call occurs. Exercise through: public service method. Test doubles: fake DB/event/card executor/LLM; do not mock the method or assertion. Expected RED: current try/catch can run execution and may convert an error to failed state.
   - Already-started run is not cut off. Test file: `server/src/modules/agent/spend-kill-switch.pipeline.test.ts`. Level: unit. Test intent: Given a pipeline invocation passed the entry assertion and entered work, When the assertion source later changes in the isolated test, Then the existing run completes according to current behavior with no second guard. Exercise through: real pipeline service method with a controllable async dependency. Test doubles: controllable LLM/card dependency and an isolated config module value only; do not mock the pipeline method or assertion. Expected RED: none is expected for current in-flight behavior; preserve it as a regression check, and do not add a synthetic failing condition. The isolated config change is test-only and does not imply production hot reload.
2. Run focused tests: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.pipeline.test.ts`.
3. Place assertions at the first executable lines of both public methods, with `triggerExecution` outside its `try`; verify denial does not change failure handling for later execution errors. Re-run to verify PASS; refactor while green. Commit: `feat(agent): guard direct pipeline starts`.

## REFERENCES LOADED
- `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md` — direct entrypoint and in-flight run scenarios.
- `server/src/modules/agent/pipeline.ts` — method entry and `triggerExecution` catch boundary.
- `server/src/modules/agent/service.ts` — pipeline methods exposed from the service API.
- `server/src/modules/agent/execute-card.ts`, `server/src/modules/agent/pipeline-card.ts` — side-effect boundaries that must remain behind the entry assertion.
- `server/src/modules/agent/service.test.ts`, `server/src/modules/agent/pipeline.integration.test.ts` — local patterns; do not use live LLM/DB integration for this unit denial test.
- `server/package.json` — Vitest 4.1.10. Versioned external Vitest docs were not verified; no novel runner API is assumed.

## WHY THIS APPROACH
Complexity: standard.
Justification: These service methods are public direct entrypoints; route-only checks cannot protect callers and the `try` boundary has observable failure-state effects.

## SANDWICH CONTEXT
[CRITICAL: Assert once at method entry and before `triggerExecution`'s try/catch; never interrupt a run after it passed admission.]
You are implementing direct pipeline admission for the Global Agent Spend Kill Switch.
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`
Design decision: Defense-in-depth entry assertion; no mid-pipeline checks.
Files in scope: `server/src/modules/agent/pipeline.ts`, `server/src/modules/agent/spend-kill-switch.pipeline.test.ts`.
Available after: T1 shared assertion/error API.
Architecture rule: Do not move the guard into `executeCard`, `runChatTurn`, or inside pipeline loops.
[RESTATE: Assert once at method entry and before `triggerExecution`'s try/catch; never interrupt a run after it passed admission.]

## DELIVERABLE
Given switch on and a direct `runPipeline` call, When invocation begins, Then typed denial escapes before any pipeline work or side effect.
Given switch on and a direct `triggerExecution` call, When invocation begins, Then typed denial escapes before its catch and before event/output/state/LLM effects.
Given a run passed the entry assertion, When it continues, Then the kill switch does not abort or re-check that in-flight run.

## QUALITY BAR
Must-have:
  - Test real service entrypoints, not only route callers.
  - Verify all side effects are absent on denial and typed errors escape unchanged.
  - Keep entry assertion before `triggerExecution`'s `try` and avoid checks during the run.
Must-not-have:
  - No `executeCard`/SDK/`runChatTurn` edits, mid-run cancellation, or caller assumptions that bypass the direct-entry guard.
Open question risks:
  - `triggerExecution` has no current production caller, but it remains a service entrypoint required by the spec.
Rollback note:
  - Revert the two entry assertions and focused tests; no data rollback.

## STOP CONDITIONS
Done when: both direct-entry denials and the in-flight regression test pass.
Uncertain when: a test cannot distinguish entry-time denial from a swallowed inner error.
Escalate when: the implementation must change pipeline iteration or active-run behavior.

---

### Task 5: Reject chat send and retry before stream or message persistence [depends: T1] [test-risk]

## OBJECTIVE

Add a typed kill-switch response to the chat message HTTP boundary after existing auth/access/history/context/rate-limit checks but before NDJSON headers or persistence. Keep both send and retry targets untouched on denial.

1. Write a failing test for chat send denial. Test file: `server/src/modules/chat/message-stream.send-kill-switch.test.ts`. Level: integration (Supertest through chat router and real message-stream/runtime handlers). Test intent: Given a valid authorized send, history/context/rate checks pass, and switch is on, When the HTTP message endpoint is called, Then, with test config set to production and the global error handler mounted, exact 503 JSON with only the specified `error` and `code` fields arrives with `content-type: application/json` (not the NDJSON stream content type) before stream headers, user/assistant inserts, or `runChatTurn`; explicitly assert all domain-write persistence spies have zero calls (history/access reads may occur). Exercise through: public chat HTTP route. Test doubles: auth, spyable persistence service, rate limiter and `runChatTurn`; do not mock the route, message-stream handler, message-runtime admission ordering, or assertion. Expected RED: current handler starts NDJSON/streaming and proceeds to persistence instead of returning pre-stream 503.
2. Run and verify the send-denial test fails independently: `npm run test --workspace=server -- src/modules/chat/message-stream.send-kill-switch.test.ts`.
3. Write a failing test for retry denial before target deletion. Test file: `server/src/modules/chat/message-stream.retry-kill-switch.test.ts`. Level: integration. Test intent: Given a valid retry target and switch on, When retry is posted, Then, with test config set to production and the global error handler mounted, exact 503 JSON with only the specified `error` and `code` fields arrives with `content-type: application/json` (not the NDJSON stream content type) before stream headers, deletion, placeholder insert, or LLM call, the original target remains, and all domain-write persistence spies have zero calls (target/history reads may occur). Exercise through: same public HTTP route using the retry action. Test doubles: auth, spyable persistence service, limiter and LLM only; do not mock the route/stream/runtime code. Expected RED: current path sends stream headers and deletes the retry target before LLM generation.
4. Run and verify the retry-denial test fails independently: `npm run test --workspace=server -- src/modules/chat/message-stream.retry-kill-switch.test.ts`.
5. Write a send validation-precedence regression. Test file: `server/src/modules/chat/message-stream.send-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and a malformed send request from an authenticated user, When the public route is called, Then the existing 400 response remains first. Exercise through: public chat HTTP route. Test doubles: external auth/service only; keep route validation real. Expected RED: none expected; preserve current behavior.
6. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.send-kill-switch.test.ts`.
7. Write a send authentication-precedence regression. Test file: `server/src/modules/chat/message-stream.send-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and an unauthenticated send, When the route is called, Then the existing 401 response remains first. Exercise through: public chat HTTP route. Test doubles: auth boundary only; keep route/handler real. Expected RED: none expected.
8. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.send-kill-switch.test.ts`.
9. Write a send access-precedence regression. Test file: `server/src/modules/chat/message-stream.send-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and a missing/inaccessible thread or workspace membership, When a valid send is called, Then the existing 404 response remains first. Exercise through: public chat HTTP route. Test doubles: auth/access/persistence boundary only; keep handler real. Expected RED: none expected.
10. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.send-kill-switch.test.ts`.
11. Write a send rate-limit-precedence regression. Test file: `server/src/modules/chat/message-stream.send-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and chat rate limit is exceeded, When a valid send is called, Then the existing 429 response remains first and the existing rate-limit accounting is unchanged. Exercise through: public route. Test doubles: rate limiter and persistence/auth boundaries; keep admission ordering real. Expected RED: none expected.
12. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.send-kill-switch.test.ts`.
13. Write a send context-size-precedence regression. Test file: `server/src/modules/chat/message-stream.send-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and send context exceeds the current limit, When send is called, Then the existing 413 response remains first. Exercise through: public route and real context preparation. Test doubles: history persistence only; keep context sizing/handler real. Expected RED: none expected.
14. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.send-kill-switch.test.ts`.
15. Write a default-off send regression. Test file: `server/src/modules/chat/message-stream.send-kill-switch.test.ts`. Level: integration. Test intent: Given switch off and valid authorized send, When called, Then existing stream response and generation behavior remain. Exercise through: public route. Test doubles: persistence and LLM boundaries only; keep route/stream handler real. Expected RED: none expected.
16. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.send-kill-switch.test.ts`.
17. Write a retry validation-precedence regression. Test file: `server/src/modules/chat/message-stream.retry-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and malformed retry action/target id from an authenticated user, When the route is called, Then the existing 400 response remains first. Exercise through: public chat HTTP route. Test doubles: auth and service boundary only; keep route validation real. Expected RED: none expected.
18. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.retry-kill-switch.test.ts`.
19. Write a retry authentication-precedence regression. Test file: `server/src/modules/chat/message-stream.retry-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and an unauthenticated retry, When called, Then the existing 401 response remains first. Exercise through: public route. Test doubles: auth boundary only; keep handler real. Expected RED: none expected.
20. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.retry-kill-switch.test.ts`.
21. Write a retry access-precedence regression. Test file: `server/src/modules/chat/message-stream.retry-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and missing/inaccessible thread or retry target, When retry is called, Then the existing 404 response remains first. Exercise through: public route. Test doubles: auth and persistence/access boundary only; keep handler real. Expected RED: none expected.
22. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.retry-kill-switch.test.ts`.
23. Write a retry rate-limit-precedence regression. Test file: `server/src/modules/chat/message-stream.retry-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and chat rate limit is exceeded, When valid retry is called, Then the existing 429 response remains first and rate-limit accounting is unchanged. Exercise through: public route. Test doubles: rate limiter and persistence/auth boundaries; keep ordering real. Expected RED: none expected.
24. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.retry-kill-switch.test.ts`.
25. Write a retry context-size-precedence regression. Test file: `server/src/modules/chat/message-stream.retry-kill-switch.test.ts`. Level: integration. Test intent: Given switch on and retry context exceeds current limit, When retry is called, Then the existing 413 response remains first. Exercise through: public route and real context preparation. Test doubles: history/target persistence only; keep context sizing real. Expected RED: none expected.
26. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.retry-kill-switch.test.ts`.
27. Write a default-off retry regression. Test file: `server/src/modules/chat/message-stream.retry-kill-switch.test.ts`. Level: integration. Test intent: Given switch off and valid authorized retry, When called, Then existing stream response/regeneration behavior remains and target handling is unchanged. Exercise through: public route. Test doubles: persistence and LLM boundaries only; keep route/stream handler real. Expected RED: none expected.
28. Run this regression: `npm run test --workspace=server -- src/modules/chat/message-stream.retry-kill-switch.test.ts`.
29. Write a chat thread CRUD regression. Test file: `server/src/modules/chat/routes.test.ts`. Level: integration (Supertest through real thread routes). Test intent: Given the switch is on, When a user creates, lists, reads, renames, and deletes chat threads, Then each DB-only endpoint keeps its existing response and `runChatTurn` is never called. Exercise through: public chat HTTP routes. Test doubles: auth and chat persistence service methods, plus `runChatTurn` as an invocation spy; do not mock the route handlers. Expected RED: none expected; thread CRUD already works and must remain available.
30. Run the thread CRUD regression: `npm run test --workspace=server -- src/modules/chat/routes.test.ts`.
31. Import the shared contract via `../agent/index.js`; map the typed error before `setStreamHeaders`, using the exact JSON body. Re-run the two denial files and the CRUD test to verify each denial independently and all regressions green; refactor while green. Commit: `feat(chat): gate new LLM messages`.

## REFERENCES LOADED
- `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md` — chat send/retry, precedence, and no-write requirements.
- `server/src/modules/chat/message-stream.ts` — HTTP/stream boundary and exception handling.
- `server/src/modules/chat/message-runtime.ts` — access/rate/context checks and send/retry persistence effects.
- `server/src/modules/chat/routes.test.ts` — existing Supertest route and dependency-double pattern.
- `server/src/modules/agent/index.ts` — only permitted cross-feature API.
- `server/package.json` — Express 5.2.1, Supertest 7.2.2, Vitest 4.1.10. External API docs were not version-pinned/fully checked; use the already established route/test APIs and introduce no new dependency.

## WHY THIS APPROACH
Complexity: deep.
Justification: HTTP response mode changes at the header boundary, while send/retry persistence occurs downstream; only a route-level collaboration test proves JSON 503 and zero writes together.

## SANDWICH CONTEXT
[CRITICAL: Kill-switch denial must remain JSON 503 before `setStreamHeaders` and before `persistMessageStart`; preserve current access, validation, context-size, and rate-limit precedence.]
You are implementing the chat spend boundary for the Global Agent Spend Kill Switch.
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`
Design decision: Check after current chat admission/context checks and before any stream response or message mutation.
Files in scope: `server/src/modules/chat/message-stream.ts`, `server/src/modules/chat/message-stream.send-kill-switch.test.ts`, `server/src/modules/chat/message-stream.retry-kill-switch.test.ts`, `server/src/modules/chat/routes.test.ts`.
Available after: T1 public agent guard/typed error API.
Architecture rule: Import from `server/src/modules/agent/index.ts`; don't deep import or add checks in `runChatTurn`.
[RESTATE: Kill-switch denial must remain JSON 503 before `setStreamHeaders` and before `persistMessageStart`; preserve current access, validation, context-size, and rate-limit precedence.]

## DELIVERABLE
Given switch on and a valid authorized chat send, When the message route is called, Then exact 503 JSON is returned before stream headers, inserts, and LLM work.
Given switch on and a valid retry target, When retry is called, Then exact 503 JSON is returned before stream headers, target deletion, placeholder insertion, and LLM work.
Given malformed chat send input and switch on, When the route is called, Then the existing 400 remains first.
Given an unauthenticated chat send and switch on, When the route is called, Then the existing 401 remains first.
Given an inaccessible chat thread/workspace and switch on, When send is called, Then the existing 404 remains first.
Given the chat rate limit is exceeded and switch on, When send is called, Then the existing 429 remains first.
Given send context exceeds its limit and switch on, When send is called, Then the existing 413 remains first.
Given malformed retry input and switch on, When the route is called, Then the existing 400 remains first.
Given an unauthenticated retry and switch on, When the route is called, Then the existing 401 remains first.
Given an inaccessible thread/retry target and switch on, When retry is called, Then the existing 404 remains first.
Given the chat rate limit is exceeded and switch on, When retry is called, Then the existing 429 remains first.
Given retry context exceeds its limit and switch is on, When retry is called, Then the existing 413 remains first.
Given switch is off, When valid send or retry is called, Then existing streaming behavior remains.
Given switch is on, When a user performs chat thread CRUD, Then database-only operations remain available without invoking `runChatTurn`.

## QUALITY BAR
Must-have:
  - Exercise the real route, stream handler, and history preparation; double only external persistence/auth/rate/LLM boundaries.
  - Independently verify JSON content-type rather than NDJSON, no domain-write persistence calls (reads are allowed), and no LLM calls for send and retry.
  - Preserve 400/403/404/413/429 precedence and startup default-off behavior.
Must-not-have:
  - No SSE/NDJSON error conversion after headers, no client changes, and no guard in `runChatTurn`.
Open question risks:
  - Existing request context preparation stays before the switch; any change to the required order needs a spec amendment, not an implementation inference.
Rollback note:
  - Revert chat boundary/test changes; no data rollback.

## STOP CONDITIONS
Done when: send/retry 503 contract, no-header/no-write assertions, precedence and default-off regressions pass.
Uncertain when: existing context preparation sends headers or persists data before the proposed check (inspect and report rather than move the guard blindly).
Escalate when: correct error precedence cannot be preserved before stream headers.

---

### Task 6: Gate ticket extraction while preserving the classifier first turn [depends: T1] [test-risk]

## OBJECTIVE

Reject only ticket-intake turns that proceed to LLM extraction. Keep configuration/auth/validation/membership checks, the existing first-turn classifier question, and rate-limit accounting in their specified order. Do not gate submit/resubmit Linear operations.

1. Write a failing test for ticket extraction denial. Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`. Level: integration (Supertest through the real ticket-intake router). Test intent: Given configured intake, valid authorized non-first extraction turn, rate limit allows, and switch is on, When the endpoint is called, Then, with test config set to production and the global error handler mounted, exact 503 JSON with only the specified `error` and `code` fields returns before Anthropic or extraction writes. Exercise through: public `/ticket-intake/chat` HTTP route. Test doubles: auth, membership, configuration, rate limiter and `extractTicketFields`; do not mock the router/handler or shared assertion. Expected RED: current extraction path calls the mocked extractor and returns its ordinary result instead of the typed denial.
2. Run and verify extraction denial fails: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`.
3. Write a regression check for the first classifier turn. Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`. Level: integration. Test intent: Given switch on and `isFirstTurn=true`, `autoError=false`, When a valid member sends the initial turn, Then the existing classifier question is returned and extractor is not called. Exercise through: same public route. Test doubles: auth/membership/limiter/LLM boundaries only; do not mock route logic. Expected RED: none expected for existing no-LLM behavior; this is a separate regression check, not a fabricated RED.
4. Run the first-turn regression check: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`.
5. Write an invalid-input precedence regression. Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`. Level: integration. Test intent: Given switch on, intake configured, and malformed ticket message/workspace input from an authenticated user, When the route is called, Then the existing 400 response remains first. Exercise through: public ticket HTTP route. Test doubles: auth/configuration only; keep route validation real. Expected RED: none expected; preserve current behavior.
6. Run this regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`.
7. Write an authentication precedence regression. Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`. Level: integration. Test intent: Given switch on and unauthenticated ticket request, When called, Then the existing 401 response remains first. Exercise through: public route. Test doubles: auth boundary only; keep route/handler real. Expected RED: none expected.
8. Run this regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`.
9. Write a membership precedence regression. Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`. Level: integration. Test intent: Given switch on and authenticated user is not a workspace member, When a valid extraction request arrives, Then existing 404 response remains first and extractor is not called. Exercise through: public route. Test doubles: membership and auth only; keep route/guard real. Expected RED: none expected.
10. Run this regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`.
11. Write a rate-limit precedence regression. Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`. Level: integration. Test intent: Given switch on and ticket chat rate limit is exceeded, When a valid extraction turn arrives, Then existing 429 response remains first and existing accounting behavior is unchanged. Exercise through: public route. Test doubles: rate limiter/auth only; keep route ordering real. Expected RED: none expected.
12. Run this regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`.
13. Write a not-configured precedence regression. Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`. Level: integration. Test intent: Given switch on but ticket intake is not configured, When a ticket request arrives, Then the existing `503 { error: "Ticket intake is not configured" }` remains first and extraction is not called. Exercise through: public route. Test doubles: configuration and extractor only; keep route/guard real. Expected RED: none expected.
14. Run this regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`.
15. Write a default-off extraction regression. Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`. Level: integration. Test intent: Given switch off and a valid configured non-first ticket turn, When the real HTTP route processes it, Then extraction is called and the existing response is returned without kill-switch denial. Exercise through: public `/ticket-intake/chat` route. Test doubles: test config value, auth/membership/rate limiter and extractor; do not mock route logic or assertion. Expected RED: none expected; preserve current behavior without manufacturing a failure.
16. Run the default-off extraction regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`.
17. Call the shared assertion after existing configuration, auth, validation, membership, first-turn, and rate-limit checks, immediately before extraction; explicitly map only the typed error to exact 503. Re-run the focused command to verify denial and all regression checks pass; refactor while green. Commit: `feat(agent): gate ticket extraction`.

## REFERENCES LOADED
- `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md` — extraction vs classifier-first-turn and error precedence requirements.
- `server/src/modules/agent/ticket-intake/routes.ts` — configured/auth/validation/membership/first-turn/rate-limit/extraction ordering.
- `server/src/modules/agent/ticket-intake/routes.test.ts`, `routes.validation.test.ts`, `llm.ts` — local HTTP test and extractor mock patterns.
- `server/src/modules/agent/index.ts` — cross-feature guard/error public API.
- `server/package.json` — Supertest 7.2.2, Vitest 4.1.10. External test API documentation was not verified against these exact patch versions; no novel APIs are required.

## WHY THIS APPROACH
Complexity: standard.
Justification: A single route has a deliberate non-LLM first-turn branch and ordered validation/rate-limit checks; a public-boundary test verifies the exact exception without broad middleware gating.

## SANDWICH CONTEXT
[CRITICAL: Do not gate the initial classifier question or move the check ahead of existing configuration/auth/validation/membership/rate-limit responses.]
You are implementing the ticket-intake extraction boundary for the Global Agent Spend Kill Switch.
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`
Design decision: Guard directly before extraction; leave non-LLM route branches available.
Files in scope: `server/src/modules/agent/ticket-intake/routes.ts`, `server/src/modules/agent/ticket-intake/routes.test.ts`.
Available after: T1 shared guard/error contract.
Architecture rule: Ticket intake is inside the agent feature; use the local module API and preserve current route order.
[RESTATE: Do not gate the initial classifier question or move the check ahead of existing configuration/auth/validation/membership/rate-limit responses.]

## DELIVERABLE
Given a valid configured extraction turn with switch on, When ticket chat reaches extraction, Then exact 503 JSON is returned before Anthropic work.
Given switch on and a valid initial classifier turn, When the endpoint is called, Then the existing question remains available and no LLM is called.
Given switch off and a valid configured extraction turn, When the endpoint is called, Then existing extraction behavior continues without kill-switch denial.
Given invalid ticket input and switch on, When the route is called, Then the existing 400 remains first.
Given an unauthenticated ticket request and switch on, When the route is called, Then the existing 401 remains first.
Given a non-member ticket request and switch on, When the route is called, Then the existing 404 remains first.
Given ticket chat rate limit is exceeded and switch on, When extraction is requested, Then the existing 429 remains first.
Given ticket intake is not configured and switch on, When a request arrives, Then the existing not-configured 503 remains first.

## QUALITY BAR
Must-have:
  - Exercise the real HTTP handler and assert extractor non-invocation on denial.
  - Preserve first-turn no-LLM behavior and existing rate-limit accounting/order.
  - Map typed denial explicitly to exact 503 JSON.
Must-not-have:
  - No gate on Linear submit/resubmit or other non-LLM operation; no reordering existing guards.
Open question risks:
  - If ticket intake is not configured, existing not-configured response intentionally precedes kill switch.
Rollback note:
  - Revert ticket route and test changes; no persistent migration.

## STOP CONDITIONS
Done when: extraction denial, first-turn regression, and existing precedence tests pass.
Uncertain when: the first-turn decision or rate-limit behavior differs from the spec's inspected route ordering.
Escalate when: the feature would require a broad router middleware or a changed rate-limit contract.

---

### Task 7: Wire and document production activation [depends: T1]

## OBJECTIVE

Expose the default-off flag in the server env example, production env template, and Compose server environment; provide operator instructions for activation and rollback via container recreation. Do not recreate or restart any deployment while validating this packet.

1. Add `AGENT_SPEND_KILL_SWITCH=false` to `server/.env.example` and `deploy/.env.production.template`; add `AGENT_SPEND_KILL_SWITCH: ${AGENT_SPEND_KILL_SWITCH:-false}` under the production server's `environment` in `deploy/docker-compose.prod.yml`.
2. Create `deploy/README.md` documenting: copy/fill `.env.production.template` as `.env.production`; set the flag to `true` to block new spend or `false` to restore; from the deploy directory apply with `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate server`; explain the server reads config at startup and recreate can interrupt active runs; rollback with `false` and the same command. Do not promise an active run survives recreation.
3. Verify Compose renders the explicit server variable and all env/docs agree, without starting/recreating containers: `docker compose --env-file deploy/.env.production.template -f deploy/docker-compose.prod.yml config --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);if(c.services.server.environment.AGENT_SPEND_KILL_SWITCH!=="false")process.exit(1);console.log("AGENT_SPEND_KILL_SWITCH defaults to false in server environment")})'`. Also inspect `git diff --check` and commit `chore(deploy): document agent spend kill switch`.

## REFERENCES LOADED
- `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md` — operational setup, startup-only config, rollback, and recreation risk.
- `deploy/docker-compose.prod.yml`, `deploy/.env.production.template`, `deploy/deploy.sh` — explicit env mapping and current deployment invocation.
- `server/.env.example` — server env-example convention.
- Docker Docs, “Set environment variables within your container's environment”: https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/ — explicit Compose environment mapping.
- Docker Docs, `docker compose up`: https://docs.docker.com/reference/cli/docker/compose/up/ — recreation behavior and `--force-recreate`; Compose host version is not pinned in the repository, so verify against the deployment host's installed Compose v2 before applying operational commands.

## WHY THIS APPROACH
Complexity: lightweight.
Justification: This is deployment wiring and operator documentation with no application behavior or schema change; validation can render Compose config without starting services.

## SANDWICH CONTEXT
[CRITICAL: Production env must be explicitly passed into the server container; activation and rollback recreate only the server service, and active-run continuity is not guaranteed.]
You are wiring operator configuration for the Global Agent Spend Kill Switch.
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`
Design decision: Startup-only env flag with explicit production Compose pass-through.
Files in scope: `server/.env.example`, `deploy/.env.production.template`, `deploy/docker-compose.prod.yml`, `deploy/README.md`.
Available after: T1 defines the accepted flag and default.
Architecture rule: Keep the setting default-off and document the exact recreation needed to apply it.
[RESTATE: Production env must be explicitly passed into the server container; activation and rollback recreate only the server service, and active-run continuity is not guaranteed.]

## DELIVERABLE
Given the production env file sets `AGENT_SPEND_KILL_SWITCH=true` or `false`, When Compose starts/recreates the server, Then the explicit server environment receives that value and the default is false.
Given an operator follows the README, When activating or rolling back, Then instructions use `up -d --force-recreate server` and warn that active runs may be interrupted.

## QUALITY BAR
Must-have:
  - [no-tdd — structural task]
  - Keep `.env.example`, production template, Compose mapping, and README consistent.
  - Validate rendered Compose config without starting/recreating services.
  - Make startup-only and active-run interruption caveat explicit.
Must-not-have:
  - No deployment execution, server restart, secrets, client changes, or unrelated operations documentation.
Open question risks:
  - Host Compose v2 version is not pinned; verify command support on deployment host before use.
Rollback note:
  - Set the env flag to `false` and recreate the server with the documented Compose command. Revert these docs/config changes if code rollout is rolled back.

## STOP CONDITIONS
Done when: Compose rendering shows default false in server environment, env examples match, README documents activation/rollback, and diff is clean.
Uncertain when: deployed Compose version lacks the documented options.
Escalate when: the flag is not explicitly visible in the resolved `server.environment`.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Add startup config and shared spend-denial contract | prereq | standard | Config absent/false/true/invalid; typed assertion off/on |
| T2 | Gate board creation and approval at agent HTTP boundary | T1 | standard | No classifier/status/event/write; exact 503 and precedence |
| T3 | Gate conversation and regenerate branches | T1, T2 | deep | Denial/pending preservation; default-off, no-op, DB-only and atomic-claim regressions |
| T4 | Guard direct pipeline entrypoints | T1 | standard | Direct entry denial before effects/catch; no mid-run abort |
| T5 | Reject chat send/retry before stream/persistence | T1 | deep | Separate production send/retry denials; error-precedence and thread CRUD regressions |
| T6 | Gate ticket extraction, keep first turn | T1 | standard | Production 503; first-turn, default-off extraction and precedence regressions |
| T7 | Wire and document production activation | T1 | lightweight | Compose render defaults false; recreate/rollback documented |

## Plan-wide Completion Verification

Run these after T1–T7 are complete; they are not implementation checks performed during planning. Run each command separately from the repository root. `make check` covers lint and architecture guards but does not replace typecheck or tests.

1. `make check`
2. `npm run typecheck`
3. `npm run test --workspace=server -- src/__tests__/config.test.ts src/modules/agent/spend-kill-switch.test.ts src/modules/agent/spend-kill-switch.service.test.ts src/modules/agent/routes.spend-kill-switch.test.ts src/modules/agent/spend-kill-switch.conversation.test.ts src/modules/agent/spend-kill-switch.regenerate-concurrency.test.ts src/modules/agent/spend-kill-switch.pipeline.test.ts src/modules/agent/ticket-intake/routes.test.ts src/modules/chat/message-stream.send-kill-switch.test.ts src/modules/chat/message-stream.retry-kill-switch.test.ts src/modules/chat/routes.test.ts`

If any command fails, return to the owning packet, fix it test-first, then rerun all three completion checks. Do not treat dry-run validation as implementation verification.

## Planning Validation Record

- **Plan status:** draft; no user approval for structuring has been recorded.
- **Independent spec review:** Approved after reviewing the revised packets; reviewer persona: general-purpose spec reviewer, current session model with no override.
- **Test strategy audit:** Clean for triggered tasks T2, T3, T5, and T6; auditor persona: general-purpose test strategy auditor, current session model with no override.
- **Dry-run:** `npx -y pocketto-pi structure "docs/pocket/plans/2026-10-10-agent-spend-kill-switch/execution-plan.md" --dry-run --json --contract 3` returned `ok: true`, `dryRun: true`, `taskCount: 7`, `action: split`, `executionFlow: T1→T2,T4,T5,T6,T7(PARALLEL)→T3`; CLI version 4.1.0, contract 3. No derived execution artifacts were written.
- **Implementation verification:** Not run; product implementation has not started.
