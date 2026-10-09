# EXECUTION PLAN — Complete shared 400 validation (#197, #198, #199)

**Date:** 2026-10-09
**Spec:** docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
**Status:** draft
**Total tasks:** 16

---

## Execution Overview

### Recommended Order
```
T1 → T2, T3, T4 (parallel) → T5, T6, T7 (parallel) → T8 → T9 → T10 → T11 → T12, T13 (parallel) → T14 → T15 → T16
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### PR Boundaries (one phase = one branch/PR; pocket-structuring splits phases at the same seams; all reference #117 with NO closing keyword)
| PR | Tasks | Issue | Nature | File budget |
|----|-------|-------|--------|-------------|
| PR-1 | T1–T4 | #197 | behavior-preserving (agent + chat) | <=20 files |
| PR-2 | T5–T7 | #197 | behavior-preserving (auth + sse + notifications + activity) | <=20 files |
| PR-3 | T8–T10 | #199 | guard, allowlist = validators/http.ts only; branch from main AFTER PR-1 and PR-2 merge (or stack on them) because T9 asserts the real tree has zero violations | small |
| PR-4 | T11–T13 | #198 (part 1) | behavior-preserving parser unification | small |
| PR-5 | T14–T16 | #198 (part 2) | the ONLY behavior changes (strict workspace id, wording) | ~21 files (T14 ~16, T15 4, T16 1); verify with `git diff --stat` and split the client test into its own PR if it exceeds 20 |

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T3, T4 | T1 completes |
| Group B | T5, T6, T7 | T2, T3, T4 complete (order-only dependency: PR-2 follows PR-1; no code coupling) |
| Group C | T12, T13 | T11 completes |

### Constraints Reminder
**Architecture:** server ESM needs `.js` import extensions; new `.ts` files <=300 lines; 300-on-touch for files already >300; 400 body is `{ error: string; fieldErrors?: Record<string,string> }`; `parseWith` / `sendValidationError` from `server/src/validators/http.ts` are the only senders of 400; never throw zod errors into `error-handler.ts`; validation stays BEFORE any SSE header/stream write; agent must not import chat (`no-chat-imports.test.ts`); shared code only in `validators/` or `lib/`, never cross-feature deep imports; tests run via `npm run test --workspace=server -- <workspace-relative path>` (never `-t "multi word"`); verify with `make check`.
**Out-of-scope:** moving legacy trees into `modules/`; linting 404/409/500; new validation rules (e.g. rejecting duplicate ids); `agent/read-routes.ts:64` dynamic `res.status(statusCode)`; client source edits (client TESTS only in T16); auth wording changes before PR-5.
**Assumptions at risk:** (0) `typescript` resolves from `scripts/` (verified: root node_modules/typescript present); (1) clients send no lenient workspace ids ("", "0", "1e2") — T16 audits (its PR/issue text is drafted in the task report, not committed); (2) `lib/workspace-membership.ts parseWorkspaceId` is unused outside its re-export — T14 greps first; (3) non-object-body wording: planning-time grep found NO drift (only `FOCUS_INVALID_BODY`; `validators/column.ts` is field-level), so T15 changes only the username wording.
**Sequencing:** Dependency order shown is recommended only — pocket enforces actual blocking rules. Do not treat `[depends: TN]` as a hard lock unless the task cannot logically proceed without the prerequisite's output.
**Test-strategy note (refactor tasks T2–T7):** these are behavior-preserving, so their tests are CHARACTERIZATION tests: they pass on today's code BY DESIGN. Proof the test is live: temporarily change one expected string, see it FAIL, restore. Genuine RED cycles exist in T1, T8, T9, T10, T11, T13 (new extractor test; the integration pins are characterization), T14, T15. T12 and T16 are characterization.

### File Structure Map

```
Rule: #197 migration — shared primitive
  Modify: server/src/validators/schemas.ts           (add legacyIntegerParam)
  Test:   server/src/validators/schemas.test.ts

Rule: #197 agent
  Modify: server/src/modules/agent/read-routes.ts    (6 sites)
  Modify: server/src/modules/agent/routes.ts         (5 sites)
  Create: server/src/modules/agent/routes.validation.test.ts   (created by: T2)
  Modify: server/src/modules/agent/ticket-intake/routes.ts     (5 sites)
  Modify: server/src/modules/agent/ticket-intake/submit.ts     (2 sites)
  Create: server/src/modules/agent/ticket-intake/routes.validation.test.ts   (created by: T3)

Rule: #197 chat
  Modify: server/src/modules/chat/routes.ts          (5 sites)
  Modify: server/src/modules/chat/message-stream.ts  (2 sites)
  Create: server/src/modules/chat/routes.validation.test.ts    (created by: T4)

Rule: #197 auth
  Modify: server/src/modules/auth/router.ts          (5 sites)
  Modify: server/src/modules/auth/oauth.ts           (2 sites)
  Create: server/src/modules/auth/auth-schemas.ts    (created by: T5)  (username + password schemas, message passed in)
  Create: server/src/modules/auth/router.validation.test.ts    (created by: T5)
  Create: server/src/modules/auth/oauth.validation.test.ts     (created by: T5)

Rule: #197 one-offs
  Modify: server/src/realtime/sse.ts                 (1 site)
  Create: server/src/realtime/sse.validation.test.ts           (created by: T6)
  Modify: server/src/modules/notifications/router.ts (1 site)
  Modify: server/src/modules/activity/activity.ts    (1 site)
  Create: server/src/modules/notifications/router.validation.test.ts   (created by: T7)
  Create: server/src/modules/activity/activity.validation.test.ts      (created by: T7)

Rule: #199 guard
  Create: scripts/check-inline-400.mjs               (created by: T8; CLI added by: T9)
  Create: scripts/check-inline-400.test.mjs          (created by: T8; CLI cases added by: T9)
  Create: scripts/check-inline-400.wiring.test.mjs   (created by: T10)
  Modify: package.json, Makefile, .github/workflows/ci.yml, CLAUDE.md   (T10)

Rule: #198 unification part 1
  Modify: server/src/validators/schemas.ts           (integerIdArray; workspaceIdParam = positiveIdParam(...))
  Modify: server/src/validators/schemas.test.ts
  Modify: server/src/lib/tracker-item-parsers.ts     (373 lines -> extract; keep 4 named exports)
  Create: server/src/lib/tracker-reference-parsers.ts (created by: T12)   (EXACTLY `parsePriorityId`, `parseLabelIds`, `parseAssigneeIds` = current lines 34-129; they do not use `lookupProject`/`lookupPhase`; barrel drops to ~277 lines; re-exported from tracker-item-parsers.ts)
  Test:   server/src/lib/tracker-item-parsers.test.ts (modify in T12: add parseAssigneeIds matrix, null cases and the export-key pin; existing parseLabelIds/parsePriorityId cases stay)
  Create: server/src/lib/integer-ids.ts              (created by: T13)    (lenient lock-reference extractor)
  Modify: server/src/modules/board/card-create-validation.ts
  Modify: server/src/modules/tracker/tracker-item-create.ts
  Test:   server/src/lib/integer-ids.test.ts (created by: T13), server/src/modules/board/cards-create-metadata.integration.test.ts, server/src/modules/tracker/tracker-item-create-metadata.integration.test.ts, server/src/modules/board/cards-taxonomy.integration.test.ts (PATCH pin), server/src/modules/tracker/tracker-items.integration.test.ts (PATCH pin)

Rule: #198 unification part 2 (behavior changes)
  Modify: server/src/lib/workspace-membership.ts, server/src/lib/helpers.ts   (remove lenient parseWorkspaceId + re-export)
  Modify: server/src/modules/settings/settings-schemas.ts, server/src/modules/my-work/my-work-query-parser-helpers.ts, server/src/modules/my-work/my-work-route-params.ts   (workspaceId: positiveIdParam("...positive integer") -> workspaceIdParam)
  Modify: agent/read-routes.ts, agent/routes.ts, agent/ticket-intake/{routes,submit}.ts, realtime/sse.ts   (legacyIntegerParam -> workspaceIdParam)
  Modify: server/src/modules/auth/oauth.ts, server/src/modules/auth/router.ts, server/src/modules/auth/auth-schemas.ts   (ASCII hyphen username message; one shared constant)
  Modify: server/src/validators/schemas.ts           (remove legacyIntegerParam if unused after T14 (b))
  Modify (tests that pin old strings): server/src/modules/my-work/my-work.validation.test.ts (pins `positive integer` at line ~28), oauth.validation.test.ts, plus any other found by `grep -rn "positive integer\|3–32" server/src`
  Create: server/src/validators/workspace-id.strict.test.ts    (created by: T14)
  Modify: client/src/api.test.ts                     (T16, client TEST only)
```

---

## Pocket Packets

---

### Task 1: Add legacyIntegerParam primitive [prereq]

## OBJECTIVE
Add `legacyIntegerParam(message)` to `server/src/validators/schemas.ts`: a zod schema that reproduces `Number.isInteger(Number(raw))` EXACTLY so #197 can migrate `Number(req.params.x)` sites without changing behavior. Input type is `unknown` (route params AND `req.query` values, which may be arrays/objects). Output is the `Number(raw)` value.

Steps:
1. Write failing test for: legacy-equivalence of the new schema
   Test file: `server/src/validators/schemas.test.ts` (modify existing)
   Level: unit
   Test intent: Given `legacyIntegerParam("m")`, When parsed with "5", "0", "-1", "1e2", "", " 1" Then it succeeds with `Number(raw)` (5, 0, -1, 100, 0, 1); When parsed with the legacy-lenient values null, [] and true Then it succeeds with 0, 0 and 1 respectively (because `Number(null)`, `Number([])` and `Number(true)` are integers — a deliberate pin of legacy leniency, only reachable via `req.query` or JSON-sourced values; add a code comment saying so); When parsed with the array ["1"] Then it succeeds with 1 (`Number(["1"])` is 1); When parsed with "abc", "1.5", undefined and {} Then it fails with error "m"; and for every sample input the schema outcome equals `Number.isInteger(Number(raw))` (table-driven oracle).
   Exercise through: `parseWith(legacyIntegerParam("m"), raw)` from `validators/http.ts`
   Test doubles: none
   Expected RED: `legacyIntegerParam` is not exported from schemas.ts
2. Run test — verify FAIL: `npm run test --workspace=server -- src/validators/schemas.test.ts`
3. Implement with `z.unknown().transform((v) => Number(v)).refine(Number.isInteger, { error: message })`; run the same command — verify PASS; add a doc comment stating it exists only to keep #197 behavior-preserving and is replaced by `workspaceIdParam` in #198; commit: `feat(server): add legacyIntegerParam to preserve Number.isInteger semantics`

## REFERENCES LOADED
docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md — Rule 1 (#197 behavior-preserving), finding F2; `server/src/validators/schemas.ts` (existing `positiveIdParam`, `workspaceIdParam` patterns, zod v4 `{ error }` option); `server/src/validators/http.ts`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: one pure function in one file with an oracle-style test; no judgment beyond the Number() edge cases already enumerated.

## SANDWICH CONTEXT
[CRITICAL: legacyIntegerParam must accept and reject EXACTLY what `Number.isInteger(Number(raw))` accepts and rejects — never reuse workspaceIdParam/positiveIdParam semantics here]
You are implementing the shared primitive for the #197 migration of the shared-400 validation work.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: zod schemas consumed through `parseWith`; keep migration behavior-preserving.
Files in scope: server/src/validators/schemas.ts, server/src/validators/schemas.test.ts
Available after: none (prereq)
Architecture rule: validators/ is kernel; no imports from modules/.
[RESTATE: legacyIntegerParam must mirror `Number.isInteger(Number(raw))` exactly]

## DELIVERABLE
Given "1e2", When parsed by legacyIntegerParam("m"), Then ok with data 100
Given "" , When parsed, Then ok with data 0
Given "abc", When parsed, Then not ok, body `{ error: "m" }`
Given the array ["1"], When parsed, Then ok with data 1
Given any sample, When compared with `Number.isInteger(Number(raw))`, Then outcomes are identical

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Exported from schemas.ts with a doc comment; type of data is `number`
  - Table-driven oracle test comparing against `Number.isInteger(Number(raw))`
Must-not-have:
  - Digit-regex or `> 0` checks (that is workspaceIdParam's job)
  - Touching any route file
Open question risks:
  - zod v4 `.refine` signature differs from v3 → check how `positiveIdParam` is written in the same file and follow it
Rollback note:
  - Revert the commit; nothing depends on it until T2
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass via the command above, no out-of-scope files modified
Uncertain when: oracle test disagrees on an input the spec did not list
Escalate when: a site needs semantics this schema cannot express

---

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

---

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

---

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

---

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

---

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

---

### Task 7: Migrate notifications and activity 400s [depends: T2, T3, T4]

## OBJECTIVE
Replace the two remaining single-site inline 400s: `server/src/modules/notifications/router.ts:117` (`title is required`, non-string or blank `title`) via `parseWith(trimmedRequired("title is required"), title)` (`trimmedRequired` in `validators/schemas.ts` is semantically equal to `typeof title === "string" && title.trim().length > 0`; use only its ok/not-ok result and keep passing the ORIGINAL `title` downstream, discarding the transformed `data`), and `server/src/modules/activity/activity.ts:98` (`card id must be an integer`) via `legacyIntegerParam`.

Steps:
1. Write characterization tests for: both sites
   Test file: `server/src/modules/notifications/router.validation.test.ts` and `server/src/modules/activity/activity.validation.test.ts` (new)
   Level: integration (supertest; db and domainBus mocked)
   Test intent: Given the notifications router, When posting a system alert with title absent, "", "   ", or 5 Then 400 `toEqual({ error: "title is required" })` and `domainBus.emit` was not called; Given a valid title Then validation passes. Given the activity route, When requesting card id "abc" or "1.5" Then 400 `toEqual({ error: "card id must be an integer" })` and the DB is not queried; Given id "1e2" Then no validation 400.
   Exercise through: HTTP via supertest following the setups of `notifications/router.test.ts` and `activity/activity.unified.test.ts`
   Test doubles: mock db, domainBus, auth/membership; not validators
   Expected RED: characterization — passes by design; prove live via mutation.
2. Run baseline: `npm run test --workspace=server -- src/modules/notifications/router.validation.test.ts src/modules/activity/activity.validation.test.ts`
3. Migrate both sites; run `npm run test --workspace=server -- src/modules/notifications src/modules/activity` — verify PASS (DB-bound integration tests need a DB). Then run `npm run typecheck --workspace=server` and `make check` (lint, architecture and feature-module guards — the #197 AC requires the feature-module guard to pass) — verify PASS. Commit: `refactor(server): route notifications and activity 400s through shared validation helper`

## REFERENCES LOADED
Spec — Rule 1; `server/src/modules/notifications/router.ts`, `router.test.ts`, `server/src/modules/activity/activity.ts`, `activity.unified.test.ts`; `server/src/validators/schemas.ts` (`trimmedRequired`).

## WHY THIS APPROACH
Complexity: lightweight
Justification: two independent single-site changes sharing the same pattern.

## SANDWICH CONTEXT
[CRITICAL: Behavior-preserving — identical status, message and body; activity logging (`recordActivity`) behavior must not change]
You are implementing the last two one-off 400 migrations for #197 PR-2.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: parseWith/sendValidationError + existing primitives.
Files in scope: notifications/router.ts, notifications/router.validation.test.ts, activity/activity.ts, activity/activity.validation.test.ts
Available after: T1
Architecture rule: `.js` import extensions; no cross-feature deep imports.
[RESTATE: Identical status/message/body; validation precedes side effects]

## DELIVERABLE
Given blank title, When posting a system alert, Then 400 `{ error: "title is required" }` and nothing emitted
Given card id "abc", When requesting activity, Then 400 `{ error: "card id must be an integer" }` and no DB query
Given both files, When grepped for `status(400)`, Then zero matches
Given existing notifications/activity tests, When run, Then pass unmodified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Bodies pinned with `toEqual`; no side effect before validation
Must-not-have:
  - Passing the trimmed `trimmedRequired` output downstream (it transforms; use only the ok/not-ok result)
  - workspaceIdParam/positiveIdParam use
Open question risks:
  - `trimmedRequired` transforms the stored value → do not pass the transformed value downstream; keep `title` untouched
Rollback note:
  - Revert the migration commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: existing notification title is stored trimmed vs raw and a schema would change it
Escalate when: migration changes persisted data

---

### Task 8: Implement inline-400 AST detection (scanSource) [depends: T5, T6, T7]

## OBJECTIVE
Create `scripts/check-inline-400.mjs` exporting `scanSource(text, relPath)` which returns `[{ line }]` (1-based line of the `.status`/`.sendStatus`/`.writeHead` token) for inline 400 sends, using the TypeScript compiler API (`typescript` resolves from the repo root). Flag a CallExpression whose callee is a property access (or string-literal element access) named `status`, `sendStatus` or `writeHead` and whose first argument is the numeric literal `400`. Comments and string/template literals are ignored because detection is AST-based. Dynamic codes (`res.status(code)`) are intentionally NOT flagged — say so in the file header. The CLI/walk comes in T9; in this task the file only exports `scanSource` (guarded so importing it does not execute the CLI).

Steps:
1. Write failing test for: detection rules
   Test file: `scripts/check-inline-400.test.mjs` (new; `node --test`)
   Level: unit
   Test intent: Given source strings, When passed to `scanSource` Then: `res.status(400).json({})` is flagged with the right line; multiline `res\n  .status(\n    400\n  )` is flagged at the `.status` token line; `res.sendStatus(400)` is flagged; `res.writeHead(400, {})` is flagged; `res["status"](400)` is flagged; `status(400)` appearing only inside a `//` comment, a block comment, a string literal or a template literal is NOT flagged; `res.status(404)`, `res.status(code)` and `res.status(400 + 1)` are NOT flagged; two violations in one file yield two results with distinct lines. Also Given the test environment, When `import("typescript")` is attempted from `scripts/check-inline-400.test.mjs` Then it resolves and exposes `createSourceFile` (documents that the guard relies on the hoisted workspace `typescript`; if this ever fails in CI, add `typescript` to the root `devDependencies` — report NEEDS_CONTEXT first).
   Exercise through: the exported `scanSource`
   Test doubles: none
   Expected RED: `scripts/check-inline-400.mjs` does not exist
2. Run test — verify FAIL: `node --test scripts/check-inline-400.test.mjs`
3. Implement `scanSource`; run the same command — verify PASS. Commit: `feat(scripts): add inline 400 AST detector`

## REFERENCES LOADED
Spec — Rule 2, guard scenarios ("Multiline forms are caught", "Alternate APIs are banned", "Comments and strings do not trip it"), Design Decision (AST chosen); `scripts/check-event-write-routing.mjs` (existing guard style); `server/package.json` (typescript ^5.7.2 resolved from root node_modules).

## WHY THIS APPROACH
Complexity: standard
Justification: AST traversal with several edge forms; each form needs its own test.

## SANDWICH CONTEXT
[CRITICAL: Detection is literal-400 only and AST-based; no regex over raw text, no per-file baseline mechanism]
You are implementing the detector half of the #199 guard.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: TypeScript AST; fallback to a comment/string-stripped regex only if `typescript` cannot be imported from `scripts/` (then report NEEDS_CONTEXT first).
Files in scope: scripts/check-inline-400.mjs, scripts/check-inline-400.test.mjs
Available after: T5, T6, T7 (the #197 migrations)
Architecture rule: plain ESM `.mjs`, no new dependencies, importable without side effects.
[RESTATE: Literal 400 only, AST-based, no baseline mechanism]

## DELIVERABLE
Given `res.status(400)`, multiline `.status(\n400)`, `sendStatus(400)`, `writeHead(400`, `res["status"](400)`, When scanned, Then each is flagged with line numbers
Given the same text only in comments or strings, When scanned, Then nothing is flagged
Given `status(404)`, `status(code)`, `status(400 + 1)`, When scanned, Then nothing is flagged

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Every rule above has a test; `node --test scripts/check-inline-400.test.mjs` is green
  - Header comment documenting the dynamic-code limitation
Must-not-have:
  - Baseline/ratchet file or per-file counts
  - Flagging 404/409/500
  - New npm dependencies
Open question risks:
  - `import("typescript")` fails from `scripts/` in CI (workspace hoisting) → report NEEDS_CONTEXT with the resolution error
Rollback note:
  - Delete the two files; nothing references them until T9/T10
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: a legitimate call shape is neither flagged nor documented as ignored
Escalate when: `typescript` cannot be imported from `scripts/`

---

### Task 9: Add the guard CLI, tree walk and allowlist [depends: T8]

## OBJECTIVE
Extend `scripts/check-inline-400.mjs` with a CLI: walk `server/src/**/*.ts`, skip files `*.test.ts`, `*.test-support.ts`, `*.d.ts` and any `__tests__/` directory, apply `scanSource` to the rest, allow ONLY `server/src/validators/http.ts`, print one `path:line` per violation (repo-relative, forward slashes), and exit 1 on any violation, 0 otherwise. Support `--root <dir>` (the directory containing `server/src`) so tests can use temp trees. No baseline mechanism.

Steps:
1. Write failing test for: CLI and walk behavior
   Test file: `scripts/check-inline-400.test.mjs` (modify)
   Level: integration (temp directories + `spawnSync`, same style as `scripts/feature-modules/wiring.test.mjs`)
   Test intent: Given a temp root with a clean `server/src` Then the CLI exits 0; Given `server/src/modules/board/foo.ts` containing `res.status(400).json({ error: "x" })` Then exit 1 and stdout contains `server/src/modules/board/foo.ts:<line>`; Given the same text in `foo.test.ts`, `foo.test-support.ts`, `foo.d.ts` and `__tests__/foo.ts` Then exit 0; Given the text in `server/src/validators/http.ts` Then exit 0, but in `server/src/validators/other.ts` Then exit 1; Given a missing `server/src` under `--root` Then exit 1 with an explanatory message. Given the real repository root with no arguments Then exit 0 (proves PR-1 and PR-2 left zero violations).
   Exercise through: `spawnSync("node", ["scripts/check-inline-400.mjs", "--root", tmp])`
   Test doubles: none — real temp directories
   Expected RED: the script has no CLI/walk yet (exits 0 silently or does nothing)
2. Run test — verify FAIL: `node --test scripts/check-inline-400.test.mjs`
3. Implement; run the same command — verify PASS; run `node scripts/check-inline-400.mjs` — verify exit 0 on the real tree. Commit: `feat(scripts): add inline 400 guard cli`

## REFERENCES LOADED
Spec — guard scenarios "Clean tree passes", "New inline 400 fails", "Tests and declaration files skipped", AC "allowlist only validators/http.ts"; `scripts/check-event-write-routing.mjs` (walk/skip/report/exit pattern), `scripts/feature-modules/wiring.test.mjs`.

## WHY THIS APPROACH
Complexity: standard
Justification: filesystem walk plus CLI semantics tested through real temp trees.

## SANDWICH CONTEXT
[CRITICAL: Allowlist is exactly `server/src/validators/http.ts`; the guard MUST pass on the real tree; never add allowlist entries to make it pass]
You are implementing the CLI half of the #199 guard.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: AST detector from T8; empty baseline.
Files in scope: scripts/check-inline-400.mjs, scripts/check-inline-400.test.mjs
Available after: T8
Architecture rule: plain ESM `.mjs`; same output/exit conventions as the sibling check-* scripts.
[RESTATE: Allowlist = validators/http.ts only; real tree passes]

## DELIVERABLE
Given a deliberate `res.status(400)` in a non-test route file, When the guard runs, Then exit 1 naming file:line
Given tests/declaration files, When scanned, Then skipped
Given validators/http.ts, When scanned, Then allowed; any other validators file is flagged
Given the real repository, When the guard runs, Then exit 0

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `node --test scripts/check-inline-400.test.mjs` green; real-tree run exits 0
  - A header comment noting the walk/skip logic intentionally mirrors `check-event-write-routing.mjs` (this is the third `walk()`/skip copy after `check-event-write-routing.mjs` and the `check-work-item-mutation-routing.mjs` / `check-feature-modules.mjs` family — those scripts run their CLI at import time and cannot be imported; extracting `scripts/lib/walk.mjs` is deferred)
Must-not-have:
  - Any allowlist entry beyond validators/http.ts
  - Baseline/ratchet file
Open question risks:
  - Real tree reports a violation outside the 11 listed files → report it; do not allowlist
Rollback note:
  - Revert the commit; T8 detector stays
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Guard fails on the real tree → a #197 site was missed

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: a real-tree violation appears in an unexpected file
Escalate when: passing requires any allowlist entry other than validators/http.ts

---

### Task 10: Wire the guard into package.json, Makefile, CI and CLAUDE.md [depends: T9]

## OBJECTIVE
Make the guard run everywhere the sibling guards run, test the wiring, and document the rule.

Steps:
1. Write failing test for: wiring
   Test file: `scripts/check-inline-400.wiring.test.mjs` (new; `node --test`)
   Level: unit (file content assertions)
   Test intent: Given the repository files, When read Then: `package.json` has script `check:inline-400` running `node scripts/check-inline-400.mjs` and a script `test:guards` running `node --test scripts/*.test.mjs`, and the root `test` script invokes `test:guards`; `Makefile` target `check` contains `$(NPM) run check:inline-400`; `.github/workflows/ci.yml` contains a step `npm run check:inline-400` in the primary job; `CLAUDE.md` "Request validation" paragraph mentions `check:inline-400` (assert only this; do not assert on removed prose).
   Exercise through: reading the four files (follow `scripts/feature-modules/wiring.test.mjs`)
   Test doubles: none
   Expected RED: none of the wiring exists yet
2. Run test — verify FAIL: `node --test scripts/check-inline-400.wiring.test.mjs`
3. Edit the four files; replace the CLAUDE.md sentence "Migrate remaining inline 400s incrementally; do not `closes #117` until done." with the guard rule (a new inline `res.status(400)` in `server/src/**` fails `make check`/CI; only `validators/http.ts` may send 400). Run `node --test scripts/*.test.mjs`, then `make check` — verify PASS. Commit: `chore(ci): wire inline 400 guard into make check and CI`

## REFERENCES LOADED
Spec — scenario "Wired everywhere", AC "Guard runs in make check and CI", "CLAUDE.md documents the rule"; `package.json`, `Makefile`, `.github/workflows/ci.yml` (lines ~37–41), `CLAUDE.md` ("Request validation (issue #117)"), `scripts/feature-modules/wiring.test.mjs`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: four small config edits plus a content-assertion test.

## SANDWICH CONTEXT
[CRITICAL: Do not change what existing guards run; only add the new guard and its test script]
You are implementing the wiring for the #199 guard.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: guard + `test:guards` chain; CLAUDE.md edit confined to the "Request validation" paragraph.
Files in scope: package.json, Makefile, .github/workflows/ci.yml, CLAUDE.md, scripts/check-inline-400.wiring.test.mjs
Available after: T9
Architecture rule: keep step order in ci.yml (guards before lint/typecheck/test); tabs in Makefile.
[RESTATE: Only add the new guard; leave existing guard wiring untouched]

## DELIVERABLE
Given `make check`, When run, Then it executes `check:inline-400` and passes
Given ci.yml, When read, Then it has the `check:inline-400` step in the primary job
Given `npm test`, When run, Then guard tests run via `test:guards`
Given CLAUDE.md, When read, Then the rule is documented and the "migrate incrementally" sentence is gone

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Wiring test green; `make check` green
Must-not-have:
  - Edits to other CLAUDE.md sections
  - Reordering existing CI steps
Open question risks:
  - `node --test scripts/*.test.mjs` also picks up `scripts/feature-modules/*` → it must not (glob is single-level); verify it only matches the new file(s)
Rollback note:
  - Revert the commit; guard script remains but unwired
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: `make check` fails for an unrelated pre-existing reason
Escalate when: the root `test` chain cannot include `test:guards` without breaking CI

---

### Task 11: Add integerIdArray and dedupe workspaceIdParam [depends: T10]

## OBJECTIVE
In `server/src/validators/schemas.ts` add `integerIdArray(field)` — a zod schema for "array whose every element passes `Number.isInteger`", failing with `"<field> must be an array of integers"` for non-arrays AND bad elements (including `null`). Use `.refine(Number.isInteger)` on elements, NOT `z.number().int()` (zod v4 `.int()` is safe-integer-only; behavior must match today's `Number.isInteger` loop). Also redefine `workspaceIdParam` as `positiveIdParam(WORKSPACE_ID_MESSAGE)` so digit/safe/positive logic lives once. No caller changes in this task.

Steps:
1. Write failing test for: integerIdArray + workspaceIdParam equivalence
   Test file: `server/src/validators/schemas.test.ts` (modify)
   Level: unit
   Test intent: Given `integerIdArray("labelIds")`, When parsed with [], [1,2], [1,1] Then ok and data unchanged (no dedupe); When parsed with null, "1,2", {}, [1,"x"], [1.5], [null], Then fails with error `labelIds must be an array of integers`; When parsed with undefined Then fails (absence is handled by callers via key presence, as today). Given `workspaceIdParam`, When parsed with "1", "01" Then ok 1; "0", "-1", "1e2", "", " 1", "abc", "9007199254740993" Then error `workspaceId must be an integer` (pins the post-refactor equivalence).
   Exercise through: `parseWith` from `validators/http.ts`
   Test doubles: none
   Expected RED: `integerIdArray` is not exported
2. Run test — verify FAIL: `npm run test --workspace=server -- src/validators/schemas.test.ts`
3. Implement; run the same command — verify PASS; run `npm run test --workspace=server -- src/modules/settings` — verify PASS (consumers of workspaceIdParam unchanged). Commit: `feat(server): add integerIdArray schema and dedupe workspace id param`

## REFERENCES LOADED
Spec — Rules 4 and 5, Design Decision (zod `integerIdArray`); `server/src/validators/schemas.ts`; `server/src/lib/tracker-item-parsers.ts:62-120` (current array loops and messages).

## WHY THIS APPROACH
Complexity: lightweight
Justification: two small schema definitions with table-driven tests; no caller changes.

## SANDWICH CONTEXT
[CRITICAL: integerIdArray must accept/reject exactly what the current parseLabelIds/parseAssigneeIds loops do — `Array.isArray` plus `Number.isInteger` per element, no dedupe, no new rules]
You are implementing the shared schema for #198 PR-4.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: zod `integerIdArray` in validators/schemas.ts consumed by parsers.
Files in scope: server/src/validators/schemas.ts, server/src/validators/schemas.test.ts
Available after: T10
Architecture rule: validators/ is kernel; no imports from modules/ or lib/.
[RESTATE: Same acceptance as today's loops; no new validation rules (no duplicate rejection)]

## DELIVERABLE
Given [1,2], When parsed, Then ok
Given [1,"x"] or null or "1,2", When parsed, Then error "<field> must be an array of integers"
Given [1,1], When parsed, Then ok with duplicates preserved
Given workspaceIdParam after the refactor, When tested with the table above, Then results are unchanged from before the refactor

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Existing workspaceIdParam tests still pass untouched
Must-not-have:
  - `z.number().int()` for elements; duplicate rejection; changes to callers
Open question risks:
  - zod v4 refine API → mirror `positiveIdParam` in the same file
Rollback note:
  - Revert the commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: element refine semantic differs for large floats
Escalate when: equivalence with the current loop cannot be shown by test

---

### Task 12: Extract tracker reference parsers and use integerIdArray [depends: T11]

## OBJECTIVE
`server/src/lib/tracker-item-parsers.ts` is 373 lines and is being touched, so extract (300-on-touch). Move EXACTLY `parsePriorityId` (line 34), `parseLabelIds` (line 62) and `parseAssigneeIds` (line 93) — current lines 34-129, none of which use `lookupProject`/`lookupPhase` — into new `server/src/lib/tracker-reference-parsers.ts` (barrel drops to ~277 lines; both files <=300). Re-export them from `tracker-item-parsers.ts` so `parseProjectPhase`, `parseDateRange`, `parseAssigneeIds` and `parseLabelIds` (and every other current export) stay importable from that exact path (`tracker-items.write.test.ts` mocks it by path). Then rewrite the array check inside `parseLabelIds`/`parseAssigneeIds` to use `integerIdArray` via `parseWith`. Messages unchanged: `labelIds must be an array of integers`, `assigneeIds must be an array of integers`, `label must belong to this workspace`, `assignee must be a member of this workspace`.

Steps:
1. Write characterization test for: parser behavior and re-export surface (extend the EXISTING test file)
   Test file: `server/src/lib/tracker-item-parsers.test.ts` (modify; it already mocks `../db/kysely.js` and has `parsePriorityId`/`parseLabelIds` cases that stay; extend its import list with `parseAssigneeIds`)
   Level: unit (kysely `db` chain mocked as the file already does)
   Test intent: Given the existing `db` mock, When `parseLabelIds({ labelIds: null }, 1)` / `{ labelIds: "1,2" }` / `{ labelIds: [1,"x"] }` / `{}` Then each returns `{ error: "labelIds must be an array of integers" }` and no DB call happened; Given `parseAssigneeIds` with the same four inputs Then `{ error: "assigneeIds must be an array of integers" }`; Given valid assignee ids and a mocked miss Then `{ error: "assignee must be a member of this workspace" }`; Given `[]` for either Then `[]` with no DB calls. Also pin the barrel's full export surface: `Object.keys(await import("./tracker-item-parsers.js"))` equals today's set (record it first; expected today: `parsePriorityId`, `parseLabelIds`, `parseAssigneeIds`, `parseProjectPhase`, `parseCardProjectPhase`, `parseDateRange`), each a defined function.
   Exercise through: the exports of `./tracker-item-parsers.js`
   Test doubles: the existing kysely `db` mock; do NOT mock the parsers
   Expected RED: characterization — passes on current code by design. Prove live: change one expected message, see FAIL, restore.
2. Run baseline — verify PASS: `npm run test --workspace=server -- src/lib/tracker-item-parsers.test.ts`
3. Extract (pure move, same commit includes the extended test file): `refactor(server): extract tracker reference parsers`. Run `npm run test --workspace=server -- src/lib src/modules/tracker src/modules/board`, `wc -l server/src/lib/tracker-item-parsers.ts server/src/lib/tracker-reference-parsers.ts` (both <=300) and `npm run typecheck --workspace=server` — verify PASS; then switch the array check to `integerIdArray` (commit `refactor(server): use integerIdArray in reference parsers`) and re-run the same commands — verify PASS.

## REFERENCES LOADED
Spec — Rule 4, AC "Parsers still exported from lib/tracker-item-parsers", "300-on-touch"; `server/src/lib/tracker-item-parsers.ts`, `tracker-item-parsers.test.ts`; `server/src/modules/tracker/tracker-items.write.test.ts` (path mock); `server/src/lib/work-item-create-metadata.ts`, `board/card-update-parse.ts`, `tracker/tracker-item-update-parse.ts` (importers).

## WHY THIS APPROACH
Complexity: standard
Justification: a mock-by-path constraint plus a size budget plus a schema swap; extraction and rewiring are separate commits.

## SANDWICH CONTEXT
[CRITICAL: Every current export of `lib/tracker-item-parsers.ts` must stay importable from that exact path (tests mock it); behavior and messages must not change]
You are implementing the parser extraction for #198 PR-4.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: integerIdArray consumed by parseLabelIds/parseAssigneeIds; extraction by domain, not utils.
Files in scope: server/src/lib/tracker-item-parsers.ts, server/src/lib/tracker-reference-parsers.ts, server/src/lib/tracker-item-parsers.test.ts
Available after: T11
Architecture rule: `.js` import extensions; extracted file named by responsibility; both files <=300 lines.
[RESTATE: The barrel keeps its full export surface with unchanged behavior]

## DELIVERABLE
Given non-array / null / non-integer element input, When parseLabelIds or parseAssigneeIds runs, Then `{ error: "<field> must be an array of integers" }` and no DB call
Given `[]`, When parsed, Then `[]` without DB calls
Given the module `tracker-item-parsers`, When imported, Then its export keys equal the pinned set and the file is <=300 lines
Given `tracker-items.write.test.ts`, When run, Then it passes unmodified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Extraction commit and rewire commit are separate
  - Existing board/tracker tests pass unmodified
Must-not-have:
  - Changing parser messages or return shapes
  - Adding dedupe or rejecting duplicates
  - Removing exports from `tracker-item-parsers.ts`
  - Moving `lookupProject`/`lookupPhase`/`parseProjectPhase` (they stay)
Open question risks:
  - Line numbers drifted since planning → re-derive the three functions by name; if the barrel is still >300 lines after moving them, report DONE_WITH_CONCERNS with the measured counts
Rollback note:
  - Revert the two commits independently
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: `tracker-items.write.test.ts` mock stops intercepting after the move
Escalate when: an importer needs a different import path

---

### Task 13: Share the lock-reference extractor and pin create rejection [depends: T11] [test-risk]

## OBJECTIVE
Finding F1: create paths already reject non-integer `assigneeIds`/`labelIds` (via `validateTaskCreateMetadata` → `parseLabelIds`/`parseAssigneeIds`); the two local `integerIds` copies only extract references for the pre-lock step. Replace both copies — `server/src/modules/board/card-create-validation.ts:23` and the inline arrow in `server/src/modules/tracker/tracker-item-create.ts:31` — with one named helper `extractIntegerIds(value: unknown): number[]` in new `server/src/lib/integer-ids.ts` (lenient by design: non-array → `[]`, non-integers dropped; it is NOT a validator). Pin that the final create response is still 400 with `fieldErrors`.

Steps:
1. Write characterization pins FIRST, against the UNMODIFIED code (create rejection)
   Test file: `server/src/modules/board/cards-create-metadata.integration.test.ts` and `server/src/modules/tracker/tracker-item-create-metadata.integration.test.ts` (modify: add cases)
   Level: integration (real DB, supertest — same harness as the existing cases in those files)
   Test intent: Given a workspace member and a valid column, When creating a card (and separately a tracker item) with `assigneeIds: [1, "x"]`, then `labelIds: [1.5]`, then `labelIds: null`, then `assigneeIds: "1,2"` Then status 400, `fieldErrors.assigneeIds` / `fieldErrors.labelIds` equal `"<field> must be an array of integers"`, and no card/tracker row, no `card_events`/`tracker_events` row was written; Given `assigneeIds: []` and `labelIds: []` and both absent Then 201.
   Exercise through: `POST /api/workspaces/:id/cards` and the tracker item create endpoint, as the neighboring tests do
   Test doubles: none — real DB; do NOT mock `validateTaskCreateMetadata` or the parsers (the scenario is the collaboration)
   Expected RED: characterization — passes on current code by design (F1). Liveness proof: temporarily weaken the VALIDATION path (e.g. skip the `labelIds`/`assigneeIds` branch in `validateTaskCreateMetadata`) and confirm the 400 / "no row, no event" assertions FAIL, then restore.
2. Write characterization pins FIRST, against the UNMODIFIED code (update rejection; spec scenario "Update unchanged")
   Test file: `server/src/modules/board/cards-taxonomy.integration.test.ts` and `server/src/modules/tracker/tracker-items.integration.test.ts` (modify: add cases next to the existing labelIds PATCH cases; there is no existing PATCH `assigneeIds` case, so add one)
   Level: integration (real DB, supertest)
   Test intent: Given an existing card (and tracker item) with a known version, When PATCH with `labelIds: [1.5]`, then `labelIds: null`, then `assigneeIds: [1, "x"]` Then 400 with the SAME message the update path returns today (`labelIds must be an array of integers` / `assigneeIds must be an array of integers`; read the observed body from the baseline run and pin it with `toEqual`) and the row's `version` and labels/assignees are unchanged.
   Exercise through: the PATCH endpoints used by the neighboring cases in those files
   Test doubles: none — real DB; do NOT mock `parseLabelIds`/`parseAssigneeIds`
   Expected RED: characterization — passes on current code by design. Liveness proof: weaken the validation path in `parseLabelIds` (e.g. accept non-integers) and confirm the PATCH assertions FAIL, then restore.
3. Run the pins on the unmodified code (needs the Postgres from `make db-up`/CI). These suites use `describe.skipIf(!process.env.RUN_INTEGRATION)`: WITHOUT `RUN_INTEGRATION=1` they are skipped and "pass" vacuously — confirm the skipped count is 0. The `primary` CI job does not run them, only `db-integration` does, so the swap in Step 6 is proven in that job. Verify PASS: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/board/cards-create-metadata.integration.test.ts src/modules/tracker/tracker-item-create-metadata.integration.test.ts src/modules/board/cards-taxonomy.integration.test.ts src/modules/tracker/tracker-items.integration.test.ts`. Commit: `test(server): pin create and update rejection of non-integer reference ids`
4. Write failing test for: the extractor
   Test file: `server/src/lib/integer-ids.test.ts` (new)
   Level: unit
   Test intent: Given `extractIntegerIds`, When called with [1,"x",2.5,3], null, "1,2", undefined, {} , [] Then returns [1,3], [], [], [], [], [] respectively; the header comment states it is NOT validation.
   Exercise through: the exported function
   Test doubles: none
   Expected RED: `./integer-ids.js` does not exist
5. Run test — verify FAIL: `npm run test --workspace=server -- src/lib/integer-ids.test.ts`
6. Create the helper, replace both local copies, then re-run Step 3's command AND the Step 5 command — verify PASS (the pins from Steps 1–2 now prove the swap is behavior-identical). Commit: `refactor(server): share lock-reference id extractor`

> Test **intent** only — never test source code.

## REFERENCES LOADED
Spec — finding F1, Rule 3 (amended), scenarios "Board create rejects non-integer assigneeIds (already true; pin it)", "Absent and empty arrays stay valid"; `server/src/lib/work-item-create-metadata.ts:105-150`, `board/card-create-validation.ts`, `tracker/tracker-item-create.ts`, `board/cards-create-metadata.integration.test.ts:255` (existing 400 pin).

## WHY THIS APPROACH
Complexity: standard
Justification: de-duplication is simple, but the pinning tests cross create handler → lock step → metadata validation → DB and need a real DB to prove nothing is persisted.

## SANDWICH CONTEXT
[CRITICAL: Create must keep rejecting non-integer reference ids with 400 + fieldErrors and persist nothing; the extractor is lenient lock-reference plumbing only — never use it to validate]
You are implementing the duplicate-removal and pinning for #198 PR-4.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: one named domain helper in lib/; validation stays in parseLabelIds/parseAssigneeIds.
Files in scope: server/src/lib/integer-ids.ts, server/src/lib/integer-ids.test.ts, server/src/modules/board/card-create-validation.ts, server/src/modules/tracker/tracker-item-create.ts, the four integration test files (create-metadata x2, cards-taxonomy, tracker-items)
Available after: T11
Architecture rule: `.js` import extensions; new files <=300 lines; board and tracker must not import each other.
[RESTATE: Create still returns 400 with fieldErrors for bad ids and persists nothing]

## DELIVERABLE
Given `[1,"x",2.5,3]`, When extracted, Then `[1,3]`
Given create with `[1,"x"]` assigneeIds, When posted (card and tracker), Then 400 with `fieldErrors.assigneeIds` and zero rows/events written
Given absent or `[]` ids, When posted, Then 201
Given PATCH with `labelIds: [1.5]` / `null` / `assigneeIds: [1,"x"]`, When sent, Then 400 with the unchanged message and the row untouched
Given grep of `server/src` non-test files, When searching `integerIds`, Then no local copies remain

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Integration cases use real DB and assert zero persisted rows and events
  - Single extractor used by both create paths
Must-not-have:
  - Changing create status codes or messages
  - Using the extractor as validation
Open question risks:
  - No local DB available → report NEEDS_CONTEXT for the integration step; unit steps still complete
Rollback note:
  - Revert the extractor commit and the test commit independently
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: existing integration fixtures cannot express a tracker-item create with ids
Escalate when: the DB harness is unavailable and integration cannot run

---

### Task 14: Single strict workspace-id parser and tighten lenient routes [depends: T12, T13]

## OBJECTIVE
Behavior change (isolated PR-5, the first of two): make `workspaceIdParam` (digits only, safe integer, > 0, message `workspaceId must be an integer`) the ONE workspace-id implementation.
- Before editing: `grep -rn "parseWorkspaceId" server/src` — confirm `lib/workspace-membership.ts parseWorkspaceId` (lenient `Number`-based) and its re-export in `lib/helpers.ts` have no importers; delete both. If a caller exists, migrate it and record it.
- `modules/settings/settings-schemas.ts parseWorkspaceId(params)` remains only as a thin delegate to `workspaceIdParam` (no own logic).
- `modules/my-work/my-work-query-parser-helpers.ts` AND `modules/my-work/my-work-route-params.ts:8` (`workspaceId: positiveIdParam("workspaceId must be a positive integer")`): delete the local schemas/`parseWorkspaceIdValue`'s own schema; use `workspaceIdParam` — the message changes from `workspaceId must be a positive integer` to `workspaceId must be an integer` (listed wording change). Update `modules/my-work/my-work.validation.test.ts` (pins the old string at ~line 28).
- Replace `legacyIntegerParam` with `workspaceIdParam` for workspace ids in `agent/read-routes.ts`, `agent/routes.ts`, `agent/ticket-intake/routes.ts`, `agent/ticket-intake/submit.ts`, `realtime/sse.ts`. In `read-routes.ts`/`routes.ts` the combined check (`ws OR board` → `Invalid params`) is split: invalid ws → `workspaceId must be an integer`; valid ws but invalid board / columnSlug → `Invalid params` (unchanged). Keep `legacyIntegerParam` ONLY for non-workspace ids (thread/card/attachment/board/cardId) — still behavior-preserving there.
- Remove `legacyIntegerParam` if it is then unused; otherwise leave it.

Steps:
1. Write failing test for: strict workspace id everywhere
   Test file: `server/src/validators/workspace-id.strict.test.ts` (new) plus updates to the expected strings in `agent/routes.validation.test.ts`, `agent/ticket-intake/routes.validation.test.ts`, `realtime/sse.validation.test.ts` and `server/src/modules/my-work/my-work.validation.test.ts` plus any other test that pins `positive integer` (find with `grep -rn "positive integer" server/src`)
   Level: integration (supertest per route) + unit (parser)
   Test intent: Split the matrix by transport. PATH-param routes (agent board routes, ticket-intake routes incl. submit, SSE, settings, my-work `/my-work/:workspaceId/...`): Given workspaceId in {"0","-1","1e2","%20" + "1" (a leading space), "abc","1.5","9007199254740993"} Then 400 `toEqual({ error: "workspaceId must be an integer" })` (an empty path segment never matches `:workspaceId` and returns 404, so `""` is NOT a path case). QUERY/UNIT inputs (my-work `?workspaceId=` and the `parseWith(workspaceIdParam, raw)` table): additionally Given `""` Then the same error. "Validation passes" per route is observed as `status !== 400` with membership mocked to succeed (JSON routes via supertest); for the SSE route use a raw `http.get` and assert only the response head, then destroy it and call `manager.shutdown()` (see T6) — never wait for the stream to end. Given "01" or "7" Then validation passes (maps to 1 / 7); Given a valid ws with invalid board id on read-routes Then `{ error: "Invalid params" }` (unchanged); Given a valid ws with `columnSlug` invalid Then `Invalid params`; Given ws "1e2" on a route that formerly accepted it Then now 400 (the tightening).
   Exercise through: HTTP via supertest per route; `parseWith(workspaceIdParam, raw)` for the unit table
   Test doubles: same mocks as the T2/T3/T6 characterization tests; not the validators
   Expected RED: lenient routes still accept "0"/"-1"/"1e2"/""; my-work still says "positive integer"
2. Run — verify FAIL: `npm run test --workspace=server -- src/validators/workspace-id.strict.test.ts src/modules/agent/routes.validation.test.ts src/modules/agent/ticket-intake/routes.validation.test.ts src/realtime/sse.validation.test.ts src/modules/my-work/my-work.validation.test.ts`
3. Implement in three commits: (a) `refactor(server): remove lenient parseWorkspaceId duplicates` — delete the unused lenient copy and the `helpers.ts` re-export, make `settings-schemas.ts` delegate to `workspaceIdParam` (NO behavior change); (b) `fix(server): reject non-positive and non-digit workspace ids on agent and sse routes` — swap `legacyIntegerParam` for `workspaceIdParam` on workspace ids, split the combined `Invalid params` check, remove `legacyIntegerParam` if unused (the isolated, revertable tightening); (c) `fix(server): unify my-work workspaceId wording` — `my-work-query-parser-helpers.ts`, `my-work-route-params.ts` and `my-work.validation.test.ts` (wording `positive integer` -> `an integer`). Run the same command plus `npm run test --workspace=server -- src/modules/my-work src/modules/settings src/modules/agent src/realtime` — verify PASS. `grep -rn "function parseWorkspaceId\|parseWorkspaceIdValue" server/src` must show at most the settings delegate. Run `make check`.

## REFERENCES LOADED
Spec — Rules 5–6, findings F1/F2, AC "one implementation of workspace-id parsing", "each wording change listed", rollback plan; `server/src/validators/schemas.ts`, `lib/workspace-membership.ts`, `lib/helpers.ts`, `settings/settings-schemas.ts`, `my-work/my-work-query-parser-helpers.ts`, route files and characterization tests from T2/T3/T6.

## WHY THIS APPROACH
Complexity: standard
Justification: touches ~10 files and changes observable behavior; must be isolated, listed, and revertable.

## SANDWICH CONTEXT
[CRITICAL: This is the only task allowed to change status behavior — tightening is isolated in its own commit and every changed string/behavior is listed in the PR description]
You are implementing the workspace-id unification for #198 PR-5.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: workspaceIdParam is the single implementation; wrappers only delegate.
Files in scope: validators/schemas.ts, lib/workspace-membership.ts, lib/helpers.ts, settings/settings-schemas.ts, my-work/my-work-query-parser-helpers.ts, my-work/my-work-route-params.ts, my-work/my-work.validation.test.ts, agent/{read-routes,routes}.ts, agent/ticket-intake/{routes,submit}.ts, realtime/sse.ts, and the tests named above
Available after: T12, T13
Architecture rule: `.js` import extensions; files <=300 lines; no cross-feature deep imports.
[RESTATE: Behavior change is confined to workspace-id strictness and wording, in its own commit, listed in the PR description]

## DELIVERABLE
Given ws in {"0","-1","1e2","", " 1","abc"}, When any workspace route is called, Then 400 `{ error: "workspaceId must be an integer" }`
Given ws "01", When called, Then validation passes
Given valid ws and bad board id on read-routes, When called, Then `Invalid params`
Given my-work query workspaceId "abc", When parsed, Then message `workspaceId must be an integer`
Given grep, When searching, Then no second workspace-id implementation exists
Given the PR description draft, When read, Then it lists: lenient→strict routes, my-work wording change, split `Invalid params` behavior

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Three commits: (a) duplicate removal with no behavior change, (b) tightening, (c) my-work wording — each behavior change in its own commit and listed in the PR description
  - Updated tests listed in the PR description
Must-not-have:
  - Changes to `read-routes.ts:64`
  - Using workspaceIdParam for non-workspace ids
  - Silent wording changes not listed
Open question risks:
  - Lenient parser has a live importer → migrate it and report DONE_WITH_CONCERNS
  - A client sends a lenient ws id → surfaces in T16; revert the tightening commit if so
Rollback note:
  - Revert commit (b) to restore lenient parsing while keeping the unification; revert (c) to restore the my-work wording
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - A second implementation remains → STOP

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass and `make check` is green
Uncertain when: a hidden caller depends on lenient parsing
Escalate when: strictness breaks an existing test not related to wording

---

### Task 15: Unify username wording [depends: T14]

## OBJECTIVE
Wording unification (behavior change, user-approved table): `auth/oauth.ts` username message becomes the ASCII form `Username must be 3-32 characters: letters, numbers, underscore.` (same as `auth/router.ts`); export ONE message constant from `auth/auth-schemas.ts` (created in T5) and use it in both routes so the string exists once. Non-object-body wording: the planning-time inventory (`grep -rnE "Invalid request body|must be an object|body must|Invalid body" server/src --include=*.ts`, non-test) found NO drift — only `FOCUS_INVALID_BODY` in `focus-session-parse.ts` and field-level `columns[i] must be an object` in `validators/column.ts` — so nothing changes there. Field-specific messages and non-workspace `Invalid params` stay.

Steps:
1. Write failing test for: the unified wording
   Test file: `server/src/modules/auth/oauth.validation.test.ts` (modify the EN DASH expectation created in T5 to the ASCII message)
   Level: integration (supertest, same doubles as T5)
   Test intent: Given the oauth set-username endpoint (user with `username: null`), When the username is too short or has illegal characters Then 400 `toEqual({ error: "Username must be 3-32 characters: letters, numbers, underscore." })` with an ASCII hyphen (assert the dash char code is 45, not U+2013); Given register (`router.validation.test.ts` case) and oauth with the same invalid username Then the two response bodies are identical.
   Exercise through: HTTP via supertest, same setup as T5
   Test doubles: same as T5 (mock `db/kysely.js`, login limiter, stub `requireAuth` with `username: null`); not the validators
   Expected RED: oauth still returns the EN DASH message today
2. Run — verify FAIL: `npm run test --workspace=server -- src/modules/auth/oauth.validation.test.ts`
3. Implement (commit `fix(server): unify username validation wording`), update any other test pinning the EN DASH (`grep -rn "3–32" server/src client/src`) and list it; run `npm run test --workspace=server -- src/modules/auth` — verify PASS (DB-bound `router.integration.test.ts` needs `RUN_INTEGRATION=1` and a DB if available).

## REFERENCES LOADED
Spec — Rule 6 wording table, scenario "Oauth username wording"; `server/src/modules/auth/oauth.ts`, `auth-schemas.ts` (T5), `oauth.test.ts`, `oauth.validation.test.ts`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: one string unification; the body-wording inventory was resolved at planning time.

## SANDWICH CONTEXT
[CRITICAL: Only the approved wording table may change; the username message becomes the ASCII "3-32" form everywhere and exists as one constant]
You are implementing the remaining wording unification for #198 PR-5.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: approved wording table (Rule 6).
Files in scope: server/src/modules/auth/oauth.ts, server/src/modules/auth/router.ts (switch to the shared message constant), server/src/modules/auth/auth-schemas.ts, server/src/modules/auth/oauth.validation.test.ts
Available after: T14
Architecture rule: `.js` import extensions; no new validation rules.
[RESTATE: Only the listed wording change; list it and the updated tests in the PR description]

## DELIVERABLE
Given invalid oauth username, When submitted, Then the ASCII-hyphen message
Given register vs oauth with the same invalid username, When compared, Then identical bodies
Given `grep "3–32"`, When run, Then zero matches in non-doc source

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - One shared username message constant
  - All tests that pinned the old string updated and listed
Must-not-have:
  - New validation rules
  - Changing field-specific messages
Open question risks:
  - A client test or string match depends on the EN DASH → report NEEDS_CONTEXT instead of editing client source
Rollback note:
  - Revert the wording commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: a user-visible client string depends on the old dash
Escalate when: the wording change would break a client test

---

### Task 16: Verify client parsing; draft issue comment and PR text [depends: T14, T15]

## OBJECTIVE
Acceptance criteria: "Client still parses every changed body (`client/src/api.ts` `throwRequestError`)" and "Both open questions answered in this issue" (#198). Add client TESTS only (no client source change), run the client audit, and DRAFT (do not post) the #198 issue comment and the PR-5 description in the task report.

Steps:
1. Write characterization test for: error parsing of the changed bodies
   Test file: `client/src/api.test.ts` (modify; follow how it already fakes `fetch`)
   Level: unit
   Test intent: Given a 400 `Response` with JSON `{ error: "workspaceId must be an integer" }`, then `{ error: "Username must be 3-32 characters: letters, numbers, underscore." }`, then `{ error: "Invalid params" }`, then `{ error: "x", fieldErrors: { assigneeIds: "assigneeIds must be an array of integers" } }` When a public `api` method that calls `throwRequestError` receives it Then the thrown error message equals the body's `error` and `fieldErrors` is preserved where that method exposes it.
   Exercise through: the public `api` method that calls `throwRequestError` (`throwRequestError` itself is NOT exported — `client/src/api.ts:110`; use the method at ~`api.ts:177`)
   Test doubles: fake `fetch`/`Response`; no network
   Expected RED: characterization — passes on current code by design; prove live with a one-string mutation.
2. Run: `npm run test --workspace=client -- src/api.test.ts` — verify PASS
3. Audit (no code change): `grep -rn "workspaceId" client/src/api.ts client/src/lib/workspaceSwitcher.ts` and `grep -rnE "api\.\w+\(.*[Ww]orkspace" client/src | head -50`; confirm every workspace id placed in a URL is a numeric id from state (never free text, empty string or `0`). Run `npm run test --workspace=client` (full) — verify PASS. Commit: `test(client): pin error parsing for unified 400 bodies`
4. Draft (in your final report, NOT committed to the repo): (a) the PR-5 description listing every behavior/wording change from T14 and T15 (lenient->strict workspace routes, my-work `positive integer` -> `an integer`, split `Invalid params`, oauth username dash, tests updated) plus the audit commands and result; (b) the #198 issue comment recording the approved answers (F1: create already rejects non-integer ids, so no 201->400 change; the Rule 6 wording table). Do NOT run `gh issue comment` — posting is outward-facing; return the text to the orchestrator, who asks the user first.

## REFERENCES LOADED
Spec — AC "Client still parses every changed body", Open Questions row on lenient workspace ids, Rule 6; #198 AC1; `client/src/api.ts`, `client/src/api.test.ts`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: client tests only, a documented grep audit, and drafted text.

## SANDWICH CONTEXT
[CRITICAL: Do NOT modify client source files and do NOT post to GitHub — tests, audit and drafts only; if the audit finds a lenient workspace id in client code, STOP and report]
You are implementing the client verification and the closing documentation for #198 PR-5.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: server-only change; the client is verified, not edited.
Files in scope: client/src/api.test.ts
Available after: T14, T15
Architecture rule: client uses bundler resolution (no import extensions); `noUnusedLocals` — no unused imports.
[RESTATE: No client source edits; no GitHub posting; report lenient client ids instead of fixing them]

## DELIVERABLE
Given each changed 400 body, When the public `api` method handles it, Then the thrown message equals the body's `error`
Given the audit, When complete, Then the report states the commands run and that no client path sends non-digit, empty or zero workspace ids (or lists exceptions)
Given the drafts, When returned, Then they list every wording/behavior change and the approved answers
Given the full client suite, When run, Then it passes

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Drafts cover every T14/T15 change
Must-not-have:
  - Client source edits
  - `gh issue comment` / any GitHub write
  - Using `-t "multi word"` filters
Open question risks:
  - Audit finds a lenient client workspace id → report NEEDS_CONTEXT; PR-5 tightening commit (T14 (b)) may need to be dropped
Rollback note:
  - Revert the test commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: no public `api` method surfaces `fieldErrors` for the test
Escalate when: the audit finds a client path that the tightening would break

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | legacyIntegerParam primitive | prereq | lightweight | outcome equals `Number.isInteger(Number(raw))` for all samples |
| T2 | Agent board routes migration | T1 | standard | 11 sites, bodies identical, existing agent tests untouched |
| T3 | Ticket-intake migration | T1 | standard | 7 sites incl. query array edge, bodies identical |
| T4 | Chat migration | T1 | standard | 7 sites, validation before stream write |
| T5 | Auth migration | T2, T3, T4 | standard | 7 sites, byte-identical messages incl. EN DASH |
| T6 | SSE migration | T2, T3, T4 | lightweight | 400 before headers and before 503 |
| T7 | Notifications + activity migration | T2, T3, T4 | lightweight | 2 sites, no side effects before validation |
| T8 | Guard AST detector (scanSource) | T5, T6, T7 | standard | flags all forms, ignores comments/strings |
| T9 | Guard CLI, walk, allowlist | T8 | standard | skips tests/d.ts, allowlist = http.ts, real tree exit 0 |
| T10 | Guard wiring + docs | T9 | lightweight | make check, CI, test:guards, CLAUDE.md |
| T11 | integerIdArray + workspaceIdParam dedupe | T10 | lightweight | exact `Number.isInteger` semantics, no dedupe |
| T12 | Extract parsePriorityId/LabelIds/AssigneeIds | T11 | standard | four exports preserved, barrel <=300 lines |
| T13 | Shared lock extractor + pin create rejection | T11 | standard | create still 400 + fieldErrors, nothing persisted |
| T14 | Single strict workspace-id parser | T12, T13 | standard | one implementation; lenient routes tightened in isolated commit |
| T15 | Username wording unification | T14 | lightweight | ASCII username message; inventory documented |
| T16 | Client parsing verification + issue/PR text | T14, T15 | lightweight | throwRequestError surfaces changed bodies; audit recorded |
