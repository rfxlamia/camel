# Task T4 — Reject column-less items on /cards endpoints

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Reject column-less items on /cards endpoints [depends: T2]

## OBJECTIVE
`/cards/:id` family returns 404 for column-less items; board-only actions are rejected.

Steps:
1. Write failing test for: "Column-less item through board-only endpoints"
   Test file: `server/src/modules/board/column-less-card-routes.integration.test.ts`
   Level: integration (Express app via supertest-style helper already used by `routes/cards-identity.integration.test.ts`)
   Test intent: Given a column-less card with key 50 / When `GET /cards/:id`, `PATCH /cards/:id`, `DELETE /cards/:id`, `POST /cards/:id/move`, and an attachment upload on it are called / Then each returns 404 and the row is unchanged
   Exercise through: the HTTP routes with an authenticated workspace member
   Test doubles: none; storage provider for attachments uses the existing test fake
   Expected RED: GET/PATCH return 200 (no column check in `card-read.ts:13`, `cards-update.ts:70,107,163`)
2. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/board/column-less-card-routes.integration.test.ts`
3. Add a shared `requireBoardCard` lookup (`column_id IS NOT NULL`) used by `card-read.ts`, `cards-update.ts`, `cards-delete.ts`, `cards-move.ts`, `card-attachments.ts`, `card-attachment-persistence.ts`; return the existing not-found error shape. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "fix(board): treat column-less items as not found on card routes"`.
4. Write failing test for: "Board cards unchanged"
   Test file: same
   Level: integration
   Test intent: Given a normal board card / When the same endpoints are called / Then behavior and status codes are exactly as before (including 409 on stale `version`)
   Exercise through: the HTTP routes
   Test doubles: none
   Expected RED: none expected; labeled regression guard. Prove it can fail by temporarily making `requireBoardCard` always return not-found, confirm RED, then restore
5. Run test — verify the outcome above and then PASS on the final code: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/board/column-less-card-routes.integration.test.ts`
6. Create `server/src/modules/board/require-board-card.ts` as the single shared helper (named here so the file map is exact), refactor while green (re-run the same command), then commit: `git commit -m "test(board): pin board card route behavior"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Rule "Client contract unchanged" (column-less rejection); Appendix B.5; Appendix C ("Must reject column-less items")
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: six files share one guard; a shared helper avoids six divergent copies (rule of three).

## SANDWICH CONTEXT
[CRITICAL: `/cards/*` never operates on a column-less item; the error must be the existing 404 shape, never a 500; the lookup must stay scoped by `workspace_id`.]
You are implementing column-less rejection for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B
Files in scope: the six board files above, the new `modules/board/require-board-card.ts`, and the test file
Available after: T2
Architecture rule: validation via `validators/http.ts`; no response-shape change
[RESTATE: 404, same shape, workspace-scoped.]

## DELIVERABLE
Given a column-less card, When any /cards endpoint above is called, Then 404 and no mutation
Given a board card, When called, Then behavior is unchanged

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - One shared helper imported by all six sites
Must-not-have:
  - Enabling `PATCH column_id` on column-less items (promote flow is out of scope)
Open question risks:
  - Attachment delivery already uses an inner join on columns (`card-attachment-delivery.ts:62-68`); do not duplicate its guard
Rollback note:
  - Revert commits.
Red flags:
  - Any status other than 404 for a column-less lookup → STOP

## STOP CONDITIONS
Done when: both scenarios pass and existing card route tests are green
Uncertain when: a route has no test harness
Escalate when: a route legitimately needs to read column-less items
