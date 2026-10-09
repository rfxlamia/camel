# Task T9 — Verify cross-unit server acceptance

**Phase:** 3
**Depends:** T2, T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 9: Verify cross-unit server acceptance [depends: T2, T3] [test-risk]

## OBJECTIVE

Exercise the authenticated API boundary against the migrated test database so server authorization, cross-workspace read merge, detail reauthorization, source-aware Mark done, activity exactly-once, and failure semantics are verified together.

Files:

- Create: `server/src/routes/my-work.integration.test.ts`

Steps:

> RED expectation: T2/T3 are already implemented, so these acceptance cycles may PASS on first run. Treat an immediate PASS as acceptance confirmed — RED is only expected when a regression or gap exists. Do not weaken assertions to force a red phase.

1. Write failing test for: authorized cross-workspace rollup and composite identity.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given real Atlas/Orbit/Nebula fixtures, when authenticated Alice requests My Work, then authorized Board/Tracker rows appear once, unauthorized rows are absent, and tracker-wins/composite identity holds.
   Exercise through: Express/authenticated HTTP API.
   Test doubles: real PostgreSQL + Express app; stub only the `requireAuth` seam to inject the fixture user (per `work-item-unified.integration.test.ts` convention) — membership/assignment authorization still runs against the real DB. Do not mock route/Kysely/authorization queries.
   Expected RED: API/collaboration not implemented.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement isolated DB fixtures/assertions.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: detail reauthorization.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given membership/assignment revoked after list, when detail runs, then HTTP 404/not_found returns no cached content.
   Exercise through: authenticated detail HTTP request.
   Test doubles: real DB membership transition; do not mock route.
   Expected RED: detail stale-access behavior absent.

6. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Add detail reauth fixture/assertion.

8. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: Board Mark done/activity.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given authorized Board item/mapping, when Mark done runs, then only Board changes and one card activity records.
   Exercise through: authenticated Mark done HTTP request.
   Test doubles: real DB/status/activity; do not mock command.
   Expected RED: Board source integration absent.

10. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Add Board write/activity fixture/assertion.

12. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: Tracker Mark done/activity.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given authorized Tracker item/slot done, when Mark done runs, then only Tracker changes and one tracker activity records.
   Exercise through: authenticated Mark done HTTP request.
   Test doubles: real DB/status/activity; do not mock command.
   Expected RED: Tracker source integration absent.

14. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Add Tracker write/activity fixture/assertion.

16. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: stale conflict/no partial write.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given stale Board/Tracker version, when Mark done runs, then HTTP 409/version_conflict returns and no incorrect source/activity change occurs.
   Exercise through: authenticated HTTP API.
   Test doubles: real DB concurrent/version fixture; do not mock mutation.
   Expected RED: conflict integration absent.

18. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Add conflict/source invariant assertion.

20. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: idempotent retry/activity count.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given item already done after uncertain first response, when same Mark done retries, then success returns and activity count stays one.
   Exercise through: authenticated HTTP API.
   Test doubles: real DB state; do not mock idempotency.
   Expected RED: retry integration absent.

22. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Add idempotency/activity assertion.

24. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: revoked membership Mark done status/code/no write.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given membership is revoked before Mark done, when the HTTP command runs, then HTTP 404/not_found returns and neither source/activity changes.
   Exercise through: authenticated HTTP API.
   Test doubles: real DB membership state; use the existing membership/assignment authorization contract and do not mock route.
   Expected RED: revoked mutation integration is absent.

26. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Add membership revocation status/code/no-write assertions.

28. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

29. Write failing test for: removed assignment Mark done status/code/no write.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given Alice is removed from the item before Mark done, when the HTTP command runs, then HTTP 404/not_found returns and neither source/activity changes.
   Exercise through: authenticated HTTP API.
   Test doubles: real DB assignment state; use the existing membership/assignment authorization contract and do not mock route.
   Expected RED: assignment-removal mutation integration is absent.

30. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

31. Implement minimal behavior:
   Add assignment-removal status/code/no-write assertions.

32. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected: both reauthorization cycles and all prior server cycles pass.

33. Write failing test for: missing done mapping returns 409/status_column_unmappable with no write/activity.
   Test file: `server/src/routes/my-work.integration.test.ts`
   Level: integration
   Test intent: Given an authorized item whose Board/Tracker done mapping is missing, when Mark done runs, then HTTP 409/status_column_unmappable returns and neither source/activity changes.
   Exercise through: authenticated Mark done HTTP API.
   Test doubles: real DB vocabulary/column mapping state; do not mock command.
   Expected RED: real-DB unmappable-target contract is absent.

34. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

35. Implement minimal behavior:
   Add real-DB mapping removal/absence fixture and exact status/code/no-write assertions.

36. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts`
   Expected: the mapping-race/unmappable integration cycle passes.

37. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

38. Commit:
   git add server/src/routes/my-work.integration.test.ts
   git commit -m "test(my-work): verify server acceptance boundary"

## REFERENCES LOADED

- Spec all server-side GWT scenarios and acceptance criteria.
- `server/src/routes/work-item-unified.integration.test.ts` — Express/DB/auth fixture conventions.
- `server/src/routes/workspaceAccess.test.ts` and existing assignee/concurrency tests.
- T2/T3 server modules and test contracts.

## WHY THIS APPROACH

Complexity: deep
Justification: Unit tests cannot prove membership + source merge + route auth + activity/idempotency across two physical tables. This is an independently useful acceptance boundary and is marked test-risk.

## SANDWICH CONTEXT

[CRITICAL: The HTTP API must never leak unauthorized workspace data and must preserve source-specific transactional writes/activity.]
You are verifying My Work's server collaboration boundary.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: set-based personal read plus source-aware Mark done.
Files in scope: only the new server integration test and declared test fixtures.
Available after: T2 and T3.
Architecture rule: exercise the real route/DB/authorization path; stub only the `requireAuth` session seam per the existing integration convention — never mock membership/assignment authorization.
[RESTATE: The HTTP API must never leak unauthorized workspace data and must preserve source-specific transactional writes/activity.]

## DELIVERABLE

Given real Atlas/Orbit/Nebula fixtures, when authenticated HTTP requests run, then all server acceptance scenarios pass.
Given conflict, retry, revoked access, or unauthorized Mark done, when the API is exercised, then the specified status/error/activity behavior is observed.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Real DB and route authorization boundary is exercised (`requireAuth` stubbed only to inject the fixture user); no mock-only substitute.
- Both Board and Tracker sources are represented.
- Activity count and source table effects are asserted.
- Test is isolated and runnable with the repository's DB setup.

Must-not-have:

- No client behavior or UI test code in this task.
- No weakening of auth to make fixtures pass.

Open question risks:

- DB availability is required; report BLOCKED rather than replacing the integration with mocks.

Rollback note:

- Delete the test file only; production code remains covered by unit tests.

## STOP CONDITIONS

Done when: the integration test passes with migrated DB and covers all cross-unit server scenarios.
Uncertain when: the real-DB harness cannot assert source/activity effects without weakening auth.
Escalate when: the test requires bypassing auth/membership or directly mutating internal service state.
