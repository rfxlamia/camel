# Task T6 — Migrate realtime SSE workspace-id 400 (sse.ts)

**Phase:** 2
**Depends:** T2, T3, T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Migrate realtime SSE workspace-id 400 (sse.ts) [depends: T2, T3, T4]

## OBJECTIVE
Replace the single inline 400 at `server/src/realtime/sse.ts:47` (`workspaceId must be an integer`) using `legacyIntegerParam`, keeping it an early return BEFORE any `setHeader`/flush and before the shutting-down 503 check.

Steps:
1. Write characterization test for: the SSE handler's 400
   Test file: `server/src/realtime/sse.validation.test.ts` (new)
   Level: integration (real `createSseManager()` from `sse.ts` mounted on a minimal Express app at `/workspaces/:workspaceId/events/stream` (as `routes/presence.ts` mounts it, minus `requireWorkspaceMember`) with a stub middleware that sets `req.user`; there is no hub/presence in `sse.ts` — the manager owns its client map)
   Test intent: Given the real SSE manager, When requested with workspaceId "abc" or "1.5" Then 400 `toEqual({ error: "workspaceId must be an integer" })`, the response content-type is JSON (not `text/event-stream`), and no client was registered (after the request, `fanOut` for any workspace writes nothing to the 400 response); Given `manager.shutdown()` was called AND ws is invalid Then 400 wins over 503 (today's order); Given ws "1e2" or "0" (valid integers, so the handler opens `text/event-stream`, writes `: connected` and installs a 25s keep-alive) Then the response head is NOT a 400 — observe it with a raw `http.get` against a listening server, assert only on status/headers, then destroy the request and call `manager.shutdown()` so the test never hangs. Do NOT use supertest for the 200-path cases (it would wait for the stream to end).
   Exercise through: the exported `createSseManager().handler` mounted exactly as production mounts it
   Test doubles: stub `req.user` middleware only; do not mock the manager, the validator, or Express
   Expected RED: characterization — passes by design; prove live with a one-string mutation.
2. Run baseline: `npm run test --workspace=server -- src/realtime/sse.validation.test.ts`
3. Migrate the site; run `npm run test --workspace=server -- src/realtime` and `src/modules/notifications/sse.test.ts` — verify PASS. Then run `npm run typecheck --workspace=server` and `make check` (lint, architecture and feature-module guards — the #197 AC requires the feature-module guard to pass) — verify PASS. Commit: `refactor(server): route sse workspace-id 400 through shared validation helper`

## REFERENCES LOADED
Spec — Rule 1, scenario "SSE validation stays before headers"; `server/src/realtime/sse.ts`; `server/src/validators/{http,schemas}.ts`; existing sse tests under `server/src/realtime` and `server/src/modules/notifications/sse.test.ts`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: one site in one file; the only subtlety is ordering vs the shutdown check and header writes.

## SANDWICH CONTEXT
[CRITICAL: The 400 must remain an early return before any SSE header write or hub subscription]
You are implementing the SSE 400 migration for #197 PR-2.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: parseWith/sendValidationError + legacyIntegerParam.
Files in scope: server/src/realtime/sse.ts, server/src/realtime/sse.validation.test.ts
Available after: T1
Architecture rule: realtime/ is kernel-in-waiting; `.js` import extensions; no module imports from realtime into modules/.
[RESTATE: 400 stays before headers/subscription; behavior identical]

## DELIVERABLE
Given ws "abc", When the SSE endpoint is requested, Then 400 `{ error: "workspaceId must be an integer" }` and no SSE headers
Given shutting down and invalid ws, When requested, Then 400 (not 503)
Given `sse.ts`, When grepped for `status(400)`, Then zero matches
Given existing realtime/notifications SSE tests, When run, Then pass unmodified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Body pinned with `toEqual`; no-headers assertion
Must-not-have:
  - workspaceIdParam use (strictness arrives in T14)
  - Moving the check after the shutdown test
Open question risks:
  - Handler not exported for testing → test through the router that mounts it; report DONE_WITH_CONCERNS if production code must change
Rollback note:
  - Revert the migration commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: ordering relative to shutdown check cannot be pinned
Escalate when: the handler cannot be reached without editing unrelated files
