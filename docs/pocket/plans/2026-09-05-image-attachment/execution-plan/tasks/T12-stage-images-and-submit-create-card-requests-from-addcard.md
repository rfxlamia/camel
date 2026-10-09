# Task T12 — Stage images and submit create-card requests from AddCard

**Phase:** 3
**Depends:** T9, T11, T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 12: Stage images and submit create-card requests from AddCard [depends: T9, T11, T8] [test-risk]

## OBJECTIVE

Wire staged `@image` files into AddCard with a hard three-file cap, previews/errors, loading replacement, multipart submission, and retryable validation/network behavior that keeps the form editable.

Files:

- Modify: `client/src/components/AddCard.tsx`
- Modify: `client/src/components/AddCard.test.tsx`

Steps:

1. Write failing test for: AddCard stages at most three images and refuses the fourth immediately.
   Test file: `client/src/components/AddCard.test.tsx`
   Level: unit/component

   Test intent:
   Given an open new-card form, When the user selects three valid image files through `@image` and then selects a fourth, Then three staged chips remain, the fourth is not submitted/staged, and the UI says `Max 3 images per card`; no server request occurs for the fourth selection.

   Exercise through:
   - rendered AddCard and TaskTitleEditor file-command boundary.

   Test doubles:
   - synthetic `File` objects, preparation helper result, and `onAddCard` spy
   - do not mock AddCard staging state or cap logic.

   Expected RED:
   - AddCard currently has no staged-image state or file-command integration, so the fourth-selection behavior does not exist.

2. Run test — verify FAIL:
   `npm run test -- client/src/components/AddCard.test.tsx`
   Expected failure: staged chips/cap message are absent and file selection is ignored.

3. Implement minimal code to satisfy the test:
   File: `client/src/components/AddCard.tsx`
   Implement: local staged image state using T3 prepared pairs, `TaskTitleEditor` file command wiring from T11, hard cap at three, per-chip validation/error display, remove/retry controls, and `BoardCreatePayload.attachments` preparation.

4. Run test — verify PASS:
   `npm run test -- client/src/components/AddCard.test.tsx`
   Expected: three-file staging and immediate fourth refusal PASS.

5. Refactor while green (bounded):
   - Keep metadata draft reducer unchanged; staged files are not tracker metadata.
   - Re-run AddCard tests and client typecheck — both must stay PASS.

6. Commit:
   `git add client/src/components/AddCard.tsx client/src/components/AddCard.test.tsx`
   `git commit -m "feat(attachments): stage images in card creation"`

7. Write failing test for: invalid staged image remains visible as an error chip and blocks card creation without losing the editable title.
   Test file: `client/src/components/AddCard.test.tsx`
   Level: unit/component

   Test intent:
   Given a 15MB image selected through `@image`, When T3 preparation returns a tagged invalid result and the user submits, Then the invalid file remains represented by its chip/error, `onAddCard` is not called, the title/draft stays editable, and the UI surfaces the specified validation message.

   Exercise through:
   - AddCard's file-command callback, submit handler, staged-chip rendering, and public `onAddCard` boundary.

   Test doubles:
   - synthetic invalid `File`, deterministic T3 invalid-result fixture, and `onAddCard` spy
   - do not mock AddCard staged state or submission guard.

   Expected RED:
   - current AddCard discards no-file/invalid preparation results and has no invalid staged-chip state or submit guard.

8. Run test — verify FAIL:
   `npm run test -- client/src/components/AddCard.test.tsx`
   Expected failure: invalid chip/title retention and no-request assertions fail.

9. Implement minimal code to satisfy the test:
   File: `client/src/components/AddCard.tsx`
   Implement: preserve T3 tagged invalid results in staged state, render the error chip, prevent `onAddCard` while any invalid entry exists, and keep title/metadata editable for removal or retry.

10. Run test — verify PASS:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected: invalid staged image remains visible, submission is blocked, and title is retained.

11. Refactor while green (bounded):
    - Keep invalid staged files out of `BoardCreatePayload.attachments`; only valid prepared pairs may serialize.
    - Re-run the focused AddCard suite and `npm run typecheck` — both must stay PASS.

12. Commit:
    `git add client/src/components/AddCard.tsx client/src/components/AddCard.test.tsx`
    `git commit -m "fix(attachments): preserve staged image validation errors"`

13. Write failing test for: a valid staged image shows a loading state and resets only after successful atomic create.
    Test file: `client/src/components/AddCard.test.tsx`
    Level: unit/component

    Test intent:
    Given a title and one valid staged pair, When `Add to board` is submitted, Then the form controls are replaced/disabled while the multipart callback is pending; when it resolves successfully, staged state resets and the form closes.

    Exercise through:
    - AddCard's public `onAddCard` callback and rendered loading/success boundary.

    Test doubles:
    - deferred successful `onAddCard` promise
    - do not mock submitting state or success cleanup.

    Expected RED:
    - current AddCard has no staged image submission/loading lifecycle.

14. Run test — verify FAIL:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected failure: loading replacement and success reset/close assertions fail.

15. Implement minimal code to satisfy the test:
    File: `client/src/components/AddCard.tsx`
    Implement: pending state around multipart create, loading indicator replacing the form, and clearing staged state/closing only after successful `onAddCard`.

16. Run test — verify PASS:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected: valid submit loading and success reset assertions PASS.

17. Refactor while green (bounded):
    - Re-run the focused AddCard suite, `npm run typecheck`, and the existing `TaskTitleEditor` suite — all must stay PASS.
    - Keep copy neutral-friendly and use existing primary/secondary/error tokens.

18. Commit:
    `git add client/src/components/AddCard.tsx client/src/components/AddCard.test.tsx`
    `git commit -m "feat(attachments): submit staged images atomically"`

19. Write failing test for: network failure preserves staged valid files and offers a retry without silently clearing the title.
    Test file: `client/src/components/AddCard.test.tsx`
    Level: unit/component

    Test intent:
    Given a valid staged image and a rejected `onAddCard` promise, When submission fails, Then the form returns to editable state, the chip shows a retryable error, the title remains, and a retry invokes the callback again.

    Exercise through:
    - AddCard submit/error/retry controls and public callback.

    Test doubles:
    - rejected then resolved deferred callback
    - do not mock error mapping or retry state.

    Expected RED:
    - current AddCard has no staged network-error recovery or retry path.

20. Run test — verify FAIL:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected failure: retry/error/title-retention assertions fail.

21. Implement minimal code to satisfy the test:
    File: `client/src/components/AddCard.tsx`
    Implement: map `ApiError`/network failures to staged chip errors, restore editable state, and allow retry without resetting title or metadata.

22. Run test — verify PASS:
    `npm run test -- client/src/components/AddCard.test.tsx`
    Expected: network retry and draft-retention assertions PASS.

23. Refactor while green (bounded):
    - Re-run the focused AddCard suite and client typecheck — must stay PASS.

24. Commit:
    `git add client/src/components/AddCard.tsx client/src/components/AddCard.test.tsx`
    `git commit -m "fix(attachments): make staged upload retryable"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — three-file stage cap, all-or-nothing create UX, loading state, invalid/network retry behavior.
- `client/src/components/AddCard.tsx` — existing draft/submission flow and field-error handling.
- `client/src/components/task-entry/TaskTitleEditor.tsx` — T11 file command callback.
- `client/src/lib/imageAttachments.ts` — T3 prepared pair/cap/validation helper.
- `client/src/api.ts` and `client/src/lib/taskCreateContracts.ts` — T9 multipart create contract.
- `client/src/components/AddCard.test.tsx` — existing form test harness.

## WHY THIS APPROACH

Complexity: deep
Justification: AddCard coordinates command selection, client preprocessing, staged state, multipart network behavior, loading, and retry. Separate RED cycles prove stage-time policy and submit-time state recovery without testing server internals in a component test.

## SANDWICH CONTEXT

[CRITICAL: Create-card staging must refuse a fourth file before submission and must never partially arbitrate overflow on the server.]
You are implementing staged image creation UX for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: `@image` stages client-side, then one multipart card-create request owns DB-row atomicity.
Files in scope: `client/src/components/AddCard.tsx`, `client/src/components/AddCard.test.tsx`.
Available after: T8 server multipart create, T9 client API contract, T11 file command.
Architecture rule: keep staged files separate from `taskMetadataDraft`; no direct tracker mutation and no second staging upload request.
[RESTATE: Create-card staging must refuse a fourth file before submission and must never partially arbitrate overflow on the server.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given three staged images, When a fourth is selected, Then it is refused immediately with `Max 3 images per card`.
Given a staged valid image, When Add to board submits, Then loading replaces the form until the multipart request resolves and success clears/closes the form.
Given invalid staged data or a network drop, When submit fails, Then no blank silent state occurs; chips/title remain editable and retry is possible.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Stage-time cap is hard and visible.
- Loading covers the full submit window and prevents duplicate submission.
- Error state preserves the draft and maps validation/network failures to actionable UI.
- Success resets staged state only after the server response succeeds.

Must-not-have:

- Partial server arbitration for create-card overflow, second staging endpoint, idempotency key, or tracker metadata mutation.

Open question risks:

- Lost response after server commit can duplicate a card on retry; document/surface this as the accepted v1 residual risk.

Rollback note:

- Hide `@image` while retaining normal AddCard title/metadata creation.

## STOP CONDITIONS

Done when all four component cycles, AddCard/TaskTitleEditor suites, and client typecheck pass.
Uncertain when `ApiError` cannot preserve field/chip errors for multipart responses; report NEEDS_CONTEXT.
Escalate when create-card requires changing tracker metadata or adding idempotency infrastructure.
