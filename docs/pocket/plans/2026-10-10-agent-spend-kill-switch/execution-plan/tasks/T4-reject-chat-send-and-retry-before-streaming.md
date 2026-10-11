# Task T4 — Reject chat send and retry before streaming

**Phase:** 1
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
