# Task T7 — Delete attachments and clean up soft-deleted cards

**Phase:** 2
**Depends:** T2, T4, T5, T6
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Delete attachments and clean up soft-deleted cards [depends: T2, T4, T5, T6] [test-risk]

## OBJECTIVE

Implement confirmed attachment DELETE with activity/SSE and best-effort file cleanup, plus explicit attachment-row/file cleanup in the existing soft-delete card transaction while preserving card history and version semantics.

Files:

- Modify: `server/src/routes/card-attachments.ts`
- Modify: `server/src/routes/cards.ts`
- Modify: `server/src/routes/card-attachments.integration.test.ts`

Steps:

1. Write failing test for: deleting a non-cover or cover attachment updates rows/files, activity, realtime, and deterministic next cover without changing card.version.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a card with cover A and image B, When an authorized member deletes B, Then B's row/files disappear, A remains cover, `attachment_removed` activity and `attachment.removed` SSE are emitted; when A is deleted, B becomes the next cover; in both cases `cards.version` is unchanged.

   Exercise through:
   - `DELETE /api/workspaces/:wsId/cards/:cardId/attachments/:id` and a follow-up board/card response.

   Test doubles:
   - temporary private storage and realtime publisher spy
   - do not mock the ownership guard, DB delete transaction, or cover ordering.

   Expected RED:
   - DELETE route is not implemented, so rows/files remain and no removal event/activity exists.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: delete/cover/activity/SSE assertions fail because only delivery/upload routes exist.

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/card-attachments.ts`
   Implement: shared-guarded DELETE, row deletion first inside a transaction, `recordActivity(..., "attachment_removed", { cardId, toColumnId: currentColumnId })`, commit-then-unlink of both files, publish `attachment.removed` after commit, and a 204 response. Leave `cards.version` untouched.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected: delete, cover reassignment, activity, SSE, and version-isolation assertions PASS.

5. Refactor while green (bounded):
   - Keep unlink best-effort after the row transaction; do not block a committed DB delete on an unlink exception.
   - Re-run the integration file and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
   `git commit -m "feat(attachments): delete images with activity events"`

7. Write failing test for: deleting a card with attachments explicitly removes attachment rows in the soft-delete transaction and unlinks files best-effort.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a card with two attachments, When the existing card DELETE endpoint succeeds, Then the card is soft-deleted, attachment rows are removed in that transaction, both files are unlinked after commit, and a simulated unlink failure does not turn the successful card deletion into a 500; no tracker row is touched.

   Exercise through:
   - existing `DELETE /api/workspaces/:wsId/cards/:id` route plus database/file inspection.

   Test doubles:
   - temporary storage with an injected unlink failure for the failure branch
   - do not mock the card delete transaction, FK/query behavior, or attachment cleanup selection.

   Expected RED:
   - current soft-delete handler only sets `cards.deleted_at`; attachment rows/files would survive because FK cascade does not run.

8. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: attachment rows/files remain after soft-delete or unlink failure handling is absent.

9. Implement minimal code to satisfy the test:
   File: `server/src/routes/cards.ts`
   Implement: select attachment paths while the card row is locked, delete attachment rows explicitly in the same transaction as the card soft-delete/activity, return cleanup paths with the transaction result, and unlink each path after commit without blocking the existing card-deleted event/204 response.

10. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: soft-delete cleanup, failure tolerance, and tracker-isolation assertions PASS.

11. Refactor while green (bounded):
    - Preserve `card_events` history and the existing soft-delete contract; retain schema FK cascade only for hard-delete fallback.
    - Re-run the complete integration file and server typecheck — both must stay PASS.

12. Commit:
    `git add server/src/routes/cards.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): clean files on soft-deleted cards"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — delete ordering, confirmation boundary, cascade wording, best-effort unlink, and version isolation.
- `server/src/routes/cards.ts` — existing soft-delete transaction and card activity/event behavior.
- `server/src/routes/card-attachments.ts` — T5/T6 guard/upload/event route.
- `server/src/lib/attachment-storage.ts` — provider cleanup API.
- `server/src/db/schema.sql` — FK cascade and soft-delete schema reality.

## WHY THIS APPROACH

Complexity: deep
Justification: The spec's FK-cascade wording conflicts with the current soft-delete implementation. This task explicitly resolves that conflict without hard-deleting cards: attachment rows are removed in the soft-delete transaction and files are cleaned afterward, while direct attachment delete remains independently testable.

## SANDWICH CONTEXT

[CRITICAL: Preserve card soft-delete/activity history; attachment cleanup must not hard-delete cards or change `cards.version`.]
You are implementing attachment deletion and card-deletion cleanup for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: delete DB rows before best-effort file unlink; use explicit soft-delete cleanup because current cards are soft-deleted.
Files in scope: `server/src/routes/card-attachments.ts`, `server/src/routes/cards.ts`, `server/src/routes/card-attachments.integration.test.ts`.
Available after: T2 storage, T4 contracts, T5 guard, T6 upload/activity foundation.
Architecture rule: all attachment deletes use the shared ownership chain; card deletion preserves existing domain events and never touches tracker tables.
[RESTATE: Preserve card soft-delete/activity history; attachment cleanup must not hard-delete cards or change `cards.version`.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given cover A and image B, When B is deleted, Then A remains cover and B's row/files/activity/SSE are gone.
Given cover A and image B, When A is deleted, Then B is the next cover on response hydration.
Given a card with attachments, When the card is soft-deleted, Then attachment rows are explicitly deleted and files are unlinked best-effort without blocking card deletion.
Given an unlink failure, When the DB deletion has committed, Then the API still succeeds and records no false rollback.
Given any attachment delete, Then `cards.version` and `tracker_items` remain unchanged.

All tests PASS. Commits exist with messages matching `feat|fix(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Shared ownership guard protects DELETE.
- Row deletion precedes unlink; unlink failure cannot resurrect or roll back committed DB state.
- Explicit soft-delete cleanup preserves card history and publishes existing card-deleted events.
- Cover ordering naturally reverts to next/empty state.

Must-not-have:

- Hard-delete cards, delete card events, bump `cards.version`, or touch tracker tables.
- Orphaned attachment rows intentionally retained after a successful soft-delete.

Open question risks:

- Accepted orphan risk remains if the process crashes between commit and unlink; no sweeper is in scope.

Rollback note:

- Disable delete UI/route if needed; existing card deletion can be restored independently because cleanup code is additive.

## STOP CONDITIONS

Done when both integration cycles pass and typecheck is green.
Uncertain when the existing card-delete transaction cannot return cleanup paths safely; report NEEDS_CONTEXT.
Escalate when the implementation proposes hard deletion or changes card activity retention.
