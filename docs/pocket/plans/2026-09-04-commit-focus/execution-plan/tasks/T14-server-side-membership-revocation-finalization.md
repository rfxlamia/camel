# Task T14 — Server-side membership revocation finalization

**Phase:** 3
**Depends:** T6, T15
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 14: Server-side membership revocation finalization [depends: T6, T15]

## OBJECTIVE

Finish an active focus session inside the same transaction that removes a workspace membership. This closes the offline-user gap: a removed member may never receive the SSE event or be able to call `PATCH /focus-session`, so the membership-removal path must accrue and finish the session before deleting access, then publish `payload.session: null` after the transaction commits.

Files:
- Modify: `server/src/routes/helpers.ts`
- Modify: `server/src/routes/focus-session.ts` (audit action union only — see below)
- Modify: `server/src/routes/focus-session-repo.ts`
- Modify: `server/src/routes/members.ts` (pass the actor through — see below)
- Create: `server/src/routes/focus-session-membership.ts`
- Test: `server/src/routes/focus-session-membership.test.ts`
- Test: `server/src/routes/workspaceAccess.test.ts` (exists — extend it)
- Test: `server/src/routes/members.focus-session.integration.test.ts` (RUN_INTEGRATION-gated)

The route layer remains thin. `focus-session-membership.ts` owns the orchestration of `findActive → applyAction(..., "finish", now) → update`; `focus-session-repo.ts` remains queries and row mapping only.

**Audit seam (matches T4).** The injected dependency is the narrow `RecordFocusActivity` domain type — `({ actor, workspaceId, sessionId, action }) => Promise<void>` — not `typeof recordActivity`, whose five-argument signature would push a Kysely executor into this module.

It is declared in **`server/src/routes/focus-session.ts` (line ~33), not `server/src/core/focus-session.ts`**. Its action union is the `FocusAuditAction` type just above it (lines ~24–31, currently `start | pause | resume | finish | auto_finish`); extend that union with `"membership_removed"`. That is the only change this task makes to `focus-session.ts` — no route handler in that file is touched.

Unlike T4–T6, this call runs **inside** the removal transaction, so `createWorkspaceAccessService` binds the default to its `trx` rather than to `db` before passing it in; that binding is the one place the executor is chosen. The underlying `recordActivity` call uses `eventType: "focus_session"` (delivered by T15), never `"update"`.

**Audit actor — decided here, do not re-litigate.** `RecordFocusActivity` requires a full `AuthUser`, and the removal path currently carries none: `createWorkspaceAccessService().removeMember({ actorId, workspaceId, userId })` has only `actorId: number` (`helpers.ts` ~line 216), and the transaction-level dependency `deps.removeMember(workspaceId, userId)` (`helpers.ts` ~lines 181–184) receives no actor at all.

- **The actor is the removing admin**, not the removed member. `card_events.actor_id` records who performed the mutation, and the mutation here is the removal. The removed member is identified in the audit payload (`userId`), never in `actor_id`.
- **Plumbing:** thread the admin's `AuthUser` from the route. `server/src/routes/members.ts` line ~211 is the `DELETE /members/:userId` handler and it already passes `actorId: req.user!.id` at line ~225 — add `actor: req.user!` beside it as an `actor: AuthUser` field on the service's `removeMember` argument object alongside the existing `actorId`, and widen the `WorkspaceAccessDeps.removeMember` dependency signature so the transaction receives it. Do not reconstruct an `AuthUser` from `actorId` inside the service, and do not widen `RecordFocusActivity` to accept a bare id.

The real workspace-access `removeMember` transaction binds the repo to its `trx`, finishes the focus row before deleting `workspace_members`, and returns a boolean marker. `createWorkspaceAccessService` publishes the focus null event only after the deletion transaction resolves, followed by the existing membership event.

Steps:

1. Write a failing test for: `Given an active session, When membership removal finalization runs, Then in-flight time is accrued and the session is finished`
   Test file: `server/src/routes/focus-session-membership.test.ts`
   Level: unit

   Test intent:
   Independent unit RED case A: Given a fake repo with a Running row at `version: 4`, `accumulated_seconds: 300`, and `running_since: T0`, When `finishActiveFocusSessionForRemoval({ repo, actor: <admin AuthUser id 2>, userId: 7, workspaceId: 3, now: T0 + 120s, recordFocusActivity })` runs, Then it calls `repo.update` with `state: "finished"`, `accumulated_seconds: 420`, `running_since: null`, `finished_at` from the injected clock, and `expectedVersion: 4`, and calls `recordFocusActivity` with `action: "membership_removed"`, `actor` = the removing admin (id 2, **not** the removed member), `workspaceId: 3`, and the finished session's id. The no-active-row return is a separate case below.
   Exercise through: exported `finishActiveFocusSessionForRemoval`
   Test doubles: fake `FocusSessionRepo`, fixed `now`, and injected `recordFocusActivity()` audit spy; do not mock `applyAction`.
   Expected RED: `focus-session-membership.ts` does not exist.

2. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-session-membership.test.ts`
   Expected failure: import resolution fails.

3. Implement the pure membership finalizer, then verify PASS: add `finishActiveFocusSessionForRemoval({ repo, actor, userId, workspaceId, now, recordFocusActivity })`, convert the row to the core snapshot, apply `finish` with the supplied `now`, update through the injected repo, and call `recordFocusActivity` with `action: "membership_removed"` and the passed-in `actor`. Extending `FocusAuditAction` in `server/src/routes/focus-session.ts` is part of this step — the union is what makes `"membership_removed"` typecheck. Do not import Express or Kysely, and do not write a card/task row or `focus_events`. Run `npm run test --workspace=server -- src/routes/focus-session-membership.test.ts`.

3a. Write/run a separate RED→implementation→PASS case for no active row: the finalizer returns `false`, does not update, and does not audit.
    Test file: `server/src/routes/focus-session-membership.test.ts`
    Level: unit
    Exercise through: exported `finishActiveFocusSessionForRemoval` with `findActive` resolving `null`
    Test doubles: fake repo, fixed clock, and injected audit spy
    Expected RED: the finalizer does not yet define the empty-session return contract.
    Run test after implementation: `npm run test --workspace=server -- src/routes/focus-session-membership.test.ts`

4. Write a failing service test for: `Given membership removal finishes a focus session, When the transaction succeeds, Then the focus null event is published before the existing membership event`
   Test file: `server/src/routes/workspaceAccess.test.ts`
   Level: unit

   Test intent:
   Independent service RED case A: Given `createWorkspaceAccessService` receives a successful `removeMember` result with `focusSessionFinished: true`, When the service removes user 4 from workspace 8, Then it calls `publishEvent(8, { type: "focus_session.updated", userId: 4, workspaceId: 8, payload: { session: null } })` before the existing `membership.removed` event. The normal-removal behavior is a separate case below.
   Exercise through: `createWorkspaceAccessService(...).removeMember(...)` and the ordered `publishEvent` spy
   Test doubles: fake transaction-backed `removeMember` result, fixed service clock, ordered `publishEvent` spy, and injected `recordFocusActivity()` audit spy; do not mock the event-ordering branch
   Expected RED: the service only publishes `membership.removed`.

5. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`
   Expected failure: no focus event is published.

6. Implement the post-transaction event marker, then verify PASS for case A: extend the workspace-access dependency/result types and publish the focus null event only when the transaction reports a finished session; preserve the existing redirect event and best-effort semantics. Run `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`.

6a. Write/run a separate RED→implementation→PASS service case for a normal removal with `focusSessionFinished: false`: only `membership.removed` is published and no focus event is emitted.
    Test file: `server/src/routes/workspaceAccess.test.ts`
    Level: unit
    Exercise through: the workspace-access removal service and ordered `publishEvent` spy
    Test doubles: fake transaction result with `focusSessionFinished: false`, publish spy, and audit spy
    Expected RED: the new post-transaction branch may publish a focus event for a removal that finished nothing.
    Run test after implementation: `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`

7. Write a failing integration test for: `Given a removed member has an active focus session, When DELETE membership succeeds, Then membership and focus are finalized atomically`
   Test file: `server/src/routes/members.focus-session.integration.test.ts`
   Level: integration (`RUN_INTEGRATION=1`, requires `make db-up && make db-migrate`)

   Test intent:
   Independent integration RED case A: Given workspace 3, member 7, and a Running focus row for `(user_id: 7, workspace_id: 3)` at a fixed clock, When the actual `DELETE /workspaces/3/members/7` path runs through `membersRouter` and `workspaceAccessService`, Then the membership row is gone, the focus row remains for history but is `finished` with accrued time and `finished_at` set, and the focus-null event is delivered only after commit.
   Independent integration RED case B: inject `failAfterFocusFinalize` so the transaction throws immediately after `finishActiveFocusSessionForRemoval` returns and before the membership DELETE; then assert both the membership row and focus update roll back and no event is published. This is a test-only dependency passed to the service factory, never a global production flag. Do not test this by calling the client PATCH after removal.
   Exercise through: the actual `DELETE /workspaces/3/members/7` HTTP route for case A, and the same service factory with the explicit `failAfterFocusFinalize` seam for case B
   Test doubles: real PostgreSQL fixture and event capture for case A; isolated transaction failure seam for case B; fixed `now: () => FIXED_DATE`; card-event query asserting one `cardId: null` namespaced audit row and no card/task mutation; do not use client PATCH
   Expected RED: the existing removal transaction deletes access without finishing the focus row.

8. Run test — verify FAIL for integration RED case A only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/members.focus-session.integration.test.ts -t membership.row.is.gone`.
   Expected failure: the focus row remains Running.

8a. Run test — verify FAIL for integration RED case B only: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/members.focus-session.integration.test.ts -t roll.back.both`.
   Expected failure: the injected failure seam is missing or the rollback assertion fails.

9. Implement the transaction wiring, then verify PASS:
   - give `createFocusSessionRepo` a default executor (`createFocusSessionRepo(executor = db)`) so it can bind to a Kysely `Transaction<DB>` while keeping all Kysely usage in the repo. No type widening is needed — Kysely's `Transaction<DB>` already extends `Kysely<DB>`, so the existing parameter type accepts a `trx` as is
   - thread the removing admin's `AuthUser` from `server/src/routes/members.ts`'s DELETE handler (`req.user`) into `workspaceAccessService.removeMember` as an `actor` field beside the existing `actorId`, and widen `WorkspaceAccessDeps["removeMember"]` so the transaction-level dependency receives it. This is the only change to `members.ts`
   - in the real `workspaceAccessService.removeMember` transaction, call `finishActiveFocusSessionForRemoval` with `createFocusSessionRepo(trx)`, that `actor`, and the injected service clock before deleting `workspace_members`
   - return `focusSessionFinished` from the transaction and publish the focus null event only after commit, before `membership.removed`
   - accept `now?: () => Date` and `failAfterFocusFinalize?: () => void` as injected service dependencies; integration tests pass `now: () => FIXED_DATE` and use the failure hook at the precise post-finalization/pre-delete boundary
   - invoke the required `recordFocusActivity()` audit seam for a completed focus mutation with `actor` = the removing admin, the removed member's id in the payload, the workspace and session identifiers, and `cardId: null`, while leaving card/task tables and `focus_events` untouched
   Run each integration case separately with `-t membership.row.is.gone` and `-t roll.back.both`, then run the complete integration file and `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`.

10. Refactor while green (bounded): keep the finalizer free of persistence-specific branching, keep the membership transaction as the only atomic boundary, and verify `npm run test --workspace=server -- src/routes/focus-session-membership.test.ts`, `npm run test --workspace=server -- src/routes/workspaceAccess.test.ts`, and `npm run test`. Also run `npm run typecheck --workspace=server`.

11. Commit:
    `git add server/src/routes/helpers.ts server/src/routes/focus-session.ts server/src/routes/focus-session-repo.ts server/src/routes/members.ts server/src/routes/focus-session-membership.ts server/src/routes/focus-session-membership.test.ts server/src/routes/workspaceAccess.test.ts server/src/routes/members.focus-session.integration.test.ts`
    `git commit -m "fix(focus): finalize sessions when membership is removed"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — Architecture Constraints (`recordFocusActivity()`), the confirmed membership-removal behavior, and the `focus_events` decision
- `server/src/routes/helpers.ts` — `createWorkspaceAccessService`, the existing removal transaction, and membership event publishing
- `server/src/routes/members.ts` (lines ~211, ~224–225) — the actual `DELETE /members/:userId` route, `mergeParams` mounting, and the `workspaceAccessService.removeMember({ actorId: req.user!.id, ... })` call the `actor` is threaded through
- `server/src/routes/focus-session-repo.ts` (line ~114) — `createFocusSessionRepo(db: Kysely<DB>)`, the repo seam that must bind to a transaction
- `server/src/routes/focus-session.ts` (lines ~24–38) — `FocusAuditAction` union and the `RecordFocusActivity` type this task extends and injects
- `server/src/core/focus-session.ts` — `applyAction(..., "finish", now)` for authoritative accrual. Note: this is a **different file** from `routes/focus-session.ts` above; the audit types are not here
- `server/src/auth.ts` (line ~22) — `AuthUser`, the actor shape `RecordFocusActivity` requires
- `server/src/routes/workspaceAccess.test.ts` and `server/src/routes/members.mutations.test.ts` — existing service and HTTP test patterns

## WHY THIS APPROACH

Complexity: standard
Justification: membership removal is the only path that can invalidate access before the client can finish the session. Keeping the focus transition in the same transaction prevents both stranded offline sessions and a partial removal.

## SANDWICH CONTEXT

[CRITICAL: the client-side `membership.removed` guard is still required for immediate feedback, but it is not the server authority. The server must finish the row before access deletion so offline users cannot leave a Running session permanently active. Publish only after commit so subscribers never observe a focus event for a transaction that later rolls back.]

You are implementing server-side membership revocation finalization for Commit Focus.
Files in scope: `server/src/routes/helpers.ts`, `server/src/routes/focus-session.ts` (audit union only), `server/src/routes/focus-session-repo.ts`, `server/src/routes/members.ts` (actor pass-through only), `server/src/routes/focus-session-membership.ts`, their tests, and the integration test above.
Test framework: Vitest, node environment. Unit commands use `npm run test --workspace=server -- src/...` — workspace-scoped and workspace-relative; a root `npm run test -- src/...` does not filter. Never quote a multi-word `-t` filter: npm strips the quotes and the run can exit 0 having skipped every test. Use a regex dot per space (`-t roll.back.both`). The integration command is gated by `RUN_INTEGRATION=1` and a running database.
Available after: T6 (transaction-bound focus-session repository and server mutation contract).
Architecture rule: NodeNext ESM imports use `.js`; Kysely stays inside `focus-session-repo.ts`; no task mutation or `focus_events` write. Every completed focus mutation calls the injected `recordFocusActivity()` audit seam with a namespaced focus payload.

## DELIVERABLE

Given a member with an active focus session, When membership is removed, Then the session is finished with accrued time in the same transaction before access is deleted
Given the membership transaction rolls back, Then neither the membership deletion nor focus finalization remains
Given finalization succeeds, Then `focus_session.updated` with `payload.session: null` is published after commit, followed by `membership.removed`
[must-not] Given membership removal, When focus logging is considered, Then it must not fabricate a card/task event or write `focus_events`; the required `recordFocusActivity()` call remains namespaced to the focus session

All tests PASS. Commit exists with message matching `fix(focus): finalize sessions when membership is removed`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- finalization uses `applyAction` and an injected clock
- focus update and membership deletion share one database transaction
- focus null event publishes only after commit
- existing membership redirect event remains intact
- no card/task activity is fabricated for a focus mutation; the required audit call is covered by tests and remains namespaced
- the audit `actor` is the removing admin; the removed member appears only in the payload
- `FocusAuditAction` in `server/src/routes/focus-session.ts` gains `"membership_removed"` and nothing else in that file changes
- tests written BEFORE each implementation boundary

Must-not-have:
- client-only revocation as the sole authority
- a second independent transaction for finishing focus
- Kysely queries outside `focus-session-repo.ts`
- card/task or `focus_events` writes; `recordFocusActivity()` is required through the injected audit seam

## STOP CONDITIONS

Done when: unit and integration tests pass, the root test suite is green, and the conventional commit exists
Uncertain when: the existing membership transaction cannot expose a post-commit event marker without changing its public contract
Escalate when: atomicity requires changing workspace membership schema or task tables
