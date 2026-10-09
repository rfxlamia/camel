# Task T4 — Migrate chat routes (routes.ts, message-stream.ts)

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Migrate chat routes (routes.ts, message-stream.ts) [depends: T1]

## OBJECTIVE
Replace 7 inline 400s: `server/src/modules/chat/routes.ts` (5) and `message-stream.ts` (2), behavior-identical, validation staying before any stream write.

Sites:
- routes.ts: `req.params.id` not integer → `thread id must be an integer` (x3: GET/PATCH/DELETE thread); PATCH `title` not a non-blank string → `title is required` (AFTER id); attachment `req.params.id` not integer → `attachment id must be an integer`.
- message-stream.ts: thread id not integer → `thread id must be an integer`; `resolveChatMessageAction(req.body).kind === "invalid"` → `message or action is required` (AFTER id; both are early returns before any SSE write).

Steps:
1. Write characterization test for: every 400 in the two files
   Test file: `server/src/modules/chat/routes.validation.test.ts` (new)
   Level: integration (supertest, chat service mocked)
   Test intent: Given the chat router with mocked service and mocked auth, When each route is called with id "abc", id "1.5", blank/absent/non-string title, invalid message/action body, and id "abc" with an invalid body Then 400 and `res.body` `toEqual({ error: <exact string> })` with id message first; and for the stream route Then `Content-Type` is not `text/event-stream` and no stream write happened. Given id "0" or "1e2" Then validation does not return 400 (legacy leniency).
   Exercise through: HTTP via supertest, following the setup in `chat/routes.test.ts`
   Test doubles: mock service and getUserId/auth; do NOT mock handlers or validators
   Expected RED: characterization — passes on current code by design. Prove live via a one-string mutation.
2. Run baseline — verify PASS + mutation check: `npm run test --workspace=server -- src/modules/chat/routes.validation.test.ts`
3. Migrate the 7 sites. Run `npm run test --workspace=server -- src/modules/chat` — verify PASS (existing `routes.test.ts`, `stream-protocol.test.ts` unmodified). Then run `npm run typecheck --workspace=server` and `make check` (lint, architecture and feature-module guards — the #197 AC requires the feature-module guard to pass) — verify PASS. Commit: `refactor(server): route chat 400s through shared validation helper`

## REFERENCES LOADED
Spec — Rule 1, "SSE validation stays before headers"; `server/src/modules/chat/routes.ts`, `message-stream.ts`, `routes.test.ts`; `server/src/validators/{http,schemas}.ts`.

## WHY THIS APPROACH
Complexity: standard
Justification: 7 sites across two files with an SSE early-return constraint.

## SANDWICH CONTEXT
[CRITICAL: Behavior-preserving; validation stays an early return BEFORE any SSE header/stream write; chat must not import agent]
You are implementing the chat 400 migration for #197 PR-1.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: parseWith/sendValidationError + legacyIntegerParam.
Files in scope: server/src/modules/chat/routes.ts, message-stream.ts, routes.validation.test.ts
Available after: T1
Architecture rule: `.js` import extensions; no cross-feature deep imports (agent<->chat walled).
[RESTATE: Identical status/message/order/body; validation before stream writes]

## DELIVERABLE
Given thread id "abc", When any thread route is called, Then 400 `{ error: "thread id must be an integer" }`
Given blank title, When patched, Then 400 `{ error: "title is required" }`
Given attachment id "abc", When requested, Then 400 `{ error: "attachment id must be an integer" }`
Given invalid message/action body on the stream route, When posted, Then 400 `{ error: "message or action is required" }` and no SSE headers
Given the two files, When grepped for `status(400)`, Then zero matches
Given existing chat tests, When run, Then pass unmodified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Bodies pinned with `toEqual`
  - No-stream-write assertion on the stream route
Must-not-have:
  - Moving validation after SSE headers
  - workspaceIdParam/positiveIdParam use
  - Edits to existing tests
Open question risks:
  - Stream route is hard to exercise through supertest → assert via a mocked response writer and report DONE_WITH_CONCERNS if so
Rollback note:
  - Revert the migration commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: stream route cannot be driven without changing production code
Escalate when: migration needs validation placed after stream start
