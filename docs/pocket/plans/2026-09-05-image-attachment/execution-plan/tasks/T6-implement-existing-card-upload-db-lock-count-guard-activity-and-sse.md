# Task T6 — Implement existing-card upload, DB lock/count guard, activity, and SSE

**Phase:** 2
**Depends:** T3, T4, T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Implement existing-card upload, DB lock/count guard, activity, and SSE [depends: T3, T4, T5] [test-risk]

## OBJECTIVE

Add the existing-card multipart POST path with server validation, DB-level row lock/count enforcement, partial batch acceptance, activity logging, private-file cleanup on rollback, and `attachment.added` broadcast.

Files:

- Modify: `server/src/routes/card-attachments.ts`
- Modify: `server/src/routes/helpers.ts`
- Modify: `server/src/realtime.ts` (only the real hub/test seam)
- Modify: `server/src/routes/card-attachments.integration.test.ts`

Steps:

1. Write failing test for: one valid existing-card upload stores both bytes, creates one row/activity event, leaves `card.version` unchanged, and publishes an attachment event.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a member and a card with one existing attachment, When they upload a valid 2MB PNG pair, Then exactly one attachment row/files are stored, an `attachment_added` card event uses the card's current `to_column_id`, `publishEvent()` receives `attachment.added`, the response reports the new total, and `cards.version` is unchanged.

   Exercise through:
   - `POST /api/workspaces/:wsId/cards/:cardId/attachments` with multipart files and the real DB transaction.

   Test doubles:
   - temporary private storage and mocked realtime publisher only
   - do not mock the DB transaction, lock/count query, route, or activity helper under test.

   Expected RED:
   - the POST route is not implemented and `recordActivity()` does not accept `attachment_added`.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: POST returns 404/typecheck rejects the new event type.

3. Implement minimal code to satisfy the test:
   Files: `server/src/routes/card-attachments.ts`, `server/src/routes/helpers.ts`
   Implement: paired multipart parsing for the already-valid fixture path, a non-concurrent happy-path count check, provider writes, attachment insert, `recordActivity(..., "attachment_added", { cardId, toColumnId: currentColumnId })`, publish after commit, and response with total/count. Leave invalid-payload validation/error mapping, rollback cleanup, and concurrency serialization for their dedicated RED cycles below; do not update `cards.version`.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected: valid upload, activity, realtime, and version-isolation assertions PASS.

5. Refactor while green (bounded):
   - Keep validation/storage/transaction orchestration in the attachment route/provider boundary; do not duplicate signature parsing.
   - Re-run the integration file and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/routes/card-attachments.ts server/src/routes/helpers.ts server/src/routes/card-attachments.integration.test.ts`
   `git commit -m "feat(attachments): upload images to existing cards"`

7. Write failing test for: concurrent uploads at 2/3 allow exactly one success and never create a fourth row.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a card with two existing attachments and a test-only post-count/pre-insert contention hook, When the first valid upload pauses after counting and the second upload starts against the same card, Then the second cannot reach the hook before the first is released and commits; afterward exactly one request succeeds, the other returns the over-cap error, and the final count is exactly three with no orphan file for the rejected request. The test always releases the first request after observing the second request's blocked/reached state so it cannot deadlock.

   Exercise through:
   - two HTTP POST requests against the same card, the real PostgreSQL transaction/row lock, and a narrow deterministic contention hook at the count/insert seam.

   Test doubles:
   - temporary storage, realtime publisher, and a synchronization latch that observes/releases the narrow route hook
   - do not mock PostgreSQL locking/count behavior, the count/insert queries, or the attachment route.

   Expected RED:
   - without the locked count guard, the second request deterministically reaches the post-count hook while the first is paused, so both can observe two rows and the final assertions expose the fourth insert.

8. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: both uploads may succeed or the loser may leave a file/row, violating 3-image cap.

9. Implement minimal code to satisfy the test:
   Files: `server/src/routes/card-attachments.ts`, `server/src/routes/card-attachments.integration.test.ts`
   Implement: lock the card row inside each insert transaction before counting; choose available slots while holding the lock; unlink any pair that cannot be committed or whose transaction rolls back; expose only the narrow optional post-count/pre-insert hook needed for deterministic integration-test contention, with no production timing behavior when it is unset.

10. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: exactly one concurrent request succeeds and final count never exceeds three.

11. Refactor while green (bounded):
    - Keep the count decision and insert in the same transaction; do not replace the lock with an application-memory mutex.
    - Re-run the complete integration file — must stay PASS.

12. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): serialize card attachment capacity"`

13. Write failing test for: a card already at capacity rejects a fourth image with the exact cap message and zero side effects.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given a card with three existing attachments, When a member submits one additional valid image pair, Then the route returns the exact `Max 3 images per card` response and creates no file, attachment row, activity row, realtime event, or `cards.version` change.

    Exercise through:
    - the public existing-card multipart POST route and real locked DB count transaction.

    Test doubles:
    - temporary private storage and realtime publisher spy
    - do not mock the capacity calculation, card-row lock, route, activity helper, or transaction.

    Expected RED:
    - the concurrency cycle serializes racing inserts but does not yet require the zero-slot route response, exact cap message, or proof that a fully rejected request performs no writes/side effects.

14. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: the at-cap request returns a non-specific result or writes a file/row/activity/event instead of the exact zero-side-effect rejection.

15. Implement minimal code to satisfy the test:
    File: `server/src/routes/card-attachments.ts`
    Implement: while holding the card-row lock, return the exact cap error when available slots are zero before any provider write, attachment/activity insert, or publish scheduling; keep `cards.version` unchanged.

16. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: exact 3/3 rejection and all zero-side-effect assertions PASS.

17. Refactor while green (bounded):
    - Reuse the locked available-slot calculation for full-cap and partial-cap paths without duplicating guard logic.
    - Re-run the complete integration file — must stay PASS.

18. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): reject uploads at card capacity"`

19. Write failing test for: batch overflow accepts what fits and rejects the rest with total-state and batch-result messages.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given a card with one existing attachment, When four valid images are submitted in one batch, Then two are stored, two are rejected, the response/UI-facing payload says `2 of 4 images added — card limit is 3 images`, and the persistent count is `3/3`; exactly two attachment-added activity rows and two post-commit realtime events exist, while rejected images create no row, file, activity, or event.

    Exercise through:
    - the public multipart POST response and persisted attachment rows.

    Test doubles:
    - temporary storage and a realtime publisher spy
    - do not mock capacity calculation or the transaction.

    Expected RED:
    - the route currently has no batch result contract and cannot partially accept by locked capacity.

20. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: partial acceptance/result-message assertions fail.

21. Implement minimal code to satisfy the test:
    File: `server/src/routes/card-attachments.ts`
    Implement: deterministic accepted/rejected result metadata, capacity-only per-pair rejection reasons, accepted-count/total-count fields, and exact overflow message; ensure rejected pairs are never written and accepted pairs each create activity/realtime records according to the event contract. Leave MIME/signature/size/dimension validation error mapping for its following RED cycle.

22. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: batch acceptance, rejection, `3/3` total, and cleanup assertions PASS.

23. Refactor while green (bounded):
    - Re-run the complete integration file, server typecheck, and root `npm run test` before commit; all must stay PASS.

24. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "feat(attachments): support partial batch uploads"`

25. Write failing test for: invalid format, oversized file, disguised signature, and oversized dimensions are rejected before row/file persistence.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given a non-image, over-10MB, PDF-disguised-as-PNG, or under-10MB image declaring dimensions above 4096, When the existing-card upload endpoint receives it, Then it returns the correct validation message and creates no row or file. Given a valid thumbnail paired with an invalid original, or an invalid thumbnail paired with a valid original, When the pair is submitted, Then the pair is rejected before either payload is written; repeat the signature, size, and dimension cases for both fields.

    Exercise through:
    - direct multipart HTTP requests, including client-bypass dimension fixtures for each thumbnail/original position.

    Test doubles:
    - temporary storage directory
    - do not mock validator or route persistence.

    Expected RED:
    - route-level validation and error mapping are not yet present.

26. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: invalid upload requests are accepted, return generic errors, or persist bytes.

27. Implement minimal code to satisfy the test:
   File: `server/src/routes/card-attachments.ts`
   Implement: exact user-facing error mapping (`Only PNG and JPEG accepted`, `File size must be under 10MB`, and the dimension rejection) before provider writes/DB inserts.

28. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: all invalid-input cases reject with no persisted artifacts.

29. Refactor while green (bounded):
    - Re-run the complete integration file and server typecheck — must stay PASS.

30. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): reject invalid upload payloads"`

31. Write failing test for: a real transaction failure after provider write rolls back every persistent and observable side effect.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given a valid pair whose opaque paths match a test-only failure marker and a conditional `BEFORE INSERT ON attachments` trigger installed through the same configured application test pool on the exact relation used by the route, When the existing-card upload writes the pair and the insert raises a controlled database error, Then no attachment row or activity row commits, both newly written files are unlinked, no realtime event is published, and `cards.version` remains unchanged. The trigger is installed/removed serially and cannot affect unrelated fixtures.

    Exercise through:
    - the public multipart POST route, real provider writes, and the real application DB pool/relation used by that request.

    Test doubles:
    - temporary private storage, deterministic opaque-path marker, and realtime publisher spy
    - do not mock the DB transaction, attachment insert, cleanup provider, activity helper, or route.

    Expected RED:
    - the happy-path implementation has no tested post-write DB-failure cleanup boundary, so the forced insert error can leave files or emit activity/realtime too early.

32. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: the forced route-bound insert error leaves at least one file/side effect or changes the parent card version.

33. Implement minimal code to satisfy the test:
    File: `server/src/routes/card-attachments.ts`
    Implement: track every pair written for the request, remove those paths when the real insert transaction fails, keep activity inside the rollback boundary, and publish only after commit. Preserve the documented crash-window orphan risk without adding a sweeper.

34. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: forced post-write DB failure leaves no row, file, activity, event, or version change.

35. Refactor while green (bounded):
    - Keep rollback cleanup best-effort and observable without claiming filesystem/DB two-phase commit.
    - Re-run the complete attachment integration file and server typecheck — both must stay PASS.

36. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "fix(attachments): clean failed existing uploads"`

37. Write failing test for: a real attachment mutation reaches an in-process SSE subscriber as an `attachment.added` event for another viewer.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration (mutation → realtime seam)

    Test intent:
    Given a second viewer subscribed through the existing realtime hub, When the existing-card upload route commits a valid attachment, Then the actual post-commit `publishEvent` path delivers one SSE payload with `type: attachment.added`, the workspace/card id, and metadata-only payload; the test may fake Redis clients but must not replace the realtime hub or route publisher with a spy.

    Exercise through:
    - the public upload route, real in-process realtime hub/SSE handler, and a test subscriber connection.

    Test doubles:
    - fake Redis publisher/subscriber transport and temporary filesystem only at external boundaries
    - do not mock `publishEvent`, the realtime hub, the route, or the DB transaction.

    Expected RED:
    - current upload flow either has no event or the integration harness has no explicit attachment event delivery path to a subscriber.

38. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: the subscriber never receives the attachment mutation event or receives the wrong event shape.

39. Implement minimal code to satisfy the test:
    Files: `server/src/routes/card-attachments.ts`, `server/src/realtime.ts`, `server/src/routes/card-attachments.integration.test.ts`
    Implement: only the dependency-injection/test-harness seam needed to exercise the real realtime hub, preserving production `publishEvent` behavior and post-commit ordering.

40. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: real mutation-to-SSE event delivery assertions PASS.

41. Refactor while green (bounded):
    - Re-run the complete attachment integration file and server typecheck — both must stay PASS.

42. Commit:
    `git add server/src/routes/card-attachments.ts server/src/realtime.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "test(attachments): verify upload SSE delivery"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — existing-card rules, concurrency guard, batch result, event names, activity, and card-version isolation.
- `server/src/routes/helpers.ts` — `recordActivity()` closed event union and current-column activity constraint.
- `server/src/realtime.ts` — `publishEvent()` fallback behavior.
- `server/src/routes/card-attachments.ts` — T5 shared guard/delivery boundary.
- `server/src/lib/file-validator.ts` and `server/src/lib/attachment-storage.ts` — T2/T3 validation and storage APIs.
- `server/src/routes.integration.test.ts` — route fixture and realtime-mocking conventions.

## WHY THIS APPROACH

Complexity: deep
Justification: This task owns the hardest existing-card boundary: multipart input, two-byte-payload validation, filesystem cleanup, PostgreSQL row locking, activity, and realtime. Each GWT has an integration cycle so unit tests cannot accidentally miss concurrency or persistence behavior.

## SANDWICH CONTEXT

[CRITICAL: Capacity must be decided under a PostgreSQL card-row lock and committed attachment rows/files must never make `cards.version` change.]
You are implementing existing-card image upload for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: one logical attachment row receives thumbnail and original bytes through a local storage provider.
Files in scope: `server/src/routes/card-attachments.ts`, `server/src/routes/helpers.ts`, `server/src/realtime.ts`, `server/src/routes/card-attachments.integration.test.ts`.
Available after: T3 validation, T4 response/event contracts, T5 guard/delivery.
Architecture rule: use `recordActivity()` for every accepted image, publish only after commit, and never touch tracker/unified routes.
[RESTATE: Capacity must be decided under a PostgreSQL card-row lock and committed attachment rows/files must never make `cards.version` change.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a card with room, When a member uploads a valid PNG/JPEG pair, Then storage, attachment row, activity, response count, and SSE event all succeed without changing card.version.
Given a card at 2/3, When two uploads race, Then exactly one succeeds and the final count is 3.
Given a card at 3/3, When a fourth valid image is submitted, Then the route returns `Max 3 images per card` and creates no file, row, activity, event, or version change.
Given a card at 1/3, When four valid images arrive, Then two are stored, two rejected, the message says `2 of 4 images added — card limit is 3 images`, and the persistent total is `3/3`.
Given invalid MIME, size, signature, or dimensions, When the endpoint receives the payload, Then it rejects before writing a file or row.
Given provider bytes were written, When the real attachment insert transaction fails, Then no row, file, activity, realtime event, or card-version change remains.
Given another viewer is subscribed, When a valid upload commits, Then the real in-process realtime hub delivers exactly one metadata-only `attachment.added` SSE payload.

All tests PASS. Commits exist with messages matching `feat|fix(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Row lock and count check are in the same transaction as each accepted insert.
- Rejected/rolled-back pairs are unlinked and never left as rows.
- Activity uses `attachment_added`, plain metadata, current column id, and no thumbnail bytes.
- Realtime is published only after the DB transaction commits.

Must-not-have:

- Application-only mutex, card version bump, tracker writes, public storage, or all-or-nothing rejection of a valid batch that can fit partially.
- Generic error text where the specified validation/capacity message is required.

Open question risks:

- Accepted residual crash-window orphan risk remains; do not add a sweeper in this task.

Rollback note:

- Disable the POST route/UI while retaining additive schema; existing cards/columns remain usable.

## STOP CONDITIONS

Done when all seven integration cycles pass, typecheck is green, and commits exist.
Uncertain when PostgreSQL locking cannot be exercised with the available DB fixture; report NEEDS_CONTEXT rather than replacing it with a fake mutex.
Escalate when implementation touches `tracker_items`, changes `cards.version`, or writes rejected files.
