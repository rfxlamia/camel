# Pocket Closeout — Complete shared 400 validation

- **Plan:** docs/pocket/plans/2026-10-09-shared-400-validation-completion
- **Type:** phased
- **Started:** 2026-10-10
- **Baseline:** `834c023`

This journal records completed phases, review evidence, recorded obstacles and decisions, and optional recommendations.

## Phase 1 of 5 — Shared legacy validation and agent/chat migration
<!-- pocket-closeout:phase-1 -->

**Status:** Complete — `REVIEW` → `DONE`
**Closed:** 2026-10-09T17:38:05.719006+00:00

### What was completed

- **T1 — Add legacyIntegerParam primitive:** completed (`a58b4e3`).
- **T2 — Migrate agent board routes (read-routes.ts, routes.ts):** completed (`cc6ebe9`).
- **T3 — Migrate agent ticket-intake routes (routes.ts, submit.ts):** completed (`d94eabd`).
- **T4 — Migrate chat routes (routes.ts, message-stream.ts):** completed (`33a00e6`).

### Review and verification

- All four current task verdicts are `REVIEW_PASS`; each reviewed SHA exactly matches its DONE SHA.
- Phase-level review: `PHASE_PASS_CLEAN` (source: `reviews/phase-notes-phase-1.json`).
- Phase corrections: None recorded; prior in-loop refactors are reflected in current passing task verdicts.
- `npm run test`: PASS. Exit 0; server 1279 passed/390 skipped, client 1128 passed, feature-module scripts 156 passed; /tmp/camel-phase1-root-tests.log.
- `npm run typecheck`: PASS. Server and client tsc --noEmit exit 0 on merged tree.
- `make check`: PASS. Lint 918 files, mutation routing, event write routing, feature-module guard all passed on merged tree.
- `Per-task exact commands and independent audits`: PASS. T1 schemas 66 passed; T2 targeted 23 and agent 289 passed/25 skipped; T3 targeted 13 and ticket-intake 64 passed/3 skipped; T4 targeted 30 and chat 51 passed/16 skipped; each server typecheck/make check passed. T1–T4 review artifacts REVIEW_PASS.
- `git diff --check 834c023ec1ff7d5661f885d9687d356764eb464f..HEAD`: PASS. Exit 0; 15 committed source/test files.

### Carried-forward review observations

- No Minor issues or outstanding findings recorded.
- T1 reviewer strength: Exported primitive mirrors the specified unknown → Number(value) → Number.isInteger pipeline; output is number and caller error message is retained (schemas.ts:41-45).
- T1 reviewer strength: Oracle tests exercise parseWith with every required sample, asserting both acceptance and exact success/error envelopes (schemas.test.ts:17-48).
- T1 reviewer strength: Temporary #197/#198 purpose is documented, legacy query/JSON leniency is explicitly pinned, and only the two scoped files changed.
- T1 reviewer strength: Refactor heuristics clear: files have 77 and 199 lines; added function and callbacks remain below 50 lines, with no triplicated logic.
- T1 reviewer strength: Installed Zod 4.4.3 confirmed from node_modules/zod/package.json. Its classic/schemas.d.ts:38,53 confirms transform output inference and refine signature; core/schemas.js:619,1718 confirms unknown and transform behavior. Context7 official Zod documentation and https://zod.dev/api confirm transform/refine behavior and error option; Context7 has no exact 4.4.3 index, so installed declarations/source supply version-specific evidence.
- T2 reviewer strength: Combined board/workspace schema construction and error handling are centralized in route-validation.ts:7-22; callers preserve id versus boardId mapping and early return before membership.
- T2 reviewer strength: Action validation preserves resolveMessageAction priority and trimmed message behavior; registration extraction preserves route order, authentication, timeout, service dispatch and dynamic status responses.
- T2 reviewer strength: Prior oversized functions cleared: message registration is 47 lines and callback 40; all modified production files are below 300 lines and all functions below 50 lines.
- T2 reviewer strength: Characterization tests exercise real routers, pin every migrated 400 body with toEqual({ error }), and check workspace 1e2 and 0 reach membership across all routes.
- T2 reviewer strength: Verified Zod 4.4.3 from installed package.json and src/v4/classic/schemas.ts transform/custom/pipe implementations; official documentation https://zod.dev/api confirms schema pipeline semantics. Shared http.ts and legacyIntegerParam implement exact legacy integer conversion and error body behavior.
- T3 reviewer strength: Previous duplication finding cleared: validateTicketWorkspace in submit.ts owns the repeated parseWith/legacyIntegerParam/error response sequence for all four callers.
- T3 reviewer strength: Previous chat callback length finding cleared: callback is 40 lines (routes.ts:131-170), extraction and rate-limit helpers are cohesive and each below 50 lines; production files are 209 and 210 lines. Unchanged background-submit function remains outside correction scope.
- T3 reviewer strength: Characterization tests cover all migrated errors with exact toEqual bodies and repeated cardId query baseline; validators and handlers remain real.
- T3 reviewer strength: Shared schema implementations preserve original Number/isInteger and string trimming semantics; installed Zod 4.4.3 independently read from package metadata and API checked against official https://zod.dev/api documentation.
- T4 reviewer strength: Repeated thread-id parse/guard logic is centralized in route-validation.ts and all four routes share it.
- T4 reviewer strength: Router registration and message orchestration now have bounded responsibilities. Production files remain below 300 lines; executable function bodies remain below approximately 50 lines (long multi-line signatures account for marginal declaration spans).
- T4 reviewer strength: Runtime helpers preserve return/exception boundaries and stream cleanup semantics; ThreadNotFoundError identity is shared by producer and error classifier. No cross-feature deep imports or stricter schemas introduced.
- T4 reviewer strength: Installed package evidence: zod 4.4.3 and Express 5.2.1 package.json. Existing validators/http.ts and schemas.ts establish safeParse/transform/refine behavior; official https://zod.dev/basics and https://zod.dev/api corroborate those APIs. Mechanical gate supplied by coordinator: targeted 30 passed, chat suite 51 passed/16 skipped, server typecheck and make check passed.

### Obstacles and resolution

- Shell did not expose installed Node/npm and initial CLI attempt was interrupted. Used installed Node v22.23.3 PATH; retried log init successfully after user enabled unrestricted permissions. Source: Session tool outputs and explicit user continuation instruction.
- Worktrees lacked local environment configuration. Used parent environment path/symlink or dummy test configuration without committing environment files. Source: T2/T3/T4 implementer reports.
- Initial T2/T3/T4 audits found repeated validation and oversized touched functions. One in-loop correction round per task extracted cohesive same-module helpers; independent re-audits passed with no findings. Source: reviews/T2-review.json, reviews/T3-review.json, reviews/T4-review.json.

### Decisions

- Implementation: Expand correction scope to bounded helpers within existing agent/chat modules. Clear mandatory independent-audit refactor findings while retaining legacy behavior and module boundaries. Source: Coordinator correction packets; T2/T3/T4 re-audit artifacts.
- User: Continue/retry Pocket commands with sandbox disabled. Previous npx command was blocked by sandbox. Source: Explicit user continuation message.

### Suggestions

- No follow-up suggestion from the recorded review observations.

### Next

Phase 2 — auth, realtime SSE, notifications and activity migration — remains `WAITING`; its Phase 1 prerequisite is now complete.

## Phase 2 of 5 — Auth, SSE, notifications, and activity 400 migration
<!-- pocket-closeout:phase-2 -->

**Status:** Complete — `REVIEW` → `DONE`
**Closed:** 2026-10-09T19:11:04Z

### What was completed

- **T5 — Migrate auth routes (router.ts, oauth.ts):** completed (`f30d6c3`). Register and oauth 400s now go through shared validation, keeping the router ASCII hyphen and the oauth en dash distinct.
- **T6 — Migrate realtime SSE workspace-id 400 (sse.ts):** completed (`0f69bec`). The integer check stays before SSE headers and before the shutdown 503.
- **T7 — Migrate notifications and activity 400s:** completed (`d89f2b6`). Title and card-id 400s use the shared helpers; the notification emit still uses the existing `title.trim()` expression.

### Review and verification

- All three current task verdicts are `REVIEW_PASS`; each reviewed SHA exactly matches its DONE SHA.
- Phase-level review: `PHASE_PASS_CLEAN` (source: `reviews/phase-notes-phase-2.json`).
- Phase corrections: None recorded.
- No Minor issues recorded on T5, T6, or T7.
- T5 worktree commands: PASS. Characterization 19 passed; auth suite 39 passed / 15 skipped without `RUN_INTEGRATION`; server typecheck and `make check` passed. The implementer also reported `RUN_INTEGRATION=1` on three DB suites (15 passed); that extra command was not re-run by the coordinator.
- T6 worktree commands: PASS. SSE validation 6 passed; realtime 23 passed; notifications SSE 3 passed / 1 skipped; server typecheck and `make check` passed.
- T7 worktree commands: PASS. Validation 8 passed; notifications and activity 14 passed / 27 skipped; server typecheck and `make check` passed.
- Root `npm run test` on the merged tree: TIMEOUT after 420s. Not a pass. The server suite had already finished: 1312 passed / 390 skipped.
- `npm run test --workspace=client`, run separately: PASS. 1128 passed.
- `npm run test:feature-modules`, run separately: PASS. 156 passed.
- `npm run typecheck`: PASS. Server and client `tsc --noEmit` exit 0.
- `make check`: PASS. Lint 924 files, mutation routing, event-write routing, and the feature-module guard passed. Key-collision did not run because `DATABASE_URL` was unset in the shell.
- `git diff --check 63510672901aa9808d7ea77bd939b2eeaa6c99fd..HEAD`: PASS. Exit 0.

### Carried-forward review observations

- No Minor issues or outstanding findings recorded.
- T5 reviewer strength: Both router username checks are one schema; oauth reuses it with the en-dash message. Schemas wrap the existing validators and do not reimplement length, regex, or trim.
- T5 reviewer strength: Register order stays username, then password, then displayName. `req.body ?? {}` is kept. Bodies are `{ error }` only.
- T6 reviewer strength: The 400 returns before the shutdown 503, `writeHead`, SSE headers, and client registration. `legacyIntegerParam` is used; `"1e2"` and `"0"` are not validation 400s.
- T7 reviewer strength: `trimmedRequired` is used only as ok/not-ok. The emit still uses `title.trim()`. Activity uses `legacyIntegerParam`, and `"1e2"` is not a validation 400.

### Obstacles and resolution

- T5 and T7 implementers aborted after green checks and before commit. Each was resumed on its existing worktree and committed only in-scope files. Source: phase notes; T5 pre-merge HEAD `3fe9acc`; T7 pre-merge HEAD `e227ec6`.
- The T5 auditor process aborted after writing a complete `REVIEW_PASS` artifact. That artifact was kept and later repinned to merge SHA `f30d6c3`. No second auditor was dispatched. Source: `reviews/T5-review.json`.
- Worktrees had no `server/.env`, so existing suites exited on config import. A gitignored copy of the parent env file was placed in each worktree and was not committed. Source: T5 and T7 implementer reports.

### Decisions

- User, at development time: execute Phase 2 only. Closeout and Phase 3 were not authorized then. Source: `reviews/phase-notes-phase-2.json`.
- User, at closeout: close Phase 2. Source: explicit `pocket-closing` invocation for `execution-plan/phase-2.md`.
- Implementation: run T5, T6, and T7 as a parallel group from `6351067`. Source: execution index, source-plan Group B, and advisor guidance recorded in the phase notes.
- Implementation: keep the notification emit as `title.trim()` and use `trimmedRequired` only as the pass/fail gate. Source: T7 task file and `reviews/T7-review.json`.

### Suggestions

- No follow-up suggestion from the recorded review observations.

### Next

Phase 3 — inline-400 AST detection (`scanSource`), the guard CLI, and wiring — remains `WAITING`. Its Phase 2 prerequisite is now complete. This closeout does not start Phase 3.

## Phase 3 of 5 — Inline-400 AST guard and CI wiring
<!-- pocket-closeout:phase-3 -->

**Status:** Complete — `REVIEW` → `DONE`
**Closed:** 2026-10-10T04:15:25Z

### What was completed

- **T8 — Implement inline-400 AST detection (scanSource):** completed (`8b7df49`). Added literal-400 detection through the TypeScript AST, including multiline and alternate method forms.
- **T9 — Add the guard CLI, tree walk and allowlist:** completed (`a0536b4`). Added repository scanning, test/declaration skips, temporary-root support, and the single `validators/http.ts` allowlist entry.
- **T10 — Wire the guard into package.json, Makefile, CI and CLAUDE.md:** completed (`e5561b0`). Added guard execution and self-tests to the existing checks and documented the validation rule.

### Review and verification

- All three current task verdicts are `REVIEW_PASS`; each reviewed SHA exactly matches its DONE SHA. Completed Phase 1 and Phase 2 verdict freshness was also reconciled before closing.
- Phase-level review: `PHASE_PASS_CLEAN` (source: `reviews/phase-notes-phase-3.json`).
- Corrections: None recorded. No Minor issues or outstanding findings recorded.
- Controller detector/CLI mechanical gates passed: T8 14/14 tests; T9 20/20 tests; real-tree guard exit 0.
- Controller wiring test passed; combined guard tests passed 21/21.
- Controller `make check` passed: lint and mutation, event-write, feature-module, and inline-400 guards.
- Controller `npm run test && npm run typecheck` passed with exit 0 after 421s (process `proc_e59d`); full root test chain and server/client typechecks completed. Final feature-module suite passed 156/156. The implementer independently reported a successful full `npm test` run.
- Evidence source: `reviews/phase-notes-phase-3.json` and current `T8-review.json`, `T9-review.json`, `T10-review.json`.

### Obstacles and resolution

- The initial background verification shell could not resolve npm (process `proc_1add`, exit 127). Verification was rerun with the installed Node v22.23.3 bin directory explicitly prepended to PATH; process `proc_e59d` then exited 0. This was an environment obstacle, not a test failure. Source: Phase 3 notes.

### Decisions

- User: route clear-scope tasks to `gpt-6-luna`, and complex tasks and audits to `gpt-6.1-sol`. Source: explicit development request and Phase 3 notes.
- Implementation: T8 used `gpt-6.1-sol` for AST/token-line reasoning; T9 and T10 used `gpt-6-luna`; all independent audits used `gpt-6.1-sol`. Source: Phase 3 notes.
- Implementation: prepend `test:guards` while preserving the existing root test-chain suffix and command ordering. Source: Phase 3 notes and T10 verdict.
- User: authorize Phase 3 closeout through the current `pocket-closing` invocation.

### Suggestions

- No follow-up suggestion from the recorded review observations.

### Next

Phase 4 — shared integer-id-array schema and parser/reference extraction (T11–T13) — remains `WAITING`. Its Phase 3 prerequisite is now complete. This closeout does not start Phase 4.

## Phase 4 of 5 — Shared integer-id-array schema and reference extraction
<!-- pocket-closeout:phase-4 -->

**Status:** Complete — `REVIEW` → `DONE`
**Closed:** 2026-10-10T04:55:11Z

### What was completed

- **T11 — Add integerIdArray and dedupe workspaceIdParam:** completed (`626443e`). Shared array schema matches `Number.isInteger` element checks; `workspaceIdParam` now reuses `positiveIdParam`.
- **T12 — Extract tracker reference parsers and use integerIdArray:** completed (`c660235`). Priority, label, and assignee parsers moved to a kernel helper and still export from the original path; array checks now use the shared schema.
- **T13 — Share the lock-reference extractor and pin create rejection:** completed (`ee8c315`). One lenient lock-reference helper replaced both local copies; create and update rejection of bad ids is pinned against real DB rows and events.

### Review and verification

- All three current task verdicts are `REVIEW_PASS`; each reviewed SHA exactly matches its DONE SHA. Completed Phase 1–3 verdict freshness was also reconciled before closing.
- Phase-level review: `PHASE_PASS_CLEAN` (source: `reviews/phase-notes-phase-4.json`).
- Corrections: None recorded. No Minor issues or outstanding findings recorded.
- T11 controller gates: schema tests 83 passed; settings tests 54 passed / 6 skipped.
- T12 controller gates after worktree dependency provisioning: parser tests 47 passed; board/tracker/lib suite 328 passed / 163 skipped; production files 289 and 77 lines.
- T13 and post-merge controller gates: four integration suites 65 passed / 0 skipped; helper tests 9 passed.
- Controller `make check` passed after merge: lint 930 files plus mutation, event-write, feature-module, and inline-400 guards.
- Controller `npm run typecheck` passed after merge: server and client `tsc --noEmit` exit 0.
- Evidence source: `reviews/phase-notes-phase-4.json` and current `T11-review.json`, `T12-review.json`, `T13-review.json`.

### Carried-forward review observations

- No Minor issues or outstanding findings recorded.
- T11 reviewer strength: Zod array plus element `.refine(Number.isInteger)` matches the packet method and the existing parser loops, including unsafe integers, duplicates, and sparse arrays.
- T12 reviewer strength: All six runtime exports remain on the original barrel path; duplicate outputs are preserved while lookups are unique; mock-by-path tests still intercept.
- T13 reviewer strength: The extractor is lock plumbing only; create still rejects malformed ids with the existing card versus task summaries and writes no cards or card_events.

### Obstacles and resolution

- T11 first audit failed because the schema used a whole-array handwritten loop. One correction implemented element-level refine; the re-audit passed. Source: `reviews/T11-review.json`; commit `626443e`.
- T12 and T13 worktrees could not typecheck until already-installed parent `better-auth` links were provided. No source or dependency edits. Source: Phase 4 notes; `reviews/T12-review.json`; `reviews/T13-review.json`.
- T13 first audit failed a ~50-line function heuristic on a new PATCH characterization callback. An in-file snapshot helper reduced it to 31 lines; the re-audit passed. Source: `reviews/T13-review.json`; commit `7450846`.

### Decisions

- User: route clear-scope tasks to `gpt-6-luna`, and complex tasks and audits to `gpt-6.1-sol`. Source: explicit development request and Phase 4 notes.
- User: authorize Phase 4 closeout. Source: explicit continue-closing instruction.
- Implementation: keep T12/T13 helpers in `server/src/lib` as shared kernel code and run T12 and T13 in parallel after T11. Source: architecture advisor report and execution index Group C.
- Implementation: pin tracker create persistence against column-less `cards` and `card_events`. Source: architecture advisor report and T13 packet repairs.

### Suggestions

- No follow-up suggestion from the recorded review observations.

### Next

Phase 5 — strict workspace-id parser, username wording, and client/PR verification (T14–T16) — remains `WAITING`. Its Phase 4 prerequisite is now complete. This closeout does not start Phase 5.
