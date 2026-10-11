# EXECUTION PLAN — Global Agent Spend Kill Switch

**Date:** 2026-10-10  
**Spec:** `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
**Status:** draft  
**Total tasks:** 6

---

## Execution Overview

### Recommended Order

```text
T1 → T2, T6 (parallel) → T3, T4, T5 (parallel after T2)
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups

| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T6 | T1 completes |
| Group B | T3, T4, T5 | T2 completes (T4 and T5 may run in parallel) |

### Constraints Reminder

**Architecture:** Put the shared assertion/error in `server/src/modules/agent/spend-kill-switch.ts`, export it through `server/src/modules/agent/index.ts`, and import it cross-feature only through that public API. Assert at spend-bearing entrypoints after existing access/validation/rate-limit checks and before any request-caused write, stream header, pending-regenerate consumption, or LLM start. Handle the typed error at each HTTP boundary; do not rely on the global sanitizer. Do not guard inside a running pipeline/card, `runChatTurn`, or SDK. Keep NodeNext `.js` import suffixes and 300-on-touch. No client, schema, migration, or dependency changes.

**Out-of-scope:** Per-user quota, spend meter/events/dashboard, UI/admin controls, aborting in-flight LLM work, CI grep guard, rate-limiter semantic changes, or changes to the DB schema/domain contracts.

**Assumptions at risk:** Config is startup-only; enabling/disabling requires server container recreation. Recreation/redeploy can interrupt in-flight work and is not protected by the assertion. Compose host version is not pinned. A request rejected after current rate-limit checks can still consume rate-limit accounting. Ticket not-configured errors remain prior to the kill-switch response.

**Sequencing:** T1 establishes the shared flag/error contract. T2 and T6 can start after T1; T3, T4, and T5 depend on T2. T4 and T5 are independent feature boundaries and may run concurrently. T6 is deployment wiring and does not require service-entrypoint implementation.

### File Structure Map

```text
Rule: Default-off configuration and shared typed guard
  Modify: server/src/config.ts
  Modify: server/.env.example
  Create: server/src/modules/agent/spend-kill-switch.ts (created by: T1)
  Modify: server/src/modules/agent/index.ts
  Create: server/src/modules/agent/spend-kill-switch.test.ts (created by: T1)
  Modify: server/src/__tests__/config.test.ts

Rule: Agent service and direct pipeline spend entrances deny before effects
  Modify: server/src/modules/agent/service.ts
  Modify: server/src/modules/agent/board-conversation.ts
  Modify: server/src/modules/agent/pipeline.ts
  Modify: server/src/modules/agent/service.test.ts

Rule: Agent HTTP boundaries return exact typed 503 and preserve precedence
  Modify: server/src/modules/agent/routes.ts
  Modify: server/src/modules/agent/routes.test.ts

Rule: Chat send/retry rejected before stream headers or persistence
  Modify: server/src/modules/chat/message-stream.ts
  Modify: server/src/modules/chat/routes.test.ts

Rule: Ticket extraction denied; first classifier question remains available
  Modify: server/src/modules/agent/ticket-intake/routes.ts
  Modify: server/src/modules/agent/ticket-intake/routes.test.ts

Rule: Production flag wiring and operator instructions
  Modify: deploy/docker-compose.prod.yml
  Modify: deploy/.env.production.template
  Create: deploy/README.md (created by: T6)
```

The new source module belongs in the existing `agent` feature module. `deploy/README.md` does not exist at preflight. Every listed implementation source is currently under 300 lines; recheck if scope expands.

---

## Pocket Packets

---

### Task 1: Define startup config and shared spend guard [prereq]

## OBJECTIVE

1. Write a failing config test for absent, explicit `false`, explicit `true`, and invalid values.
   Test file: `server/src/__tests__/config.test.ts`  
   Level: unit  
   Test intent: Given an environment with required variables and no flag or flag `false`/`true`, When `resolveConfig` parses it, Then the default is `false` and explicit values remain exact strings; Given any other string, When parsed, Then Zod rejects it.  
   Exercise through: `resolveConfig()` and startup import behavior where needed, using the existing test module-reset pattern.  
   Test doubles: Supply isolated env values and module reset; no production config side effects, network, or DB.  
   Expected RED: the current parsed config strips the unknown key; default/explicit-true values are absent and invalid strings are not rejected, so all corresponding config assertions fail.
2. Run test — verify FAIL: `npm run test --workspace=server -- src/__tests__/config.test.ts`
3. Add the Zod string enum with default false to `server/src/config.ts`; add `AGENT_SPEND_KILL_SWITCH=false` with description to `server/.env.example`; rerun config test and verify PASS; refactor while green.
4. Write a failing unit test for the shared guard’s disabled/enabled contract.
   Test file: `server/src/modules/agent/spend-kill-switch.test.ts`  
   Level: unit  
   Test intent: Given the configured switch is absent or `false`, When `assertAgentSpendAllowed()` runs, Then it returns without error; Given it is `true`, When it runs, Then it throws the typed error with stable code `AGENT_SPEND_KILL_SWITCH` and message `Agent spend is disabled by kill switch`.  
   Exercise through: exported guard and error class from agent module API.  
   Test doubles: Mock config module value for enabled/disabled cases; do not mock guard/error; no network/DB.  
   Expected RED: guard module and exports do not exist.
5. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.test.ts`
6. Implement one assertion and typed error in `server/src/modules/agent/spend-kill-switch.ts`, export via `server/src/modules/agent/index.ts`; rerun guard test and verify PASS; refactor while green; commit `feat(agent): add global spend guard`.

## REFERENCES LOADED

- Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md` — rules Default off, Deny new spend, Verification.
- `server/src/config.ts`, `server/src/__tests__/config.test.ts`, `server/src/modules/agent/index.ts`, `server/src/modules/agent/service.ts`.
- `docs/pocket/adr/2026-09-16-feature-module-convention.md` — module public API and 300-on-touch.
- Zod `4.4.3` (lockfile-resolved); official API docs: `https://zod.dev/api` (enum and object parsing); Context7 was not available in this session. Existing config enum and `resolveConfig` tests confirm repository usage. No new API beyond existing Zod calls is required.

## WHY THIS APPROACH

Complexity: standard.  
Justification: A small config addition plus a public typed contract used by multiple feature boundaries; the error’s stable shape and default must be established before consumers work in parallel.

## SANDWICH CONTEXT

[CRITICAL: Cross-feature consumers must use the guard/error only through `server/src/modules/agent/index.ts`; do not create a deep-import dependency.]  
You are implementing the shared startup config and guard for the Global Agent Spend Kill Switch.  
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
Design decision: one shared `assertAgentSpendAllowed()` assertion and typed error, with explicit HTTP-boundary mapping.  
Files in scope: `server/src/config.ts`, `server/.env.example`, `server/src/modules/agent/spend-kill-switch.ts`, `server/src/modules/agent/index.ts`, `server/src/modules/agent/spend-kill-switch.test.ts`, `server/src/__tests__/config.test.ts`.  
Architecture rule: The flag is startup-only, enum-limited to string values `true`/`false`, default false; keep server ESM `.js` specifiers.  
[RESTATE: Cross-feature consumers must use the guard/error only through `server/src/modules/agent/index.ts`; do not create a deep-import dependency.]

## DELIVERABLE

Given the flag is absent or `false`, When config is resolved and the guard is asserted, Then spend is allowed.  
Given the flag is `true`, When the guard is asserted, Then a typed error with stable code/message is thrown.  
Given an invalid flag string, When config is resolved, Then validation rejects startup/config resolution.

## QUALITY BAR

Must-have:
- One assertion/error definition shared by all affected feature surfaces.
- Test default false, explicit false/true, invalid value, stable error message/code.
- New source file remains within 300 lines; use only `agent/index.ts` as external API.

Must-not-have:
- No runtime hot-reload, dependency, UI, DB/schema, or migration work.

Open question risks:
- Startup-only semantics are intentional; env changes require recreation. If this assumption changes, stop and request design clarification.

Rollback note:
- Remove the config/env additions and guard module/export; no data rollback required.

Red flags:
- Work outside listed files → DONE_WITH_CONCERNS.
- Duplicated assertion or error contracts → STOP.

## STOP CONDITIONS

Done when all unit tests pass and downstream modules can import the same typed contract through the public API.  
Uncertain when the existing config pattern cannot express the string enum/default without a new dependency.  
Escalate when a consumer proposes deep imports or an in-flight guard.

---

### Task 2: Guard agent spend entrances before side effects [depends: T1]

## OBJECTIVE

**Regression baseline (write/run before any production edits in this task; these are characterization checks, not RED cycles):** In `server/src/modules/agent/service.test.ts`, exercise independently: running-board message storage remains allowed; cancel-regenerate remains allowed; confirmation without pending intent remains a success no-op; two concurrent confirmations for one pending intent cause at most one claim/mutation/pipeline start; default-off create continues; default-off approve continues; default-off clarification/follow-up continues. Level: unit. Exercise through the corresponding real service methods with config/guard left real for default-off cases and spies for side effects. Test doubles: stub DB/LLM collaborators, not service/guard. Run `npm run test --workspace=server -- src/modules/agent/service.test.ts`; each characterization test must pass against current behavior before implementation begins. Keep these checks and rerun after guard changes.

1. Write a failing board-creation test.
   Test file: `server/src/modules/agent/service.test.ts`  
   Level: unit  
   Test intent: Given valid create input and rejecting guard, When `createBoard` runs, Then typed error escapes before classifier, inserts, or event.  
   Exercise through: `createAgentBoardService().createBoard`.  
   Test doubles: Controlled guard/config; spies for LLM, persistence, and events; keep service real.  
   Expected RED: current create path invokes classifier without guard.
2. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
3. Do not edit production yet; keep create denial red and write/run all remaining denial tests before shared service changes.
4. Write a failing approval ordering test.
   Test file: `server/src/modules/agent/service.test.ts`  
   Level: unit  
   Test intent: Given owned pending board and rejecting guard, When `approveBoard` runs, Then rejection precedes period detection, state transition, and events; Given missing/wrong-workspace/non-owner board, Then existing 404/403 wins without guard.  
   Exercise through: service `approveBoard`.  
   Test doubles: Stub board lookup, guard, detector, updater, and publisher; keep service real.  
   Expected RED: detector/approval currently run without an assertion.
5. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
6. Keep production unchanged until the complete service-denial test set has been run red.
7. Write a failing pending-board conversation test.
   Test file: `server/src/modules/agent/service.test.ts`  
   Level: unit  
   Test intent: Given an owned pending non-status-report board and rejecting guard, When `sendMessage` needs a clarification question, Then no user/assistant message or intent update occurs and no clarifier runs.  
   Exercise through: service `sendMessage`.  
   Test doubles: Board lookup, guard, and LLM/write spies; keep branch logic real.  
   Expected RED: current pending path writes the user message before LLM.
8. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
9. Keep production unchanged; continue to the separate follow-up test before implementing the shared pending-message branch.
10. Write a failing completed-board follow-up test.
    Test file: `server/src/modules/agent/service.test.ts`  
    Level: unit  
    Test intent: Given completed board and rejecting guard, When follow-up is sent, Then no classifier, conversation/event write, or pending regenerate state is created.  
    Exercise through: service `sendMessage`.  
    Test doubles: Artifact/history lookup and guard; spy on LLM/writes/events; keep service real.  
    Expected RED: current code classifies and writes without a guard.
11. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
12. Keep production unchanged until all service denial tests are written and verified red.
13. Rerun the prewritten running-board-message regression from the baseline phase; verify it remains allowed with switch enabled and existing response/write behavior.
14. Run regression: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
15. If the existing behavior regresses, remove the incorrectly broad guard and preserve the non-spend branch; this is a regression check, not a RED cycle.
16. Write a failing regenerate-claim test.
    Test file: `server/src/modules/agent/service.test.ts`  
    Level: unit  
    Test intent: Given a pending regenerate intent created while assertion allows and assertion then rejects, When confirmation is attempted, Then rejection occurs after synchronous intent lookup but before pending consumption and all conversation/status/output/card/event/pipeline changes; a later allowed confirmation can still consume the intent.  
    Exercise through: same service instance and `confirmRegenerateBoard`.  
    Test doubles: Controlled synchronous guard sequence and persistence/event/pipeline spies; keep the in-memory pending map and confirmation logic real.  
    Expected RED: current confirm deletes the pending intent before side effects and has no assertion.
17. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
18. Keep production unchanged; continue to the direct-entry denial tests before editing shared conversation logic.
19. Write a failing direct `runPipeline` test.
    Test file: `server/src/modules/agent/service.test.ts`  
    Level: unit  
    Test intent: Given rejecting guard, When `runPipeline` is called directly, Then typed error escapes before reads, execution, writes, or events.  
    Exercise through: service `runPipeline`.  
    Test doubles: Guard and dependency spies; keep pipeline implementation real.  
    Expected RED: direct entry currently has no assertion.
20. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
21. Keep production unchanged; continue writing independent entrypoint tests before editing pipeline logic.
22. Write a failing direct `triggerExecution` test.
    Test file: `server/src/modules/agent/service.test.ts`  
    Level: unit  
    Test intent: Given rejecting guard, When `triggerExecution` is called directly, Then typed error escapes before reads/events/execution/writes and is not swallowed into failed state.  
    Exercise through: service `triggerExecution`.  
    Test doubles: Guard and dependency spies; keep pipeline implementation real.  
    Expected RED: no entry assertion exists and errors within current `try` are caught.
23. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
24. Keep production unchanged; continue to the in-flight placement test before pipeline edits.
25. Write a failing in-flight completion regression test.
    Test file: `server/src/modules/agent/service.test.ts`  
    Level: unit  
    Test intent: Given `runPipeline` starts and its entry assertion allows, When pipeline proceeds through deferred card work, Then it invokes the guard exactly once and completes; any second invocation rejects the test.  
    Exercise through: multi-step `runPipeline` with deferred card dependency.  
    Test doubles: Guard fails if called a second time; defer/mock card execution and persistence only.  
    Expected RED: current `runPipeline` has no entry assertion, so the expected initial guard call is absent; after adding it, the guard double must reject any second/mid-run call. This verifies placement without hot-toggle assumptions.
26. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
27. Keep production unchanged; write the remaining status-report denial test before implementing the guards.
28. Write a failing status-report period detection test.
    Test file: `server/src/modules/agent/service.test.ts`  
    Level: unit  
    Test intent: Given an owned pending status-report board and rejecting guard, When `sendMessage` enters period detection, Then rejection happens before user/assistant writes, board intent update, or period-detector call.  
    Exercise through: service `sendMessage` on status-report branch.  
    Test doubles: Board lookup, guard, detector, and write spies; keep service real.  
    Expected RED: status-report path currently writes first and invokes detector without assertion.
29. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/service.test.ts`
30. All independent service denial tests should now be red against the unchanged implementation. Implement guards at create before classifier; approve after existence/workspace/owner checks and before report-period detection/atomic update; pending clarification and status-period branches before any user write/detector; completed-board follow-up before classify/write; regenerate after synchronous intent lookup but before delete with no intervening await; and at the first line of `runPipeline` and `triggerExecution` (outside triggerExecution's catch). Keep assertion out of pipeline/card mid-run. Run `npm run test --workspace=server -- src/modules/agent/service.test.ts` and verify all denial cases pass, then refactor while green.
31. Rerun all prewritten baseline regression checks (running-board message, cancel, no-pending confirmation, concurrent confirmation claim, default-off create/approve/conversation) and the in-flight completion placement check using `npm run test --workspace=server -- src/modules/agent/service.test.ts`; verify all remain green after guard changes, refactor while green, and commit `fix(agent): block new spend at agent entrypoints`.















## REFERENCES LOADED

- Spec rules Default off, Deny new spend, No denied-request writes, Preserve non-spend behavior and in-flight work, Access/validation precedence; implementation notes for regenerate claim and direct methods.
- `server/src/modules/agent/service.ts`, `board-conversation.ts`, `pipeline.ts`, `service.test.ts`, `service-types.ts`, `routes.ts`.
- Zod `4.4.3` docs listed in T1; no external API is introduced in this task.

## WHY THIS APPROACH

Complexity: standard.  
Justification: Several stateful branches share one feature but differ in precedence and side effects; tests must prove both denied spend and explicitly allowed DB-only paths.

## SANDWICH CONTEXT

[CRITICAL: The assertion must run before writes/LLM starts and never inside a running pipeline/card; preserve access checks and the synchronous regenerate claim.]  
You are guarding agent board service and direct pipeline entrypoints.  
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
Design decision: shared typed assertion at spend-bearing entrances.  
Files in scope: `server/src/modules/agent/service.ts`, `board-conversation.ts`, `pipeline.ts`, `service.test.ts`; consume T1 guard via in-module import.  
Architecture rule: Keep all existing access/state and no-LLM behavior; direct `runPipeline`/`triggerExecution` calls also require defense.  
[RESTATE: The assertion must run before writes/LLM starts and never inside a running pipeline/card; preserve access checks and the synchronous regenerate claim.]

## DELIVERABLE

Given a valid spend-bearing agent action and switch enabled, When service entry is invoked, Then typed rejection occurs before LLM, state/message/event writes, or pipeline start.  
Given a request fails ownership/existence checks, When switch is enabled, Then existing 404/403 behavior wins.  
Given no spend is started (running-board message, cancel, or no-pending regenerate confirmation), When switch is enabled, Then the existing DB-only/no-op behavior remains.  
Given a pipeline passes its initial assertion, When later work completes, Then no mid-pipeline guard interrupts it.

## QUALITY BAR

Must-have:
- Cover each spend-bearing service branch and both direct pipeline methods.
- Guard must precede all request-caused writes and LLM calls; preserve typed error propagation through `triggerExecution`.
- Rejected regenerate confirmation leaves its in-memory pending intent available; assert synchronously between intent lookup and delete with no intervening `await`.
- Do not gate running-board message storage, cancel, or no-pending confirmation.

Must-not-have:
- No guard in `executeCard`, `runPipelineCard`, `runChatTurn`, or midway through a pipeline; no cancellation of in-flight work.

Open question risks:
- Pending regenerate is in-memory and startup-only config cannot live-toggle. The test-only controlled guard demonstrates rejection without making a hot-toggle promise.

Rollback note:
- Revert assertions and service tests; shared guard/config removal remains T1 rollback.

Red flags:
- Any assertion after write/LLM or any awaits between regenerate `get`/`delete` → STOP.

## STOP CONDITIONS

Done when targeted service tests pass and existing concurrency tests continue passing.  
Uncertain when selecting whether a branch spends requires reaching a materially different runtime behavior than the spec.  
Escalate if maintaining current ownership/validation precedence requires checking authorization after a write.

---

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

---

### Task 4: Reject chat send and retry before streaming [depends: T2] [test-risk]

## OBJECTIVE

**Regression baseline (write/run before any handler source edit; expected to PASS today, not RED cycles):** In `server/src/modules/chat/routes.test.ts`, independently characterize: thread read/list/create/rename/delete DB-only operations remain available; valid default-off send and retry retain current streaming behavior; and, using the retry action path for each case, invalid retry target returns current 404, inaccessible thread returns current 404, locked rate limit returns current 429, and oversized retry context returns current 413. Verify the status/body and that no stream or persistence side effect occurs for each blocked retry. Level: integration through the real chat router/Supertest. Test doubles: mock service, auth/access, limiter, and LLM dependencies; keep route/handler real. Run `npm run test --workspace=server -- src/modules/chat/routes.test.ts` before editing `message-stream.ts`; record baseline statuses/bodies and rerun after implementation.

1. Write a failing HTTP test for chat send rejection before stream/persistence.
   Test file: `server/src/modules/chat/routes.test.ts`  
   Level: integration  
   Test intent: Given switch enabled and a valid send request after authentication, thread/membership access, context preparation, and rate-limit checks, When it is posted, Then exact 503 JSON is returned before SSE/NDJSON headers, user/assistant inserts, or `runChatTurn`.  
   Exercise through: chat Express router message endpoint with Supertest.  
   Test doubles: Mock auth, membership, config/guard state, service persistence, rate limiter, and `runChatTurn`; keep router/message handler real.  
   Expected RED: chat currently sends stream headers then persists before LLM and has no JSON kill-switch boundary.
2. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/chat/routes.test.ts`
3. Do not edit `message-stream.ts` yet; keep send denial test red until the retry denial test also fails.
4. Write a failing retry denial test.
   Test file: `server/src/modules/chat/routes.test.ts`  
   Level: integration  
   Test intent: Given switch enabled, valid accessible thread, valid retry target, adequate context, and unlocked rate limit, When retry is requested, Then exact 503 occurs before headers, target deletion, placeholder creation, or `runChatTurn`.  
   Exercise through: Supertest retry endpoint and real pre-stream handler.  
   Test doubles: Mock thread/message persistence, access, limiter, and LLM; keep `createPostMessageHandler` and header setting real.  
   Expected RED: retry currently persists/deletes and starts streaming because no guard response exists.
5. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/chat/routes.test.ts`
6. With both send and retry denial tests red and all baseline checks prewritten, implement one guard in `message-stream.ts`: import through `../agent/index.js`, check after access/history/context/rate limit and before `setStreamHeaders`, map only the typed error to exact JSON 503, and leave unrelated errors unchanged. Run `npm run test --workspace=server -- src/modules/chat/routes.test.ts`; verify send and retry denial tests pass, then refactor while green.
7. Rerun prewritten DB-only chat baseline cases with switch enabled; verify thread read/list/create/rename/delete remain available without guard/LLM calls.
8. Rerun prewritten default-off send and retry baselines; verify current NDJSON output, persistence, and LLM calls remain allowed.
9. Rerun prewritten retry-path precedence cases independently with switch on: invalid retry target 404; inaccessible thread 404; locked limiter 429; oversized retry context 413. Verify each existing status/body wins before kill-switch mapping and no stream/persistence starts.
10. Run final regression suite: `npm run test --workspace=server -- src/modules/chat/routes.test.ts`
11. Confirm all prewritten access/rate-limit/context and DB-only regressions remain green; commit `fix(chat): guard streaming spend boundary`.

## REFERENCES LOADED

- Spec rules Chat send/retry denied before streaming, Preserve non-spend behavior, Access/validation precedence.
- `server/src/modules/chat/message-stream.ts`, `message-runtime.ts`, `message-generation.ts`, `routes.ts`, `routes.test.ts`, `stream-protocol.ts`; `server/src/modules/agent/index.ts`.
- Express `5.2.1` official guide cited in T3; Supertest `7.2.2`/Vitest `4.1.10` lockfile versions. Existing tests exercise stream output and persistence. Context7 not available; no new library behavior is assumed.

## WHY THIS APPROACH

Complexity: standard.  
Justification: The boundary must serialize a typed error as JSON before an NDJSON response starts, while proving the service/stream collaboration and preserving access/rate-limit/context behavior. Marked `[test-risk]` because test level and stream-header boundary are consequential.

## SANDWICH CONTEXT

[CRITICAL: The chat guard must run before stream headers and persistence; import the agent guard through its public `index.ts` only.]  
You are guarding the chat send/retry HTTP entrypoint, not the running LLM helper.  
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
Design decision: typed shared guard with explicit HTTP mapping.  
Files in scope: `server/src/modules/chat/message-stream.ts`, `server/src/modules/chat/routes.test.ts`; depends on T1 and T2.  
Architecture rule: Do not modify `runChatTurn` or `message-generation.ts`; no stream header or `persistMessageStart` side effect may precede rejection.  
[RESTATE: The chat guard must run before stream headers and persistence; import the agent guard through its public `index.ts` only.]

## DELIVERABLE

Given valid chat send/retry and switch on, When request is handled, Then exact 503 JSON arrives without stream headers, inserts/deletes, placeholders, or LLM calls.  
Given invalid, inaccessible, rate-limited, or over-context request, When switch is on, Then existing response remains higher priority.  
Given thread CRUD/read or another DB-only operation, When switch is on, Then it remains unaffected.

## QUALITY BAR

Must-have:
- Prove both send and retry at HTTP boundary and verify no persistence, deletion, placeholder, stream header, or `runChatTurn` call.
- Preserve validation, access, context-size, and rate-limit order.
- Import through `../agent/index.js` only.

Must-not-have:
- No guard in `runChatTurn`, stream generation, or any in-progress response; no chat thread CRUD changes.

Open question risks:
- Rate-limit checks precede the assertion and can still account for rejected attempts as before.

Rollback note:
- Revert handler change and tests; no data rollback is needed.

Red flags:
- Any response headers sent before typed-error mapping → STOP.

## STOP CONDITIONS

Done when send/retry HTTP tests prove no stream or persistence side effect and existing error behavior remains green.  
Uncertain when moving the assertion would reorder context/access/rate-limit behavior.  
Escalate if solution requires modifying the LLM execution helper.

---

### Task 5: Guard ticket extraction but preserve classifier question [depends: T2] [parallel: T4]

## OBJECTIVE

**Regression baseline (write/run before route source edits; expected PASS today, not RED cycles):** In `server/src/modules/agent/ticket-intake/routes.test.ts`, independently characterize first-turn classifier question/no extraction; not-configured 503; malformed input/workspace 400; non-member 404; locked rate-limit 429; and default-off valid extraction response. Level: integration through mounted ticket router/Supertest. Test doubles: auth, membership, configured state, limiter, and extraction as needed; keep route ordering and guard real. Run `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts` before production edits; record current statuses/bodies and rerun after.

1. Write a failing ticket extraction HTTP test for the blocked spend path.
   Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`  
   Level: integration  
   Test intent: Given ticket intake is configured, user is authenticated/member, message is valid, request is not the no-LLM first classifier turn, and rate limit allows it, When extraction is requested with switch enabled, Then exact HTTP 503 JSON is returned before `extractTicketFields` is invoked.  
   Exercise through: mounted ticket-intake router with Supertest.  
   Test doubles: Mock config/guard, auth, membership, rate-limit, configured state, and extraction; keep router/route ordering real.  
   Expected RED: extraction is currently invoked with no shared guard or typed response mapping.
2. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
3. Add the shared assertion immediately before extraction response processing, after configured check, workspace/message validation, membership, first-turn response, and existing rate-limit check. Catch/map only the typed error to exact 503 JSON. Run test and verify PASS; refactor while green.
4. Rerun the prewritten first-turn regression with switch enabled; verify classifier question is returned without guard or extractor call.
5. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
6. Confirm first-turn remains green; this is not a RED cycle.
7. Rerun prewritten not-configured baseline with switch enabled; verify exact existing 503 error/body is returned before kill-switch mapping.
8. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
9. Confirm configuration precedence remains green; this is not a RED cycle.
10. Rerun prewritten malformed-input cases independently; verify existing HTTP 400 response/body precedes guard and extraction.
11. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
12. Confirm validation precedence remains green; this is not a RED cycle.
13. Rerun prewritten non-member case; verify existing HTTP 404 body occurs before guard/extraction.
14. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
15. Confirm membership precedence remains green; this is not a RED cycle.
16. Rerun prewritten locked-rate-limit case; verify exact HTTP 429 response/metadata occurs before guard and extraction.
17. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
18. Confirm rate-limit precedence remains green; this is not a RED cycle.
19. Rerun the prewritten default-off extraction regression; verify extraction and current success/clarification response remain.
20. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
21. Confirm default-off extraction remains green; commit `fix(agent): guard ticket extraction spend and preserve precedence`.

## REFERENCES LOADED

- Spec rules Ticket extraction denied but first classifier question remains available; Access/validation precedence; open assumption that not-configured response wins.
- `server/src/modules/agent/ticket-intake/routes.ts`, `routes.test.ts`, `rate-limits.ts`, `llm.ts`; `server/src/modules/agent/index.ts`.
- Express `5.2.1`, Supertest `7.2.2`, Vitest `4.1.10` references recorded in T3/T4; repository tests mock extraction and route dependencies. No external service docs needed for a guard before existing extraction.

## WHY THIS APPROACH

Complexity: standard.  
Justification: Route branching deliberately separates the first no-LLM turn from extraction and has meaningful ordering across configuration, validation, membership, and rate limiting.

## SANDWICH CONTEXT

[CRITICAL: Guard only the branch that will invoke ticket extraction; preserve the first classifier question and all earlier validation/access/rate-limit responses.]  
You are implementing the ticket-intake HTTP boundary for the spend kill switch.  
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
Design decision: shared typed guard and explicit response mapping at each HTTP boundary.  
Files in scope: `server/src/modules/agent/ticket-intake/routes.ts`, `server/src/modules/agent/ticket-intake/routes.test.ts`; depends on T1/T2, parallel with chat and deployment.  
Architecture rule: Do not gate Linear submit/resubmit or other non-LLM paths.  
[RESTATE: Guard only the branch that will invoke ticket extraction; preserve the first classifier question and all earlier validation/access/rate-limit responses.]

## DELIVERABLE

Given an extraction turn with switch enabled and all existing checks passed, When request reaches extraction, Then exact 503 JSON is returned before extractor call.  
Given the no-LLM first turn or any earlier error condition, When switch is enabled, Then the existing result is returned and no kill-switch error is produced.

## QUALITY BAR

Must-have:
- Preserve exact check order: configured → workspace/message validation → membership → first-turn no-LLM response → rate limit → guard → extraction.
- Assert exact 503 body and extractor-not-called; assert first-turn response and no guard invocation.
- Map only the typed error.

Must-not-have:
- No gate on ticket submit/resubmit, history/config/read, or classifier-only first turn.

Open question risks:
- If not configured, existing 503 must take precedence over kill-switch response.

Rollback note:
- Revert ticket route guard and tests; no persistent data changes.

Red flags:
- Gate before first-turn or rate limit → STOP.

## STOP CONDITIONS

Done when focused ticket route tests prove denial and allow paths with priority preserved.  
Uncertain when a branch unexpectedly invokes LLM despite first-turn condition.  
Escalate if extraction is discovered in a different production path outside the scoped route.

---

### Task 6: Wire production Compose env and operator runbook [depends: T1] [parallel: T2]

## OBJECTIVE

[no-tdd — structural task]

1. Add `AGENT_SPEND_KILL_SWITCH=false` to the production env template and `AGENT_SPEND_KILL_SWITCH: ${AGENT_SPEND_KILL_SWITCH:-false}` to the server environment in `deploy/docker-compose.prod.yml`.
2. Create `deploy/README.md` documenting that the switch is startup-only, defaults off, how to set true/false in `.env.production`, and exact application command from `deploy/`: `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate server`. Explain recreation can interrupt active runs, guard only blocks newly entered work after startup, and do not promise in-flight continuity.
3. Verify rendered Compose config with `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.template config` and inspect server environment confirms false by default. If placeholders prevent rendering, use a temporary non-secret env file with required values and remove it immediately. Ensure no credentials or generated env files are staged.
4. Commit `docs(deploy): document agent spend kill switch`.

## REFERENCES LOADED

- Spec operational setup, deployment env evidence, and rollback plan.
- `deploy/docker-compose.prod.yml`, `deploy/.env.production.template`, `deploy/deploy.sh`; no `deploy/README.md` exists.
- Docker Compose docs: `https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/` (environment interpolation) and `https://docs.docker.com/reference/cli/docker/compose/up/` (`up` recreation/`--force-recreate`). Context7 unavailable. Compose host version is unpinned; treat v2 behavior as deployment assumption, not a guaranteed repository pin.

## WHY THIS APPROACH

Complexity: lightweight.  
Justification: Explicit env mapping and a short operator runbook; no application behavior or external service integration is introduced.

## SANDWICH CONTEXT

[CRITICAL: Production env must be explicitly passed into the server container; changing the env file alone does not alter a running process.]  
You are documenting and wiring deployment for the Global Agent Spend Kill Switch.  
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
Design decision: startup-only environment flag; operators recreate the server container to apply it.  
Files in scope: `deploy/docker-compose.prod.yml`, `deploy/.env.production.template`, `deploy/README.md`; depends on T1 contract and may run parallel with T2.  
Architecture rule: No client or application deployment topology changes beyond forwarding this one env variable.  
[RESTATE: Production env must be explicitly passed into the server container; changing the env file alone does not alter a running process.]

## DELIVERABLE

Compose explicitly forwards the switch with default false, and the runbook documents enable/disable values, startup-only semantics, the server recreation command, and the possibility that recreation interrupts in-flight work.

## QUALITY BAR

Must-have:
- `[no-tdd — structural task]` — this packet changes deployment configuration and operator prose; the validation is rendered Compose config, not application behavior.
- Both values documented; exact compose service recreation command and working directory clear.
- Compose mapping defaults false; no secrets committed.
- Explicitly distinguish in-process guard behavior from effects of container restart.

Must-not-have:
- No runtime toggle, CI call-site guard, or guarantee of in-flight run survival.

Open question risks:
- Docker Compose v2 host version is not pinned; record operational assumption if command behavior differs on the deployment host.

Rollback note:
- Set false in `.env.production` and recreate server; revert deployment/docs changes if needed. Recreation can terminate active runs.

Red flags:
- Relying only on `.env.production` with no service environment mapping → STOP.

## STOP CONDITIONS

Done when rendered Compose config has the default mapping and operator instructions clearly describe enable/disable/recreate semantics.  
Uncertain when the deployed Compose command/version differs materially from documented v2 behavior.  
Escalate before changing deployment topology or adding startup/health mechanisms.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Define startup config and shared spend guard | prereq | standard | default false; true throws typed stable error; invalid enum rejected |
| T2 | Guard agent spend entrances before side effects | T1 | standard | agent requests/direct methods reject before writes; DB-only paths and claim semantics preserved |
| T3 | Map agent guard errors to stable HTTP 503 | T2 | standard | production-mode exact body and access/validation precedence |
| T4 | Reject chat send and retry before streaming | T2 | standard | HTTP 503 before headers/persistence/deletion/LLM; precedence preserved |
| T5 | Guard ticket extraction but preserve classifier question | T2 | standard | extraction denied; first turn and earlier errors remain available |
| T6 | Wire production Compose env and operator runbook | T1 | lightweight | rendered env default false; recreate instructions and restart caveat |

---

## Post-Task Verification

Run after T1–T6 are complete, from the repository root, before declaring implementation complete:

1. `make check` — lint and architecture guards (database key-collision check only if `DATABASE_URL` is set).
2. `npm run typecheck` — server and client typechecks.
3. Run every changed server test suite with workspace-scoped commands:
   - `npm run test --workspace=server -- src/__tests__/config.test.ts`
   - `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.test.ts`
   - `npm run test --workspace=server -- src/modules/agent/service.test.ts`
   - `npm run test --workspace=server -- src/modules/agent/routes.test.ts`
   - `npm run test --workspace=server -- src/modules/chat/routes.test.ts`
   - `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`

Do not use raw `npx vitest run`; integration tests remain opt-in and are not part of this default completion gate.

---

## Preflight and Independent Validation Record

### Preflight Summary

**Codebase scanned:** `server/src/config.ts`, config tests, agent module/service/conversation/pipeline/routes and tests, chat message stream/runtime/generation/routes and tests, ticket-intake route/tests, feature-module ADR, deployment Compose/env/deploy script, workspace scripts and lockfile. Recent history reviewed for affected paths.

**Test framework:** Vitest `4.1.10` and Supertest `7.2.2`; tests are colocated `*.test.ts`, use `vi.fn`/module mocks, injected service dependencies, and Express routers with Supertest. Run from repository root using `npm run test --workspace=server -- <workspace-relative-path>`; do not invoke raw Vitest. DB/LLM integration tests are opt-in and are not required for the planned unit/HTTP suite.

**File conventions:** Server is NodeNext ESM and uses `.js` import suffixes. Tests follow the production feature module. Cross-feature imports use module `index.ts`; `agent` owns the shared spend assertion. `make check` handles lint/architecture guards; typecheck runs separately.

**Existing helpers/patterns:** Config uses `resolveConfig()` and frozen startup config; service methods use dependency injection; chat separates access/history preparation from streaming persistence; route tests mock auth/membership/external calls while keeping router behavior real; global error middleware sanitizes unknown exceptions. Agent public API is `server/src/modules/agent/index.ts`.

**Library/deployment docs checked:**
- Zod `4.4.3`: official API docs `https://zod.dev/api` (object parsing and enums); existing schema follows current enum/default pattern. Context7 unavailable.
- Express `5.2.1`: official error-handling guide `https://expressjs.com/en/guide/error-handling.html`; typed mapping stays at the route boundary.
- Vitest `4.1.10`: version-tagged official `vi` API documentation `https://github.com/vitest-dev/vitest/blob/v4.1.10/docs/api/vi.md`; module mocking/reset pattern.
- Supertest `7.2.2`: version-tagged official README `https://github.com/forwardemail/supertest/blob/v7.2.2/README.md`; supports in-process Express app requests and async assertions used in current tests.
- Docker Compose: official environment interpolation guide `https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/` and `up` reference `https://docs.docker.com/reference/cli/docker/compose/up/`. Host Compose v2 version is not pinned; document as an operational assumption.

**Key findings:** `message-stream.ts` is the pre-SSE chat entrance; do not guard `message-generation.ts`/`runChatTurn`. `runPipeline` and `triggerExecution` are direct spend entrances; no production caller for `triggerExecution` was found. Ticket first-turn classifier is no-LLM. Compose forwards environment explicitly. `deploy/README.md` does not exist. No new dependency, migration, client change, or schema change is planned.

**Unverified area:** Exact Docker Compose v2 behavior on the production host is unverified because the host version is not pinned; the runbook records the recreation command and caveat.

### Independent Reviews and Checks

- Spec review (full plan): `3c0622b2-336f-48b` — Approved for the then-current plan; subsequent semantic edits were separately reviewed below.
- Spec review (Task 3 integration seam): `17e79409-da17-4ad` — Needs revision on an inapplicable pipeline assertion; resolved and confirmed Approved by `29ab6890-5810-499`.
- Spec review (Tasks 2–4 ordering/precedence): `9f89156d-87ab-43c` — Approved; test-first sequencing and switch-off-only 409 contract verified.
- Test strategy audit (first): `affa79c1-38c6-484` — missing real service-to-route integration; applied by making Task 3 create denial use real service/guard/router and confirmed by Spec review `29ab6890-5810-499`.
- Test strategy confirmation audit: `b71cae50-a238-47c` — Clean before the later concurrency-specific audit update.
- Test strategy audit (final): `f469bc15-fda3-4c8` — one missing concurrent-regenerate claim assertion; applied by explicitly including concurrent confirmations in T2 baseline and post-change regression checks. Spec confirmation: `ed2731ad-8f5d-4be` — Approved; actual service/pending map, exact scoped command before and after implementation.
- Focused audit of revised T3 seam: `2c3c0372-62d2-473` — requested no-side-effect assertions for board-message denial; applied to T3 Step 7. Spec confirmation: `8861d0d6-571b-43a` — PASS; exact 503 and no message/state/event/LLM effects confirmed.
- Dry-run validation: `npx -y pocketto-pi structure "docs/pocket/plans/2026-10-10-agent-spend-kill-switch/execution-plan.md" --dry-run --json --contract 3` — pocketto-pi `4.1.0`; JSON `ok: true`, `error: null`, `contract: 3`, `action: single`, `taskCount: 6`, `phaseCount: 1`, `dryRun: true`; execution flow `T1→T2,T6(PARALLEL)→T3,T4,T5(PARALLEL)`. Dry-run wrote no derived artifacts; final invocation follows this record update.

No user authorization to structure or implement is inferred from review approval or dry-run success.
