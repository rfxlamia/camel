# Task T11 — Add My Work observability and performance verification

**Phase:** 3
**Depends:** T3, T6
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 11: Add My Work observability and performance verification [depends: T3, T6] [test-risk]

## OBJECTIVE

Instrument personal rollup latency/count/error telemetry and verify the p95 `<100ms` target at 10 workspaces/1,000 active items without logging task content or unauthorized identifiers.

Files:

- Create: `server/src/core/my-work-observability.ts`
- Create: `server/src/core/my-work-observability.test.ts`
- Create: `server/src/routes/my-work.performance.integration.test.ts`
- Create: `client/src/pages/MyWorkPage.performance.test.tsx`
- Modify: `server/src/routes/my-work-router.ts` (instrumentation wiring; `my-work.ts` is a barrel — touch only if a re-export is needed)

Steps:

1. Write failing test for: sanitized observability event.
   Test file: `server/src/core/my-work-observability.test.ts`
   Level: unit
   Test intent: Given timing/count/error inputs, when telemetry records, then latency/count/error class exist without task content/unauthorized identifiers.
   Exercise through: observability helper.
   Test doubles: fake logger/timestamp; do not mock sanitization.
   Expected RED: helper does not exist.

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/my-work-observability.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement domain observability helper, reusing/extending `work-item-latency.ts` sampling/percentile primitives rather than duplicating them.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/my-work-observability.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: server p95 workload target.
   Test file: `server/src/routes/my-work.performance.integration.test.ts`
   Level: integration/performance
   Test intent: Given 10 workspaces/1,000 active items, when 5 warm-up requests and 30 measured requests run, then nearest-rank p95 is below 100ms and telemetry is safe; the test records Node version, PostgreSQL version, and CI runner details.
   Exercise through: authenticated HTTP API/real migrated DB.
   Test doubles: real DB; no mocked query path.
   Expected RED: performance fixture/instrumentation absent.

6. Run test — verify FAIL:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.performance.integration.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement deterministic 5-request warm-up, 30-request measurement, nearest-rank p95 calculation, telemetry assertion, and documentation of migration/Node/PostgreSQL/CI runner plus redacted DB host/database metadata; never capture DATABASE_URL credentials.

8. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.performance.integration.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: client initial UI readiness.
   Test file: `client/src/pages/MyWorkPage.performance.test.tsx`
   Level: component performance
   Test intent: Given immediate authorized response, when page mounts, then first usable toolbar/list state appears under one second in controlled Vitest/Node environment.
   Exercise through: real MyWorkPage with fake network only.
   Test doubles: fake API response; do not mock page/helpers.
   Expected RED: readiness test/ready marker absent.

10. Run test — verify FAIL:
   `npm run test --workspace=client -- src/pages/MyWorkPage.performance.test.tsx`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement controlled client timing assertion and document environment.

12. Run test — verify PASS:
   `npm run test --workspace=client -- src/pages/MyWorkPage.performance.test.tsx`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

14. Commit:
   git add server/src/core/my-work-observability.ts server/src/core/my-work-observability.test.ts server/src/routes/my-work.performance.integration.test.ts client/src/pages/MyWorkPage.performance.test.tsx server/src/routes/my-work-router.ts
   git commit -m "test(my-work): verify latency and observability"

## REFERENCES LOADED

- Spec performance, observability, failure, and privacy criteria.
- `server/src/core/work-item-latency.ts` — existing latency sampling/percentile primitives to reuse, not duplicate.
- `server/src/routes/my-work.ts` from T2 and Mark done route from T3.
- Existing server integration fixture patterns.
- `client/src/pages/MyWorkPage.tsx` and client test conventions for visible-ready markers.
- node-postgres/Kysely docs for pool/query behavior relevant to a real DB performance test.

## WHY THIS APPROACH

Complexity: deep
Justification: p95, workload size, error classification, and sanitized telemetry materially change the test level and require real DB collaboration; this is marked test-risk.

## SANDWICH CONTEXT

[CRITICAL: Performance instrumentation must never log task content or unauthorized identifiers, and the personal query must remain set-based.]
You are verifying My Work production quality.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: server-side personal rollup with bounded Active data and no global SSE.
Files in scope: observability helper/tests, My Work route instrumentation, server performance integration test, and client readiness test.
Available after: T3 and T6.
Architecture rule: measure the real API/DB boundary; do not replace the workload with mocked query timing.
[RESTATE: Performance instrumentation must never log task content or unauthorized identifiers, and the personal query must remain set-based.]

## DELIVERABLE

Given the approved 10-workspace/1,000-item fixture, when the rollup is measured, then p95 is below 100ms and safe telemetry is emitted.
Given a normal successful response, when the client page mounts, then its first usable state is ready within one second.
Given unauthorized or transient failures, when telemetry records them, then only class/count/latency data is emitted.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- p95 test uses a real DB/query path and documents prerequisites.
- Client readiness test uses real page rendering with only the network boundary doubled.
- Telemetry is structured, sanitized, and covered by unit tests.
- The observability helper reuses `work-item-latency.ts` sampling/percentile primitives.
- The route remains set-based and response semantics are unchanged.

Must-not-have:

- No task title/description/key in metrics or error logs.
- No performance test that measures mocked queries.
- No global SSE or projection introduced for the benchmark.

Open question risks:

- CI hardware/database variance may require a controlled performance-test environment; record migration state, Node/PostgreSQL versions, runner details, and only redacted DB host/database metadata, and report DONE_WITH_CONCERNS if threshold cannot be reproduced honestly.

Rollback note:

- Remove observability wiring; route/read behavior remains.

## STOP CONDITIONS

Done when: safe telemetry unit tests and controlled performance integration tests pass or report a documented environment concern.
Uncertain when: p95 cannot be measured against a migrated DB fixture.
Escalate when: meeting p95 requires a schema migration, persistent projection, or client-side authorization shortcut.
