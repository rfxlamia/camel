# Task T3 — Extract and implement the source-aware Mark done command

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: Extract and implement the source-aware Mark done command [depends: T2] [test-risk]

## OBJECTIVE

Provide the only V1 My Work mutation: membership/assignment-rechecked, source-aware, version-safe, canonical-target Mark done with idempotent retries and exactly-once activity behavior.

Files:

- Create: `server/src/core/tracker-item-status-change.ts`
- Create: `server/src/core/my-work-mark-done.ts`
- Create: `server/src/core/tracker-item-status-change.test.ts`
- Create: `server/src/core/my-work-mark-done.test.ts`
- Modify: `server/src/routes/tracker-items.ts`
- Modify: `server/src/routes/my-work.ts` (barrel re-exports only)
- Modify: `server/src/routes/my-work-router.ts` (mount POST `/:workspaceId/:source/:key/done`; result-map errors — its catch-all converts thrown errors into 503 `my_work_unavailable`)
- Modify: `server/src/routes/my-work-service.ts` and `my-work-types.ts` (wire the command through the existing service seam)

Steps:

1. Write failing test for: Tracker status-change extraction and canonical done target.
   Test file: `server/src/core/tracker-item-status-change.test.ts`
   Level: unit
   Test intent: Given a Tracker item and the existing `resolveMyWorkDoneTarget` slot='done' resolution, when the extracted service marks done, then one update (status + completed_at) and one activity occur; position/id target selection is already covered by `my-work-done-target.test.ts` and must not be reimplemented.
   Exercise through: exported status-change service.
   Test doubles: chainable Kysely executor/activity recorder; do not mock resolver.
   Expected RED: extracted service does not exist.

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Extract the Tracker status mutation primitive (status set, completed_at category rule, optimistic version, one tracker activity) reusing `resolveMyWorkDoneTarget` for target selection.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: Board Mark done success and HTTP success mapping.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given authorized Board item and valid is_done mapping, when Mark done runs, then success result, Board change, and one card activity occur.
   Exercise through: command service with Board primitive.
   Test doubles: fake transaction/Board service/activity recorder; do not mock command.
   Expected RED: command service does not exist.

6. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement Board command delegation and success result mapping.

8. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: Tracker Mark done success and HTTP success mapping.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given authorized Tracker item and slot=done, when Mark done runs, then success result, Tracker-only change, and one tracker activity occur.
   Exercise through: command service with Tracker primitive.
   Test doubles: fake transaction/Tracker service/activity recorder; do not mock source selection.
   Expected RED: Tracker command behavior is absent.

10. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement Tracker command delegation and success result mapping.

12. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: membership revocation returns 404/not_found.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given membership is revoked before Mark done, when the command runs, then HTTP 404 with existing `not_found`/`Not found` behavior returns and no source/activity write occurs.
   Exercise through: command authorization boundary.
   Test doubles: membership dependency returning revoked and fake transaction; do not mock mapping.
   Expected RED: membership-revocation behavior is not covered.

14. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Recheck membership using the existing route authorization contract; revoked state returns 404/not_found.

16. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the membership-revocation cycle passes without weakening adjacent behavior.

17. Write failing test for: assignment removal returns 404/not_found.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given Alice is removed from the item before Mark done, when the command runs, then HTTP 404 with existing `not_found`/`Not found` behavior returns and no source/activity write occurs.
   Exercise through: command authorization boundary.
   Test doubles: assignment dependency returning removed and fake transaction; do not mock mapping.
   Expected RED: assignment-removal behavior is not covered.

18. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Recheck assignment using the existing route authorization contract; removed assignment returns 404/not_found.

20. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the assignment-removal cycle passes without weakening adjacent behavior.

21. Write failing test for: missing mapping returns 409 status_column_unmappable.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given no valid Board/Tracker done mapping, when Mark done runs, then HTTP 409/status_column_unmappable semantics return with no source/activity write.
   Exercise through: command mapping boundary.
   Test doubles: fake transaction with missing mapping; do not mock mapping decision.
   Expected RED: mapping contract is not covered.

22. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Map missing done targets to existing status_column_unmappable behavior.

24. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: Board stale version returns 409 version_conflict.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given stale Board version, when Mark done runs, then HTTP 409/version_conflict returns with no activity.
   Exercise through: Board command primitive.
   Test doubles: fake Board service returning conflict; do not mock command handling.
   Expected RED: Board conflict handling is not covered.

26. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Preserve Board conflict response mapping.

28. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

29. Write failing test for: Tracker stale version returns 409 version_conflict and no card write.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given stale Tracker version, when Mark done runs, then HTTP 409/version_conflict returns with no activity and no cards access.
   Exercise through: Tracker command primitive.
   Test doubles: fake Tracker service returning conflict; do not mock source handling.
   Expected RED: Tracker conflict handling is not covered.

30. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

31. Implement minimal behavior:
   Preserve Tracker conflict response and source boundary.

32. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

33. Write failing test for: idempotent retry has one activity.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given source already at canonical done target, when Mark done retries, then existing success returns without duplicate activity.
   Exercise through: command service.
   Test doubles: fake transaction showing canonical target; do not mock idempotency decision.
   Expected RED: idempotency behavior is not covered.

34. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

35. Implement minimal behavior:
   Implement already-done short-circuit.

36. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

37. Write failing test for: Tracker command never writes cards.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given Tracker item, when Mark done runs, then no cards query/update is made.
   Exercise through: command service with query-table spy.
   Test doubles: fake transaction recording table access; do not mock source selection.
   Expected RED: source-table invariant is not explicit.

38. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

39. Implement minimal behavior:
   Keep Tracker command source-specific.

40. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

41. Write failing test for: mapping removal race returns 409 status_column_unmappable without partial write.
   Test file: `server/src/core/my-work-mark-done.test.ts`
   Level: unit
   Test intent: Given mapping existed at page load but is removed before transaction resolves, when Mark done runs, then HTTP 409/status_column_unmappable returns with no source/activity write.
   Exercise through: command transaction boundary.
   Test doubles: fake transaction whose mapping changes; do not mock rollback logic.
   Expected RED: mapping-race behavior is absent.

42. Run test — verify FAIL:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

43. Implement minimal behavior:
   Recheck mappings atomically before any source write.

44. Run test — verify PASS:
   `npm run test --workspace=server -- src/core/tracker-item-status-change.test.ts src/core/my-work-mark-done.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

45. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

46. Commit:
   git add server/src/core/tracker-item-status-change.ts server/src/core/my-work-mark-done.ts server/src/core/tracker-item-status-change.test.ts server/src/core/my-work-mark-done.test.ts server/src/routes/tracker-items.ts server/src/routes/my-work.ts server/src/routes/my-work-router.ts server/src/routes/my-work-service.ts server/src/routes/my-work-types.ts
    git commit -m "feat(my-work): add source-aware mark done"

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md` — Mark done rules, membership/assignment reauthorization, mapping, conflict, retry, and activity criteria.
- `server/src/core/board-card-status-change.ts` — existing Board status/column/WIP/activity transaction.
- `server/src/core/column-status-map.ts` and `column-status-reverse.ts` — existing Board mapping.
- `server/src/routes/tracker-items.ts` — inline Tracker status mutation to extract without behavior drift.
- `server/src/routes/tracker-activity.ts` — Tracker activity contract.
- `server/src/core/my-work-done-target.ts` — existing deterministic slot="done" target resolver (added as a T2 correction); consume it, do not reimplement target selection.
- `server/src/routes/my-work-router.ts` — POST mount point and the 503 catch-all boundary.
- `server/src/routes/my-work-data-source-detail.ts` — membership/assignment EXISTS reauthorization pattern to reuse for the command.
- `client/src/api/myWork.ts` — T1 Mark done client contract; path/verb/body must match exactly.
- Existing Board status-change tests — chainable Kysely test-double pattern.

## WHY THIS APPROACH

Complexity: deep
Justification: Mark done crosses authorization, two physical sources, version conflicts, status mappings, activity logging, and uncertain-response idempotency. The extraction prevents a second Tracker mutation implementation.

## SANDWICH CONTEXT

[CRITICAL: Mark done must route through source-specific transactional mutation primitives and must not bypass version/activity or membership/assignment reauthorization rules.]
You are implementing the bounded My Work mutation for `camel-kanban`.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: Mark done is the only V1 write; full editing and bulk actions remain out of scope.
Files in scope: the listed core services, My Work route, Tracker extraction, and their tests.
Available after: T2.
Architecture rule: preserve `recordActivity`/`recordTrackerActivity`, optimistic version conflicts, and existing Board/Tracker mappings.
[RESTATE: Mark done must route through source-specific transactional mutation primitives and must not bypass version/activity or membership/assignment reauthorization rules.]

## DELIVERABLE

Given an authorized assignee with a valid Board or Tracker done target, when Mark done is requested, then the correct source changes and exactly one activity is recorded.
Given stale version, missing mapping, revoked membership, or removed assignment, when Mark done is requested, then no partial write occurs and the existing specific failure is returned.
Given the source is already at the canonical done target, when the command is retried, then it succeeds idempotently without duplicate activity.
[must-not] Given a tracker item, when Mark done runs, then it must not write the `cards` table.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Existing Tracker write behavior remains green after extraction.
- Board and Tracker use their correct source tables and activity streams.
- Tracker done applies the existing completed_at rule (`COALESCE(completed_at, now())` for the completed category, cleared otherwise) and tests pin it.
- The Mark done route publishes the same workspace events as the existing mutation paths (`tracker.updated`; `card.moved`/`card.updated` plus the CARD_ASSIGNED domain event for Board) so active-workspace views stay fresh.
- The POST route result-maps 404/409 outcomes; command errors must never reach the router catch-all that converts thrown errors into 503 `my_work_unavailable`.
- Membership/assignment reauthorization, mapping, version, idempotency, and no-partial-write behavior are tested.
- Route tests use the existing membership/assignment reauthorization boundary rather than trusting UI flags.

Must-not-have:

- No generic cross-source table write.
- No duplicate Tracker status mutation implementation.
- No bulk edit or reassignment behavior.

Open question risks:

- Membership/assignment state may change between list and mutation → enforce the existing 404/not_found route contract at mutation time.
- The existing Tracker PATCH applies status together with other fields in a single version bump/activity. The extracted service owns the status-only mutation path (My Work command and the route's status-only branch) and hosts the shared status-category/completed_at derivation; do not split the combined PATCH update into two writes just to force reuse.

Rollback note:

- Disable the My Work Mark done action/route; existing Board/Tracker mutation paths remain available.

## STOP CONDITIONS

Done when: source unit tests and existing mutation regressions pass, and the command is mounted behind authenticated My Work routes.
Uncertain when: idempotent retry cannot distinguish already-completed state from a stale conflicting update.
Escalate when: implementing the command requires changing physical schema or weakening existing mutation authorization.
