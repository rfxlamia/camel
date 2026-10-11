# Task T2 — Guard agent spend entrances before side effects

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
