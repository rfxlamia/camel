# Task T1 — Add the My Work wire contract and Fuse.js dependency

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: Add the My Work wire contract and Fuse.js dependency [prereq]

## OBJECTIVE

Define the client-facing My Work response/request contract and add the approved fuzzy-search dependency without implementing the page or server endpoint.

Files:

- Create: `client/src/types/myWork.ts`
- Create: `client/src/api/myWork.ts`
- Create: `client/src/api.my-work.test.ts`
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Modify: `client/package.json`
- Modify: `package-lock.json`

Steps:

1. Write failing test for: list request serializes supplied filters.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent: Given fake fetch and an authorized server envelope, when listMyWork receives scope/query/workspace/source/cursor/page size, then exact URL/query and typed response are observed, the envelope is forwarded unchanged, and no membership/assignment request is made.
   Exercise through: public api.listMyWork.
   Test doubles: fake fetch via configureRequestBoundaryForTests; do not mock API methods or authorization discovery.
   Expected RED: listMyWork and its contract do not exist.

2. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

3. Implement minimal behavior:
   Add the list request type/method and response contract. Preserve the authorized envelope and do not perform membership/assignment discovery.

4. Run test — verify PASS:
   `npm run test --workspace=client -- src/api.my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

5. Write failing test for: omitted optional filters are not serialized as invalid values.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent: Given default Active scope only, when listMyWork runs, then undefined/empty workspace/source/cursor values are absent.
   Exercise through: public API method and captured URL.
   Test doubles: fake fetch; do not mock query construction.
   Expected RED: omission behavior is not implemented.

6. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

7. Implement minimal behavior:
   Implement optional query serialization and safe defaults.

8. Run test — verify PASS:
   `npm run test --workspace=client -- src/api.my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

9. Write failing test for: detail and Mark done use composite identity/version.
   Test file: `client/src/api.my-work.test.ts`
   Level: unit
   Test intent: Given workspace/source/key/version, when detail and Mark done methods run, then composite identity and version/body use the correct paths.
   Exercise through: public API methods.
   Test doubles: fake fetch; do not mock response parsing.
   Expected RED: detail/Mark done methods do not exist.

10. Run test — verify FAIL:
   `npm run test --workspace=client -- src/api.my-work.test.ts`
   Expected failure: the named behavior is absent or its assertion fails.

11. Implement minimal behavior:
   Implement detail and Mark done contract methods.

12. Run test — verify PASS:
   `npm run test --workspace=client -- src/api.my-work.test.ts`
   Expected: the named cycle passes without weakening adjacent behavior.

13. Refactor while green (bounded):
   Keep logic within the task's declared files, reuse existing helpers, and do not implement out-of-scope behavior. Re-run the task test command.

14. Commit:
   git add client/src/types/myWork.ts client/src/api/myWork.ts client/src/api.my-work.test.ts client/src/types.ts client/src/api.ts client/package.json package-lock.json
    git commit -m "feat(my-work): define client contract and search dependency"

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md` — Dependencies, Scope, and Acceptance Criteria for API contract and fuzzy search.
- `client/src/api.ts` — existing request boundary and façade composition.
- `client/src/types.ts` — existing central type registry.
- Fuse.js official docs — object keys, threshold, result limit, and bounded client dataset behavior.

## WHY THIS APPROACH

Complexity: standard
Justification: This is a prerequisite shared contract across the client API, page, and server response. It also isolates the new dependency and avoids parallel tasks inventing incompatible response shapes.

## SANDWICH CONTEXT

[CRITICAL: My Work must not make the client an authorization boundary; the server remains authoritative for membership and assignment.]
You are defining the contract for My Work in `camel-kanban`.
Spec: `docs/pocket/spec/2026-09-11-my-work/my-work-spec.md`
Design decision: server-side personal rollup with global detail and source-aware writes.
Files in scope: the contract/API/dependency files listed above; no server query or page implementation.
Available after: none (prerequisite).
Architecture rule: preserve the existing API request boundary and use Fuse.js only for client ranking after authorized data is returned.
[RESTATE: My Work must not make the client an authorization boundary; the server remains authoritative for membership and assignment.]

## DELIVERABLE

Given a configured fake fetch boundary, when each My Work API method is called, then its URL, query, body, and typed result match the contract.
Given optional filters are omitted, when the list method is called, then it does not emit invalid empty query parameters.
[must-not] Given a client search query, when the API contract is used, then it must not imply client-side authorization or direct database access.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Domain API methods are composed into the existing façade without a duplicate request implementation.
- My Work response types carry workspace/source/composite identity and action availability/reason metadata.
- Fuse.js is installed only in the client workspace and lockfile is updated.
- API unit tests are written before implementation and pass.

Must-not-have:

- No server implementation in this prerequisite task.
- No page components, mutation behavior, or database schema changes.
- No direct API calls from future UI code outside the API/mutation boundaries.

Open question risks:

- All-scope fuzzy candidate behavior remains an explicit later assumption; do not hide it in this contract task.

Rollback note:

- Remove the additive client dependency/contract files; no data migration exists.

## STOP CONDITIONS

Done when: the API contract tests pass, the dependency lock is valid, and the commit exists.
Uncertain when: the response shape cannot represent source/workspace identity or action permissions without changing the approved spec.
Escalate when: a second request boundary or a server schema migration appears necessary.
