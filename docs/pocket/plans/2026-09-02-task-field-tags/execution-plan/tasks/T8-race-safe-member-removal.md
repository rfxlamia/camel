# Task T8 — Race-safe member removal

**Phase:** 2
**Depends:** T6, T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 8: Race-safe member removal [depends: T6, T7] [test-risk]

## OBJECTIVE

Make member removal call the workspace lock contract before existing cleanup and verify revoked and concurrent membership invalidation through real HTTP transactions.

Files:

- Modify: `server/src/routes/helpers.ts`
- Test: `server/src/routes/workspaceAccess.test.ts`
- Create: `server/src/routes/work-item-member-concurrency.integration.test.ts`

Steps:

#### Regression Verification T8-C01 — GWT Scenario: Reject a revoked assignee

1. **Define the regression verification.**
   - Scenario: `Reject a revoked assignee`
   - Test file: `server/src/routes/work-item-member-concurrency.integration.test.ts`
   - Level: integration.
   - Test intent: Given an assignee was selected before that member removal committed; When Board create and Tracker create are submitted after removal in separate fixtures; Then each create is rejected atomically with an Assignee error and no task, relation, or activity row.
   - Exercise through: real Board and Tracker HTTP create routes plus the real member-removal route through Supertest and PostgreSQL.
   - Test doubles: scheduling barriers and post-commit publisher spies; keep all collaborating create, removal, lock, validator, transaction, and database units real.
   - Baseline timing: Run after T6 and T7 are green but before the T8 concurrent-removal lock change.
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Reject a revoked assignee\""`. Expected: PASS; transaction-scoped create validation must reject a membership removed before submission..
3. **Run the same verification after this task's production changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Reject a revoked assignee\""`. Expected: PASS.

#### Regression Verification T8-C02 — GWT Scenario: Resolve a concurrent reference deletion atomically

1. **Define the regression verification.**
   - Scenario: `Resolve a concurrent reference deletion atomically`
   - Test file: `server/src/routes/work-item-member-concurrency.integration.test.ts`
   - Level: integration.
   - Test intent: Given a selected member reference is removed while Board and Tracker creates are deliberately interleaved in separate fixtures; When the real transactions are released from synchronization barriers; Then each result is a complete valid task committed before removal or a complete rejection after removal, with no orphaned or partial state.
   - Exercise through: real Board and Tracker HTTP create routes plus the real member-removal route through Supertest and PostgreSQL.
   - Test doubles: scheduling barriers and post-commit publisher spies; keep all collaborating routes, locks, validator, transactions, and database real.
   - Baseline timing: Run after T6/T7 transaction-scoped membership validation is green and before T8-S02 adds workspace-first removal locking.
2. **Run the baseline/prerequisite verification:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Resolve a concurrent reference deletion atomically\""`. Expected: PASS is permitted because create and delete already conflict on the referenced workspace_members row; the post-change run protects the same complete-create-or-reject invariant..
3. **Run the same verification after this task's remaining production changes:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"Resolve a concurrent reference deletion atomically\""`. Expected: PASS.

#### RED Cycle T8-S02 — Support: waits on workspace lock before deleting membership

1. **Write the failing test.**
   - Scenario: `waits on workspace lock before deleting membership`
   - Test file: `server/src/routes/work-item-member-concurrency.integration.test.ts`
   - Level: integration.
   - Test intent: Given transaction A holds FOR UPDATE on the workspace row; When transaction B starts member removal; Then query pg_stat_activity/pg_locks until B is observably waiting on A's workspace-row lock (with a bounded timeout), proving B reached the workspace barrier; only then, while A is held, transaction C can acquire the target workspace_members row with FOR UPDATE NOWAIT; after C releases and A commits, B proceeds and completes existing cleanup.
   - Exercise through: real PostgreSQL transactions plus the public member-removal route/service boundary; use a third connection and NOWAIT to distinguish workspace-first waiting from membership-first deletion.
   - Test doubles: deterministic barriers, bounded pg_stat_activity/pg_locks wait-state polling, and timeouts only; keep workspace lock helper, default removeMember transaction, Kysely, PostgreSQL, membership delete, and cleanup real.
   - Expected RED: Current default removeMember transaction executes DELETE workspace_members before any workspace-row lock, so transaction B holds or waits on the membership row and transaction C's FOR UPDATE NOWAIT fails instead of succeeding while B is blocked on the workspace.
2. **Run RED:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"waits on workspace lock before deleting membership\""`. Expected: FAIL because the third connection cannot lock the membership row.
3. **Implement the minimum behavior.** File: `server/src/routes/helpers.ts`. Inside the existing default WorkspaceAccessDeps.removeMember transaction callback, call lockWorkspaceMutation(trx, workspaceId) before DELETE workspace_members, then preserve signable-column, card-assignee, tracker-assignee, and publication behavior.
4. **Run PASS:** `RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts -t "\"waits on workspace lock before deleting membership\""`. Expected: PASS, then rerun T8-C02 and expect PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts && RUN_INTEGRATION=1 npm run test --workspace=server -- --no-file-parallelism src/routes/work-item-member-concurrency.integration.test.ts`. Expected: PASS.
3. **Commit:** `git add server/src/routes/helpers.ts server/src/routes/workspaceAccess.test.ts server/src/routes/work-item-member-concurrency.integration.test.ts` then `git commit -m "fix(workspaces): serialize member removal with task create"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T6 and T7 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Member removal and both create routes must collaborate against real PostgreSQL for race proof; unit coverage is service regression only.]
You are implementing Race-safe member removal for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T6 and T7.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Member removal and both create routes must collaborate against real PostgreSQL for race proof; unit coverage is service regression only.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `fix(workspaces): serialize member removal with task create` exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Every RED cycle runs before its implementation and reruns the identical command for PASS; every Regression Verification records its stated baseline/prerequisite result and reruns the same command after production changes.
- Client component tests keep the reducer, editor, popover, provider, context, and field definitions real whenever those units collaborate.
- Real server integration tests use `RUN_INTEGRATION=1`, Supertest, and migrated PostgreSQL without mocking route, validator, Kysely, DBExecutor, relation, or activity collaborators.
- Rule-of-three and size refactors stay bounded to mapped files; server imports retain `.js`; client imports omit extensions.
- The conventional commit is created after every cycle is green.

Must-not-have:

- No files outside OBJECTIVE, no source behavior outside the approved scenarios, and no test implementation copied into this plan.
- No existing-task editing, Description command, extra command surface, value creation, Board Status or Column command, natural-language parsing, chip persistence, table or event consolidation, idempotency system, migration, dependency, `contenteditable`, editor library, or `camel-lottie/` change.
- No global database access from the shared validator and no pre-commit realtime or notification publication.

Open question risks:

- Click-away on a partial command remains literal.
- A lost committed response can still produce a duplicate after manual retry because durable idempotency is out of scope.
- Initial Board Due date is represented by create activity and does not emit a due-date-change notification.

Rollback note:

- Deploy server before client and roll back client before server. Preserve lock correctness unless directly proven regressive.

## STOP CONDITIONS

Done when every declared RED becomes green, the packet suite passes, scope remains bounded, and the conventional commit exists. Uncertain when an approved assumption conflicts with existing public behavior. Escalate before changing approved behavior, touching an unmapped file, adding schema or dependency work, publishing effects before commit, accepting Board statusId, or merging Board and Tracker persistence.
