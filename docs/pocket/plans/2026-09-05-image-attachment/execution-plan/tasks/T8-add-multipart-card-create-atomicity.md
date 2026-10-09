# Task T8 — Add multipart card-create atomicity

**Phase:** 2
**Depends:** T2, T3, T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 8: Add multipart card-create atomicity [depends: T2, T3, T4] [test-risk]

## OBJECTIVE

Extend board card creation to accept staged thumbnail/original pairs in the same multipart request, write files before the transaction, insert card and attachment rows atomically, unlink newly written files on failure, and preserve the existing JSON create path.

Files:

- Modify: `server/src/routes/card-create.ts`
- Modify: `server/src/routes/cards.ts`
- Modify: `server/src/lib/attachment-storage.ts` (narrow testable provider seam)
- Create: `server/src/routes/card-create-attachments.integration.test.ts`

Steps:

1. Write failing test for: a valid multipart card-create request creates the card and attachment row together and returns a hydrated cover.
   Test file: `server/src/routes/card-create-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a member, destination column, title, and one valid thumbnail/original pair, When they submit the multipart card-create request, Then the server writes the pair, inserts the card and attachment row in one DB transaction, records normal card creation plus attachment activity, publishes the card/attachment events after commit, and returns a card response with the cover summary. Given multiple pairs, When thumbnail/original fields are positionally paired, Then each row points to its matching pair; unequal field counts or more than three pairs are rejected before any card is created.

   Exercise through:
   - public `POST /api/workspaces/:wsId/cards` multipart boundary and real `createCard` transaction.

   Test doubles:
   - temporary private storage and realtime publisher spy
   - do not mock `prepareCreate`, `persistCreatedCard`, DB transaction, or attachment insert.

   Expected RED:
   - card creation currently parses JSON only and has no attachment fields/insert path.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-create-attachments.integration.test.ts`
   Expected failure: multipart request is not parsed or card response has no attachment row/cover.

3. Implement minimal code to satisfy the test:
   Files: `server/src/routes/cards.ts`, `server/src/routes/card-create.ts`
   Implement: attach the T2 `maxPairs: 3` memory-upload profile to the create route without breaking JSON requests; parse card metadata fields plus positionally paired files; reject unequal counts/parser overflow; for the already-valid fixture path, write files before opening the DB transaction, insert attachment rows inside the existing create transaction, hydrate the cover, and publish after commit. Leave byte-validation error mapping and every provider/DB failure cleanup branch for the dedicated RED cycle below.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-create-attachments.integration.test.ts`
   Expected: multipart create returns hydrated card/cover and preserves existing card creation activity/events.

5. Refactor while green (bounded):
   - Keep normal JSON card create behavior unchanged when no files are supplied.
   - Re-run the integration command and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/routes/cards.ts server/src/routes/card-create.ts server/src/routes/card-create-attachments.integration.test.ts`
   `git commit -m "feat(attachments): create cards with staged images"`

7. Write failing test for: invalid staged bytes, mid-batch provider failure, or a deterministic real database failure creates no card/attachment row and cleans every file written earlier in the request.
   Test file: `server/src/routes/card-create-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a staged 15MB/invalid-signature/oversized-dimension image, When multipart card-create is submitted, Then validation rejects before any provider write and no card/attachment/activity/event exists. Given multiple valid pairs and a provider that writes the first pair but raises on the second, When multipart card-create is submitted, Then every file from the first pair is removed and no card/attachment/activity/event exists. Given valid written pairs and a conditional temporary `BEFORE INSERT ON attachments` trigger installed through the exact application test pool and relation used by the public request, When the insert raises a controlled database error, Then the card and attachment transaction rolls back, all newly written bytes are unlinked, no activity or `card.created`/`attachment.added` event escapes, and the response is a retryable validation/server error suitable for an editable client form.

   Exercise through:
   - multipart create HTTP boundary with real validation, sequential provider writes/cleanup, and real DB rollback; the conditional trigger is installed/removed serially through the same configured application pool on the exact `attachments` relation used by the route.

   Test doubles:
   - temporary storage, a provider wrapper that delegates the first pair to real temporary-disk storage and fails on the second pair, a deterministic trigger marker, and realtime publisher spy
   - do not mock the DB transaction, route, first-pair filesystem write/cleanup, attachment insert, or the application pool/relation; use the real conditional DB trigger for deterministic rollback.

   Expected RED:
   - the first cycle deliberately omitted byte-error and failure-cleanup branches, so invalid error mapping is incomplete and a second provider write or route-bound attachment insert failure can leave earlier files or observable side effects.

8. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-create-attachments.integration.test.ts`
   Expected failure: invalid create leaves a card/file, or the temporary DB failure does not roll back and clean up.

9. Implement minimal code to satisfy the test:
   Files: `server/src/routes/card-create.ts`, `server/src/lib/attachment-storage.ts`
   Implement: all-pairs validation before persistence, atomic card/attachment DB inserts, cleanup of every path accumulated from earlier successful pair writes when a later provider write or any pre-commit step fails, exact validation errors, and a narrow storage-provider injection seam with the production provider as default so the integration test can force a mid-batch filesystem failure without mocking the transaction. Bind the conditional trigger test to the actual route pool/relation and remove it reliably after the serial test. Keep the accepted v1 idempotency residual risk.

10. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-create-attachments.integration.test.ts`
    Expected: invalid, mid-batch provider-failure, and DB-rollback requests leave no card, row, activity, event, or newly written file, including the real route-bound temporary DB-trigger failure.

11. Refactor while green (bounded):
    - Re-run the complete integration file, server typecheck, and the existing card-create test coverage; all must stay PASS.
    - Keep the transaction's DB-row atomicity wording explicit; do not claim filesystem two-phase commit.

12. Commit:
    `git add server/src/routes/card-create.ts server/src/lib/attachment-storage.ts server/src/routes/card-create-attachments.integration.test.ts`
    `git commit -m "fix(attachments): rollback staged card-create files"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — all-or-nothing DB-row atomicity, file-write-before-transaction boundary, staged validation, and residual idempotency risk.
- `server/src/routes/card-create.ts` — current prepare/persist/hydrate transaction flow.
- `server/src/routes/cards.ts` — create route registration and workspace guard.
- `server/src/lib/attachment-upload.ts`, `server/src/lib/file-validator.ts`, `server/src/lib/attachment-storage.ts` — shared multipart/validation/storage boundaries.
- `server/src/routes/attachment-response.ts` — hydrated response shape.

## WHY THIS APPROACH

Complexity: deep
Justification: Card creation crosses multipart parsing, validation, filesystem writes, DB transactions, hydration, and realtime. Integration tests must observe the public create route and distinguish DB-row atomicity from filesystem cleanup; the existing JSON path remains a supported compatibility branch.

## SANDWICH CONTEXT

[CRITICAL: Card and attachment rows must commit together, and every file written for a failed request must be unlinked; do not promise filesystem/database two-phase commit.]
You are implementing staged-image card creation for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: one multipart request carries paired thumbnail/original bytes; the existing card transaction owns both row inserts.
Files in scope: `server/src/routes/card-create.ts`, `server/src/routes/cards.ts`, `server/src/lib/attachment-storage.ts`, `server/src/routes/card-create-attachments.integration.test.ts`.
Available after: T2 storage/upload, T3 validation, T4 response contract.
Architecture rule: keep `tracker_items` and card optimistic locking untouched; ordinary JSON card creation must still work.
[RESTATE: Card and attachment rows must commit together, and every file written for a failed request must be unlinked; do not promise filesystem/database two-phase commit.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a valid staged pair, When multipart card-create submits, Then card and attachment rows commit together and the returned card has a cover.
Given invalid staged bytes, a later pair's provider write failure, or a route-bound DB failure, When card-create submits, Then no card/attachment/activity/event commits and every file already written for the request is unlinked.
Given a network response is lost after a server commit, When the client retries, Then the documented duplicate-card residual risk remains explicit; no idempotency infrastructure is added.
Given a normal JSON create with no files, When it submits, Then existing card-create behavior remains green.

All tests PASS. Commits exist with messages matching `feat|fix(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Multipart parser accepts no more than three pairs and maps thumbnail/original by position.
- Server revalidates both payloads and performs DB inserts in the existing transaction.
- Newly written files are cleaned on validation, mid-batch provider, and DB failure; tests prove cleanup of earlier successful writes.
- Returned card hydration and normal create events remain valid.

Must-not-have:

- Two-step staging endpoint, idempotency-key infrastructure, tracker writes, or card-version changes.
- Claiming that filesystem writes participate in PostgreSQL rollback.

Open question risks:

- Lost-success-response retries can duplicate card/image; surface retryable errors without pretending to solve this v1 risk.

Rollback note:

- Keep JSON create path and hide staged-image entry point if multipart has a critical issue; schema remains additive.

## STOP CONDITIONS

Done when both integration cycles and existing create coverage pass, typecheck is green, and commits exist.
Uncertain when the multipart field contract cannot be parsed without changing the existing JSON API; report NEEDS_CONTEXT.
Escalate when atomicity requires an idempotency service, object storage, or tracker changes.
