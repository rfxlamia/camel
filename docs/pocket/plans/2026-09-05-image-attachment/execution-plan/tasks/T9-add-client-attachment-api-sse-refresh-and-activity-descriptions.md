# Task T9 — Add client attachment API, SSE refresh, and activity descriptions

**Phase:** 3
**Depends:** T4, T6, T7, T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 9: Add client attachment API, SSE refresh, and activity descriptions [depends: T4, T6, T7, T8] [test-risk]

## OBJECTIVE

Expose attachment upload/delete/create API methods, synchronize board state on attachment SSE events, extend create payload types, and render attachment activity as plain text in card and workspace activity surfaces.

Files:

- Modify: `client/src/api.ts`
- Modify: `client/src/context/BoardContext.tsx`
- Modify: `client/src/lib/taskCreateContracts.ts`
- Modify: `client/src/lib/cardPanel.ts`
- Modify: `client/src/pages/ActivityPage.tsx`
- Modify: `client/src/api.test.ts`
- Create: `client/src/context/BoardContext.attachments.test.tsx`
- Modify: `client/src/lib/cardPanel.test.ts`
- Create: `client/src/pages/ActivityPage.test.tsx`

Steps:

1. Write failing test for: API methods use workspace/card/attachment paths, multipart bodies, credentials, and do not set a manual multipart content type.
   Test file: `client/src/api.test.ts`
   Level: unit

   Test intent:
   Given prepared thumbnail/original files, When the client calls existing-card upload, delete, or multipart card-create, Then it uses the locked route paths, sends `FormData`, includes credentials/CSRF through the shared request boundary, and lets the browser set the multipart boundary header.

   Exercise through:
   - exported `api.uploadCardAttachments`, `api.deleteCardAttachment`, and extended `api.createCard` methods with mocked `fetch`.

   Test doubles:
   - mock global `fetch` and CSRF cookie reader as existing API tests do
   - do not mock the API methods under test or assert through private request helpers only.

   Expected RED:
   - no attachment API methods or create payload field exists, so imports and fetch path/body assertions fail.

2. Run test — verify FAIL:
   `npm run test -- client/src/api.test.ts`
   Expected failure: attachment API methods are undefined and FormData route assertions fail.

3. Implement minimal code to satisfy the test:
   Files: `client/src/api.ts`, `client/src/lib/taskCreateContracts.ts`
   Implement: typed attachment upload/delete methods, multipart card-create serialization when staged pairs exist while preserving JSON for no-file creates, URL helpers from `CardAttachment`, and `attachments` on `BoardCreatePayload`. Do not manually set `Content-Type` for FormData.

4. Run test — verify PASS:
   `npm run test -- client/src/api.test.ts`
   Expected: API path/FormData/credentials assertions PASS.

5. Refactor while green (bounded):
   - Reuse the existing `request()` error/CSRF behavior and keep URL construction aligned with T4.
   - Re-run API tests and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add client/src/api.ts client/src/lib/taskCreateContracts.ts client/src/api.test.ts`
   `git commit -m "feat(attachments): add client attachment API"`

7. Write failing test for: an attachment SSE event dispatches a card attachment event and refreshes board state, while unrelated tracker behavior is unchanged.
   Test file: `client/src/context/BoardContext.attachments.test.tsx`
   Level: integration (client context/event seam)

   Test intent:
   Given an active workspace and an open SSE stream, When `attachment.added` or `attachment.removed` arrives for a card, Then the BoardContext schedules/executes a board refresh and registered card-event listeners receive the attachment event so counters/gallery update without a manual reload.

   Exercise through:
   - rendered `BoardProvider` and its EventSource boundary, not a direct helper invocation.

   Test doubles:
   - fake EventSource and mocked `api.getBoard`/metrics/activity network calls
   - do not mock BoardProvider state transitions or the event dispatch registry under test.

   Expected RED:
   - current handler only dispatches `card.*` and `tracker.*`; attachment events fall through without an attachment-specific dispatch/refresh contract.

8. Run test — verify FAIL:
   `npm run test -- client/src/context/BoardContext.attachments.test.tsx`
   Expected failure: attachment event listener is not called or refreshed board state remains stale.

9. Implement minimal code to satisfy the test:
   File: `client/src/context/BoardContext.tsx`
   Implement: attachment event typing/dispatch and refresh scheduling for `attachment.added`/`attachment.removed`; expose narrowly scoped upload/delete helpers only if the panel needs them, while preserving existing card/tracker event routing.

10. Run test — verify PASS:
    `npm run test -- client/src/context/BoardContext.attachments.test.tsx`
    Expected: attachment SSE dispatch and refresh assertions PASS.

11. Refactor while green (bounded):
    - Do not add a second polling mechanism or modify tracker event paths.
    - Re-run the context test and client typecheck — both must stay PASS.

12. Commit:
    `git add client/src/context/BoardContext.tsx client/src/context/BoardContext.attachments.test.tsx`
    `git commit -m "feat(attachments): refresh board on attachment events"`

13. Write failing test for: attachment activity is rendered as plain text in card and workspace timelines.
    Test file: `client/src/lib/cardPanel.test.ts`, `client/src/pages/ActivityPage.test.tsx`
    Level: unit

    Test intent:
    Given `attachment_added` and `attachment_removed` activity events, When card/workspace description functions render them, Then they say a plain-text image-added/removed action, preserve card title/actor/timestamp context, and include no thumbnail/image markup or bytes.

    Exercise through:
    - exported `describeCardEvent` and `describeEvent` functions.

    Test doubles:
    - plain `ActivityEvent` fixtures
    - do not mock the description functions.

    Expected RED:
    - current switch statements fall through to generic `changed` text and the activity type maps do not accept attachment event literals.

14. Run test — verify FAIL:
    `npm run test -- client/src/lib/cardPanel.test.ts client/src/pages/ActivityPage.test.tsx`
    Expected failure: attachment descriptions return generic text or the new page test cannot compile the event type.

15. Implement minimal code to satisfy the test:
    Files: `client/src/lib/cardPanel.ts`, `client/src/pages/ActivityPage.tsx`
    Implement: explicit plain-text descriptions and activity badge metadata for added/removed images; keep `ContextPanel` activity feed and workspace Activity page free of inline thumbnails.

16. Run test — verify PASS:
    `npm run test -- client/src/lib/cardPanel.test.ts client/src/pages/ActivityPage.test.tsx`
    Expected: both activity-description suites PASS.

17. Refactor while green (bounded):
    - Keep copy neutral-friendly and use existing design tokens; do not add image previews to activity.
    - Re-run API, context, card-panel, activity tests and client typecheck — all must stay PASS.

18. Commit:
    `git add client/src/lib/cardPanel.ts client/src/pages/ActivityPage.tsx client/src/lib/cardPanel.test.ts client/src/pages/ActivityPage.test.tsx`
    `git commit -m "feat(attachments): describe attachment activity"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — client API route shape, SSE synchronization, plain-text activity, create payload, and no thumbnail activity feed.
- `client/src/api.ts` — shared request/CSRF/error behavior.
- `client/src/context/BoardContext.tsx` — existing SSE/refresh/registry flow.
- `client/src/lib/cardPanel.ts` and `client/src/pages/ActivityPage.tsx` — current activity description surfaces.
- `client/src/api.test.ts` and existing BoardContext tests — test doubles and Vitest/Testing Library conventions.

## WHY THIS APPROACH

Complexity: deep
Justification: This task is the client/server contract consumer: it crosses fetch/FormData, SSE/EventSource, board refresh state, and two activity renderers. Separate cycles keep network serialization, event synchronization, and copy behavior independently verifiable.

## SANDWICH CONTEXT

[CRITICAL: Attachment API calls must use authenticated workspace/card routes and attachment SSE must refresh existing board state without introducing tracker/unified mutation paths.]
You are implementing client contracts and synchronization for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: API URLs carry workspace/card/attachment ownership context; SSE remains the existing board refresh mechanism.
Files in scope: `client/src/api.ts`, `client/src/context/BoardContext.tsx`, `client/src/lib/taskCreateContracts.ts`, `client/src/lib/cardPanel.ts`, `client/src/pages/ActivityPage.tsx`, and their listed tests.
Available after: T4 response/event types, T6 existing upload, T7 delete, T8 card-create.
Architecture rule: do not call `api.updateTrackerItem`, `api.updateCard`, or any tracker mutation for attachments.
[RESTATE: Attachment API calls must use authenticated workspace/card routes and attachment SSE must refresh existing board state without introducing tracker/unified mutation paths.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a prepared image pair, When client upload/delete/create methods run, Then they use the locked paths and correct multipart/CSRF boundary.
Given an attachment SSE event, When BoardProvider receives it, Then card listeners and board refresh update the attachment count/gallery.
Given attachment activity events, When card/workspace timelines render, Then they show plain text added/removed descriptions with no inline thumbnail.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- FormData requests omit a manually set `Content-Type` header.
- SSE event handling is additive and coexists with existing card/tracker/membership routing.
- Activity text is explicit, accessible, and metadata-only.

Must-not-have:

- Direct tracker mutation calls, public upload URLs, second polling loops, or image bytes in activity state.

Open question risks:

- If `<img src>` does not carry session cookies in dev/prod, report NEEDS_CONTEXT and switch only the gallery transport to credentialed blobs.

Rollback note:

- Hide attachment UI and stop handling attachment events; existing board refresh/activity behavior remains.

## STOP CONDITIONS

Done when API, context, and activity cycles pass with client typecheck green.
Uncertain when EventSource test doubles cannot observe the current provider lifecycle; report NEEDS_CONTEXT rather than bypassing the provider.
Escalate when the implementation requires tracker mutation or public capability URLs.
