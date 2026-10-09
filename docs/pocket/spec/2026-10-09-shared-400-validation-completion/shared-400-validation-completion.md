# Complete shared 400 validation: migration, guard, parser unification

**Date:** 2026-10-09
**Status:** approved
**Author:** brainstorm session
**Spec path:** docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
**Amended:** 2026-10-09 (preflight findings F1, F2; user approved)
**Issues:** #197, #198, #199 (all follow-ups to #117; reference #117 WITHOUT a closing keyword)

---

## Summary

Finish the #117 migration so every request-validation 400 flows through `parseWith` / `sendValidationError`
(`server/src/validators/http.ts`), lock that in with a CI guard, then unify the duplicated parsers and drifting
wording. One plan, three phases, separate PRs: the migration (#197) is behavior-preserving, the guard (#199) lands
after it with an empty allowlist, and the behavior-changing unification (#198) comes last and is isolated.

---

## Context

### Current State
- 36 inline `res.status(400)` remain in non-test files (verified by grep, matches #197):
  agent/read-routes 6, agent/routes 5, agent/ticket-intake/routes 5, agent/ticket-intake/submit 2, chat/routes 5,
  chat/message-stream 2, auth/router 5, auth/oauth 2, realtime/sse 1, notifications/router 1, activity/activity 1.
- #194, #195, #196 (board, workspaces/my-work/focus, settings) are merged. Settings migration already introduced
  `workspaceIdParam` in `validators/schemas.ts`.
- Guards exist as pattern: `scripts/check-event-write-routing.mjs`, `check-work-item-mutation-routing.mjs`,
  `check-feature-modules.mjs` (+ self-tests in `scripts/feature-modules/*.test.mjs`, run by `test:feature-modules`).
  Wired in `Makefile` `check`, `package.json`, `.github/workflows/ci.yml`.
- Duplicated parsers: `parseWorkspaceId` in `lib/workspace-membership.ts` and `modules/settings/settings-schemas.ts`
  (re-exported via `lib/helpers.ts`), `parseWorkspaceIdValue` in `modules/my-work/my-work-query-parser-helpers.ts`;
  `integerIds` (silent drop) in `modules/board/card-create-validation.ts:23` and `modules/tracker/tracker-item-create.ts:31`
  vs rejecting `parseAssigneeIds`/`parseLabelIds` in `lib/tracker-item-parsers.ts` (373 lines).
- **F1 (preflight):** create paths ALREADY reject non-integer `assigneeIds`/`labelIds`: `validateTaskCreateMetadata`
  (`lib/work-item-create-metadata.ts:125,141`) calls `parseLabelIds`/`parseAssigneeIds` (400 + `fieldErrors`; pinned by
  `cards-create-metadata.integration.test.ts:255`). The local `integerIds` copies only extract references for the pre-lock step,
  they do not validate. So there is NO 201->400 change.
- **F2 (preflight):** nearly every #197 site uses `Number(x)` + `Number.isInteger` (accepts "", "0", "-1", "1e2", " 1").
  `lib/workspace-membership.ts parseWorkspaceId` is the same lenient semantics; `settings-schemas.ts parseWorkspaceId` / `workspaceIdParam` are strict.

### Problem / Motivation
Response shape is uniform only where migrated; 36 sites still hand-roll bodies, nothing stops regressions, and the
same condition yields different wording / different status behavior across create vs update.

### Related Areas
`server/src/validators/{http,schemas,input-length}.ts`, `scripts/`, `Makefile`, `package.json`, `.github/workflows/ci.yml`,
`CLAUDE.md` ("Request validation"), `client/src/api.ts` (`throwRequestError`), `scripts/feature-modules/map.mjs`.

---

## Scope

### In-Scope
- **Phase 1 (#197 PR-1):** migrate agent + chat inline 400s (20 sites). Messages byte-identical, check order unchanged.
  Add `legacyIntegerParam(message)` to `validators/schemas.ts`: reproduces `Number.isInteger(Number(raw))` EXACTLY (so "", "0", "-1", "1e2" stay accepted). Do NOT use `workspaceIdParam`/`positiveIdParam` at these sites in #197.
- **Phase 2 (#197 PR-2):** migrate auth (7), `realtime/sse.ts`, `notifications/router.ts`, `activity/activity.ts` (3).
  Auth messages byte-identical incl. oauth.ts EN DASH ("3–32"). The two username checks in `auth/router.ts` may merge into one schema (same message).
- **Phase 3 (#199):** `scripts/check-inline-400.mjs` + self-test; wired into `Makefile check`, `package.json`, `ci.yml`;
  allowlist = `server/src/validators/http.ts` only, NO baseline mechanism; documented in CLAUDE.md "Request validation".
- **Phase 4 (#198, own PR):** one `integerIdArray` schema (used by `parseLabelIds`/`parseAssigneeIds` and replacing both local `integerIds` copies);
  one strict `parseWorkspaceId` (replacing lenient + strict copies and `legacyIntegerParam` uses for workspace id); wording unification; client-payload audit task.

### Out-of-Scope
- Moving legacy trees into `modules/` (unless needed for line budget / 300-on-touch).
- Linting 404/409/500.
- New validation rules (e.g. rejecting duplicate ids).
- `agent/read-routes.ts:64` dynamic `res.status(statusCode)` passthrough (service contract; not a literal 400).
- Auth wording changes in #197 (belong to #198).
- Client changes (verification only that `throwRequestError` parses bodies).

---

## Architecture Constraints

- Layers this work may touch: `server/src/{modules,lib,validators,realtime}`, `scripts/`, `Makefile`, `package.json`, CI workflow, `CLAUDE.md`, tests.
- Must NOT touch: client source, DB schema, fractional positioning, activity logging (`recordActivity`) behavior.
- Patterns: server ESM `.js` import extensions; new `.ts` files <=300 lines; 300-on-touch for files already >300
  (`lib/tracker-item-parsers.ts` extraction required in Phase 4); public API via module `index.ts`; feature-module guard must pass;
  400 body is `{ error: string; fieldErrors?: Record<string,string> }`; pass `{ message }` to pin legacy strings; never throw zod errors into `error-handler.ts`.
- Validation must stay BEFORE any SSE header flush / stream write (`sse.ts`, `message-stream.ts` early returns).
- PR rules: <=20 files per PR; `tracker-items.write.test.ts` mocks `lib/tracker-item-parsers` by path, so keep `parseProjectPhase`, `parseDateRange`, `parseAssigneeIds`, `parseLabelIds` exported from it.
- Run tests: `npm run test --workspace=server -- <workspace-relative path>`; verify with `make check`.
- Architecture validation result: PASS

---

## Dependencies

### Existing (to leverage)
- `zod` — all new schemas (`integerIdArray`, username schema) built on it; `parseWith` already wraps it.
- `typescript` (server devDependency ^5.7.2) — candidate for AST-based guard (see Design Decision).

### New (proposed)
none

---

## Stories + Scenarios

### Story: Behavior-preserving migration (#197)
> As a maintainer, I want every validation 400 sent through the shared helper, so that the body shape is uniform and one place owns it.

**Rule 1: Status, message and check order are unchanged.**
- Example A: `POST /register` username "ab" -> 400 `{error:"Username must be 3-32 characters: letters, numbers, underscore."}`.
- Example B: oauth invalid username -> 400 with EN DASH "3–32" (unchanged until Phase 4).
- Example C: agent read route bad params -> 400 `{error:"Invalid params"}`.

```gherkin
Scenario: Auth register keeps its message
  Given no user "ab" exists
  When  POST /api/auth/register {username:"ab",password:"validpass1"}
  Then  status is 400
  And   body toEqual {error:"Username must be 3-32 characters: letters, numbers, underscore."} (no fieldErrors key)

Scenario: Non-object register body keeps today's behavior
  Given req.body is undefined
  When  POST /api/auth/register
  Then  same status and error text as before the migration

Scenario: Agent read route keeps pinned string
  Given a read route with a non-numeric id param
  When  it is called
  Then  400 {error:"Invalid params"} and read-routes.test.ts passes unchanged

Scenario: SSE validation stays before headers
  Given GET /events with workspaceId "abc"
  When  handler runs
  Then  400 JSON {error:"workspaceId must be an integer"} and no SSE headers were written

Scenario: Existing tests untouched
  Given oauth.test.ts, read-routes.test.ts and chat/agent tests
  When  npm run test --workspace=server
  Then  they pass without edits (new body-pinning tests may be added)
```

### Story: Guard against regression (#199)
> As a maintainer, I want CI to fail on new inline 400s, so that the migration cannot erode.

**Rule 2: Any literal `status(400)` call outside the allowlist fails the guard.**

```gherkin
Scenario: Clean tree passes
  Given only validators/http.ts contains status(400)
  When  npm run check:inline-400
  Then  exit 0

Scenario: New inline 400 fails
  Given modules/board/foo.ts contains res.status(400).json({error:"x"})
  When  the guard runs
  Then  exit 1 and output names modules/board/foo.ts:<line>

Scenario: Multiline forms are caught
  Given `res\n  .status(\n    400\n  )` in a non-test file
  When  the guard runs
  Then  exit 1 with file:line of the .status token

Scenario: Alternate APIs are banned
  Given sendStatus(400) or writeHead(400 in a non-test file
  When  the guard runs
  Then  exit 1

Scenario: Comments and strings do not trip it
  Given status(400) only inside a // comment, block comment or string literal
  When  the guard runs
  Then  exit 0 (covered in self-test)

Scenario: Tests and declaration files skipped
  Given *.test.ts, *.test-support.ts, *.d.ts contain status(400)
  When  the guard runs
  Then  exit 0

Scenario: Wired everywhere
  Given make check and ci.yml
  When  inspected
  Then  both run check:inline-400, and the self-test runs in the same suite as the other check-* script tests
```

### Story: One parser, one message (#198)
> As an API client developer, I want the same invalid input to produce the same error on create and update.

**Rule 3: Non-integer ids are already rejected on create (board and tracker) like update (F1). #198 pins this with tests and removes the duplicated `integerIds`; no status change.**
**Rule 4: Id-array semantics: absent valid, `[]` valid, `null`/non-array/non-integer element -> 400; duplicates accepted (deduped as parser lib does today).**
**Rule 5: Workspace id: digits-only, safe integer, > 0, message "workspaceId must be an integer" everywhere.**
**Rule 6: Wording table (approved by user).**

| Condition | Unified message |
|---|---|
| Invalid workspace id (all routes, incl. agent read-routes workspaceId case, my-work formerly "positive integer") | `workspaceId must be an integer` |
| Non-workspace invalid param (agent read-routes) | `Invalid params` (unchanged) |
| Username rule (auth/router.ts and oauth.ts) | `Username must be 3-32 characters: letters, numbers, underscore.` (ASCII hyphen; oauth changes from EN DASH) |
| Body not an object | `Invalid request body` |
| Id array invalid | `<field> must be an array of integers` |

```gherkin
Scenario: Board create rejects non-integer assigneeIds (already true; pin it)
  Given a workspace member
  When  POST /cards {assigneeIds:[1,"x"]}
  Then  400 with fieldErrors.assigneeIds "assigneeIds must be an array of integers" and nothing is persisted
  And   behavior is identical before and after #198

Scenario: Tracker create rejects non-integer labelIds
  When  POST tracker item {labelIds:[1.5]}
  Then  400 with fieldErrors.labelIds "labelIds must be an array of integers"

Scenario: Absent and empty arrays stay valid
  When  create with no assigneeIds, or assigneeIds:[]
  Then  201, no assignees

Scenario: null and non-array rejected
  When  create with labelIds:null or labelIds:"1,2"
  Then  400 {error:"labelIds must be an array of integers"}

Scenario: Update unchanged
  When  PATCH with labelIds:[1.5]
  Then  400 with the same message as before

Scenario: Phase 1-2 keep lenient workspace id semantics
  Given a migrated agent/chat/activity/sse route and workspaceId "1e2" (or "0", "-1", "")
  When  called after #197
  Then  validation outcome is identical to before (accepted by Number.isInteger(Number(raw)) -> downstream behavior unchanged)

Scenario: Workspace id edge values after #198 (single strict parser)
  Given workspaceId "0", "-1", "1e2", "abc", "", " 1", "9007199254740993"
  When  any route parses it via the single parser
  Then  all return 400 "workspaceId must be an integer"; "01" parses as 1 (regex /^\d+$/); pinned in a test
  And   this tightening is listed in the PR description as the ONLY behavior change of #198

Scenario: One implementation each
  When  grepping server/src non-test files
  Then  exactly one parseWorkspaceId definition and one integer-id-array implementation (no local integerIds copies)

Scenario: Oauth username wording
  Given oauth invalid username
  When  submitted after Phase 4
  Then  ASCII hyphen message; the test pinning the EN DASH is updated and listed in the PR description
```

---

## Acceptance Criteria

```
Rule: #197 migration (behavior-preserving)
  ✓ Given the 11 listed files, When grepped for res.status(400), Then none remain
  ✓ Given oauth.test.ts, read-routes.test.ts, chat/agent tests, When run, Then pass unchanged
  ✓ Given check:feature-modules, When run, Then passes
  ✓ Given each PR, When counted, Then <=20 files and references #117 without closes/fixes
  ✓ Given migrated sites, When 400 occurs, Then body is {error} only (toEqual), validation precedes any SSE header/stream write
  ✗ Given invalid input at a migrated site, When submitted, Then status/message/order differ from before -> NOT allowed

Rule: #199 guard
  ✓ Given deliberate res.status(400) in a route file, When guard runs, Then exit 1 with file:line (self-test)
  ✓ Given multiline / sendStatus(400) / writeHead(400 forms, When guard runs, Then exit 1
  ✓ Given comments/strings/test files, When guard runs, Then ignored
  ✓ Given make check and ci.yml, When run, Then guard included
  ✓ Given landed after #197, When allowlist read, Then only server/src/validators/http.ts
  ✓ Given CLAUDE.md, When read, Then "Request validation" documents the rule

Rule: #198 unification
  ✓ Given create with non-integer ids (board+tracker), When submitted, Then 400 with fieldErrors "<field> must be an array of integers" (pinned test; unchanged behavior)
  ✓ Given absent or [] ids, When create, Then accepted
  ✗ Given null / non-array ids, When create or update, Then 400
  ✓ Given grep, When searching, Then one parseWorkspaceId and one integer-id-array implementation (no local integerIds copies; legacyIntegerParam removed or unused for workspace ids)
  ✓ Given PR description, When read, Then lists every wording change and the tests updated
  ✓ Given client/src/api.ts throwRequestError, When parsing any changed body, Then error text surfaces
  ✓ Given client create payloads (api.ts, useAddCardSubmit, BoardCardTaxonomyFields, useContextPanelEditor), When audited, Then none send null/string ids (task before merge)
  ✓ Given tracker-items.write.test.ts, When run, Then passes (parsers still exported from lib/tracker-item-parsers)
  ✓ Given lib/tracker-item-parsers.ts, When touched, Then extracted so it is <=300 lines
  ✓ Given workspace-id tightening (0/-1/1e2/"" -> 400 on formerly lenient routes), When committed, Then isolated in its own commit and listed in the PR description
  ✓ Given #197 PRs, When reviewed, Then no site uses workspaceIdParam/positiveIdParam; lenient sites use legacyIntegerParam

OPEN QUESTIONS (risks if unresolved): see table below.

OUT-OF-SCOPE (remind pocket-planning):
  - read-routes.ts:64 dynamic status; legacy tree moves; 404/409/500 lint; duplicate-id rejection; client edits.
```

---

## Design Decision

**Guard (#199)** — Option A: regex over comment/string-stripped text (no dependency, matches the existing check-* scripts' style).
Option B: TypeScript compiler AST (`ts.createSourceFile`, find CallExpression `.status(<numeric literal 400>)` / `sendStatus` / `writeHead`).
**Chosen: Option B** — handles multiline, comments, strings and aliasing exactly, reuses the already-installed `typescript`, no hand-rolled lexer.
Fallback: if `typescript` cannot be resolved from root `scripts/` (workspace hoisting), use Option A with a small comment/string stripper. Planning verifies resolution first.
Rejected A as primary: a hand-rolled stripper is the fragile part; the hunter already found multiline chains in 3 live sites.

**Parsers (#198)** — Option A: zod `integerIdArray` + `workspaceIdParam` in `validators/schemas.ts`, consumed by parsers and create paths via `parseWith`. Chosen (zod already installed, matches #117 pattern).
Option B: shared hand-written loop helper. Rejected: re-implements validation zod already provides.

**Order:** #197 PR-1 -> PR-2 -> #199 -> #198, so the guard starts green with no baseline machinery.

**Key tradeoffs accepted:**
- #198 is API-visible (unified wording, strict workspace id); isolated PR and commit. NOT a 201->400 change (F1).
- Unifying workspace-id parsing rejects ""/0/negatives/1e2 where lenient routes (agent, chat, activity, sse, `lib/workspace-membership`) accept them today (consistent with settings migration).
- #197 introduces a temporary `legacyIntegerParam` to stay behavior-preserving; #198 removes it for workspace ids.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Do any client create payloads send null/string ids? | no longer behavior-relevant (create already rejects, F1); audit kept as a cheap sanity task | none |
| Do any clients send lenient workspace ids ("", "0", "1e2")? | assumed no; audit client/api.ts URL builders before #198 | Client requests start failing with 400 |
| Does `typescript` resolve from root `scripts/`? | assumed yes; planning verifies, Option A fallback | Guard script crashes in CI |
| Leading-zero workspaceId ("01") | follows `workspaceIdParam` (/^\d+$/ -> accepted); pin in a test | Divergence from some current parser |
| Hunter was not re-run after adopting its defaults | defaults added no new behavior | Missed interaction |

---

## Implementation Notes

- Per-site wiring: use `parseWith(schema, input, { message })` to pin legacy strings.
- `auth` user-visible strings: pin with `toEqual` tests BEFORE refactor (characterization first).
- Check `scripts/feature-modules/map.mjs` before touching legacy trees (`agent`, `chat`, `auth`, `notifications`, `activity` are mapped features; `realtime/` is kernel-in-waiting).
- Guard self-test follows `scripts/feature-modules/*.test.mjs` (`node --test`); ensure the new test is included in `test:feature-modules` glob or a sibling script.

---

## Rollback Plan

- #197/#199: revert the PR; no data/contract change.
- #198: revert the isolated workspace-id tightening commit (restores lenient parsing) without losing parser unification; wording changes revert with the PR.
