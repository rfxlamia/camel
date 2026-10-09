# Task T14 — Single strict workspace-id parser and tighten lenient routes

**Phase:** 5
**Depends:** T12, T13
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

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
