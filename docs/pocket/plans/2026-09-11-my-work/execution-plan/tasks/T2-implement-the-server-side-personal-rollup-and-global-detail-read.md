# Task T2 — Implement the server-side personal rollup and global detail read

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 2: Implement the server-side personal rollup and global detail read [depends: T1]

## OBJECTIVE

Add authenticated, set-based My Work list/detail reads across authorized workspaces, with assignee filtering, source/workspace metadata, per-workspace deduplication, status normalization inputs, and fail-closed detail reauthorization.

Files:

- Create: `server/src/routes/my-work-response.ts`
- Create: `server/src/routes/my-work.ts`
- Modify: `server/src/routes.ts`
- Test: `server/src/routes/my-work.test.ts`

Steps:

1. Write failing test for: authorized cross-workspace rollup.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given Atlas/Orbit membership and assigned Board/Tracker rows, when Active rollup runs, then authorized rows carry workspace/source identity and appear once.
   Exercise through: personal list handler/service with fake DB executor.
   Test doubles: fake DB/membership/assignee loaders; do not mock merge logic.
   Expected RED: personal route/response module does not exist.

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Implement membership-scoped source query skeleton, workspace metadata, and response serialization.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: per-workspace dedup/composite identity.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given duplicate joins, same-key card/tracker rows in Atlas, and same key in Orbit, when merge runs, then tracker-wins is Atlas-local and identities are unique.
   Exercise through: merge/serialization boundary.
   Test doubles: fake source rows/loaders; do not mock dedup.
   Expected RED: dedup/composite behavior is absent.

6. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement per-workspace dedup and batched hydration.

8. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: unauthorized workspace exclusion.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given Alice is not a Nebula member but an assigned Nebula row exists, when list runs, then no Nebula row or metadata is returned.
   Exercise through: personal authorization boundary.
   Test doubles: fake membership/source rows; do not mock authorization decision.
   Expected RED: unauthorized leakage is possible.

10. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement membership predicate and fail-closed exclusion.

12. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Write failing test for: Active/All status normalization and Other fallback.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given completed/canceled/backlog/started/unknown statuses, when Active/All runs, then terminal rows are excluded from Active and unknown remains Other in All.
   Exercise through: list response boundary.
   Test doubles: fake rows/status values; do not mock normalization.
   Expected RED: scope/category behavior is absent.

14. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

15. Implement minimal behavior:
   Implement status category/slot normalization inputs and Active/All filtering.

16. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

17. Write failing test for: detail reauthorization and existing 404 contract.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given access/assignment is revoked after list load, when detail runs, then HTTP 404 with existing not_found/Not found behavior returns no cached content.
   Exercise through: detail route factory.
   Test doubles: fake current authorization state; do not mock error mapping.
   Expected RED: stale detail returns content or wrong status/code.

18. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

19. Implement minimal behavior:
   Implement detail reauthorization and exact existing 404/not_found mapping.

20. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

21. Write failing test for: All-scope search across terminal/Other statuses.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given all status categories, when All q runs, then matching candidates from every category return.
   Exercise through: personal list service.
   Test doubles: fake DB rows/query predicates; do not mock query logic.
   Expected RED: All search is absent.

22. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

23. Implement minimal behavior:
   Implement All query search predicates and candidate response.

24. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

25. Write failing test for: workspace/source filters.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given matching Atlas/Orbit Board/Tracker rows, when workspace/source filters run, then only matching authorized rows return.
   Exercise through: personal list service.
   Test doubles: fake DB executor with captured predicates; do not mock filter logic.
   Expected RED: filter predicates are absent.

26. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

27. Implement minimal behavior:
   Implement server-side workspace/source filters.

28. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

29. Write failing test for: cursor pagination.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given ordered rows and page size, when cursor requests run, then pages have no duplicate/gap and next cursor is deterministic.
   Exercise through: personal list service.
   Test doubles: fake DB executor with captured order/limit predicates; do not mock pagination.
   Expected RED: cursor behavior is absent.

30. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

31. Implement minimal behavior:
   Implement cursor encoding/decoding and deterministic ordering.

32. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

33. Write failing test for: transient list failure classification.
   Test file: `server/src/routes/my-work.test.ts`
   Level: unit
   Test intent: Given injected query dependency throws transient error, when list runs, then retryable classification returns no partial payload.
   Exercise through: route factory dependency seam.
   Test doubles: injected failing query dependency; do not mock error mapping.
   Expected RED: failure seam/classification is absent.

34. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

35. Implement minimal behavior:
   Implement route dependency injection and exact transient error mapping.

36. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

37. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

38. Commit:
   git add server/src/routes/my-work-response.ts server/src/routes/my-work.ts server/src/routes.ts server/src/routes/my-work.test.ts
    git commit -m "feat(my-work): add authorized personal rollup"

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md` — Authorized rollup, Active/All, detail, identity, and failure criteria.
- `server/src/routes/work-item-response.ts` — existing dual-table serializers and batch hydration.
- `server/src/routes/workspaces.ts` and `server/src/routes/helpers.ts` — membership patterns.
- `server/src/routes/tracker-assignees.ts`, `server/src/routes/card-assignees.ts` — assignee query helpers.
- `server/src/routes.ts` — authenticated route mount boundary.
- Kysely docs — additive WHERE clauses, reusable type-safe query expressions, and transaction constraints.

## WHY THIS APPROACH

Complexity: deep
Justification: This is the primary security and performance boundary. It crosses both physical work-item tables, membership authorization, hydration, deduplication, cursor/search semantics, and global detail reauthorization.

## SANDWICH CONTEXT

[CRITICAL: The server must authorize membership and assignment before returning any My Work data; client filtering is never a security boundary.]
You are implementing the personal read boundary for My Work.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: server-side personal rollup, not client fan-out or a persistent projection.
Files in scope: `server/src/routes/my-work-response.ts`, `server/src/routes/my-work.ts`, `server/src/routes.ts`, and their unit test.
Available after: T1.
Architecture rule: use set-based per-source queries and batch hydration; preserve per-workspace tracker-wins dedup and soft-delete filters.
[RESTATE: The server must authorize membership and assignment before returning any My Work data; client filtering is never a security boundary.]

## DELIVERABLE

Given authorized Atlas/Orbit membership and assigned Board/Tracker rows, when the personal list is requested, then authorized rows appear exactly once with workspace/source identity.
Given a same-key card/tracker collision, when the list is built, then tracker wins only inside that workspace.
Given detail access is revoked after list load, when detail is requested, then an unavailable response contains no cached task content.
[must-not] Given a workspace is unauthorized, when the list runs, then no workspace/task metadata leaks.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- No N+1 call to the existing per-workspace list endpoint.
- Membership, assignee, soft-delete, identity, and dedup behavior are tested.
- List/detail error semantics distinguish unauthorized access from transient server failure.
- All queries use Kysely parameterized expressions and existing DB types.

Must-not-have:

- No client-side authorization reliance.
- No `work_items` migration or changes to existing Board/Tracker route semantics.
- No modifications to active-workspace SSE.

Open question risks:

- All-scope fuzzy candidate strategy remains server-paginated and may require later server search indexing.

Rollback note:

- Remove the additive route mount and new response/route files; existing workspace-scoped endpoints remain intact.

## STOP CONDITIONS

Done when: route/unit tests pass, personal reads are mounted behind auth, and no per-workspace fan-out exists.
Uncertain when: the existing serializers cannot represent workspace metadata without changing legacy response contracts.
Escalate when: membership/assignment authorization requires a schema migration or route behavior changes outside My Work.
