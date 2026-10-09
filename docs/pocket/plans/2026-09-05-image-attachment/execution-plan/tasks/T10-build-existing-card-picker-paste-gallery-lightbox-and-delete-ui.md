# Task T10 — Build existing-card picker, paste, gallery, lightbox, and delete UI

**Phase:** 3
**Depends:** T3, T9
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 10: Build existing-card picker, paste, gallery, lightbox, and delete UI [depends: T3, T9] [test-risk]

## OBJECTIVE

Extract a focused card-attachment UI from the oversized context panel that supports picker multi-select, clipboard paste, total counter/overflow messaging, thumbnails, lightbox/original download, and confirmed delete.

Files:

- Create: `client/src/components/CardAttachments.tsx`
- Create: `client/src/components/CardAttachments.test.tsx`
- Create: `client/src/components/CardAttachments.integration.test.tsx`
- Modify: `client/src/components/ContextPanel.tsx`
- Modify: `client/src/components/ContextPanel.test.tsx`

Steps:

1. Write failing test for: existing-card picker/paste uses the shared preparation helper, shows total `N/3`, reports partial batch acceptance, and leaves the panel in sync after SSE refresh.
   Test file: `client/src/components/CardAttachments.test.tsx`
   Level: unit/component

   Test intent:
   Given a card with one existing attachment, When the member selects four valid images or pastes a clipboard image while the panel is focused, Then the component calls the upload boundary with prepared pairs, shows `2 of 4 images added — card limit is 3 images` for partial acceptance, and displays the server-synchronized total as `3/3`.

   Exercise through:
   - rendered `CardAttachments` public props/callbacks and native file input/clipboard event boundary.

   Test doubles:
   - mock upload callback, preparation helper, and clipboard/file picker events
   - do not mock the component state or counter logic under test.

   Expected RED:
   - no extracted component or attachment controls exist in `ContextPanel`.

2. Run test — verify FAIL:
   `npm run test -- client/src/components/CardAttachments.test.tsx`
   Expected failure: component import fails because card attachment UI is not present.

3. Implement minimal code to satisfy the test:
   Files: `client/src/components/CardAttachments.tsx`, `client/src/components/ContextPanel.tsx`
   Implement: extracted attachment section with hidden multiple file input, focused-panel paste listener, T3 preparation, upload callback, exact batch result copy, persistent total counter from `card.attachments.length`, and a compact error state. Mount it in `CardEditor` without copying the existing 300+ line form logic.

4. Run test — verify PASS:
   `npm run test -- client/src/components/CardAttachments.test.tsx`
   Expected: picker/paste/partial-result/counter assertions PASS.

5. Refactor while green (bounded):
   - Keep attachment UI in the new component; `ContextPanel.tsx` should only compose it and pass card/workspace/callback props.
   - Use OKLCH/Work Sans-derived existing Tailwind tokens and accessible focus rings from the creative brief.
   - Re-run component test and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add client/src/components/CardAttachments.tsx client/src/components/ContextPanel.tsx client/src/components/CardAttachments.test.tsx`
   `git commit -m "feat(attachments): add card attachment picker"`

7. Write failing test for: gallery/lightbox/download and confirmed delete behavior.
   Test file: `client/src/components/CardAttachments.test.tsx`, `client/src/components/ContextPanel.test.tsx`
   Level: unit/component

   Test intent:
   Given a card with two attachments, When a thumbnail is clicked, Then a lightbox shows the full original and an explicit `/original/download` action; when delete is clicked and confirmed, Then delete callback runs; when cancelled, Then nothing changes; when the last attachment is removed from props, Then gallery/control shows no-media state.

   Exercise through:
   - rendered gallery buttons, lightbox dialog, download link, and confirmation dialog.

   Test doubles:
   - mock delete callback and card props; use accessible dialog/button queries
   - do not mock lightbox state or confirmation handling.

   Expected RED:
   - current context panel has no gallery/lightbox/delete UI or attachment composition seam.

8. Run test — verify FAIL:
   `npm run test -- client/src/components/CardAttachments.test.tsx client/src/components/ContextPanel.test.tsx`
   Expected failure: thumbnail/lightbox/delete/no-media assertions fail because the UI is absent.

9. Implement minimal code to satisfy the test:
   File: `client/src/components/CardAttachments.tsx`
   Implement: ordered thumbnail gallery, overflow-independent full-size lightbox with explicit download route, accessible confirmation dialog, cancel no-op, optimistic/loading/error states, and empty/no-media rendering when `card.attachments` becomes empty.

10. Run test — verify PASS:
    `npm run test -- client/src/components/CardAttachments.test.tsx client/src/components/ContextPanel.test.tsx`
    Expected: gallery/lightbox/download/delete/cancel/no-media assertions PASS.

11. Refactor while green (bounded):
    - Verify keyboard focus/escape behavior and `prefers-reduced-motion` classes follow existing component conventions.
    - Re-run both component suites and client typecheck — must stay PASS.

12. Commit:
    `git add client/src/components/CardAttachments.tsx client/src/components/ContextPanel.tsx client/src/components/CardAttachments.test.tsx client/src/components/ContextPanel.test.tsx`
    `git commit -m "feat(attachments): add attachment gallery and lightbox"`

13. Write failing test for: an attachment SSE payload reaches the mounted BoardProvider and CardAttachments surface so a second viewer's counter/gallery updates.
    Test file: `client/src/components/CardAttachments.integration.test.tsx`
    Level: integration (EventSource → BoardProvider → UI seam)

    Test intent:
    Given a mounted `BoardProvider` and `CardAttachments` consumer initialized with one image, When the exact `attachment.added` payload emitted by T6 is delivered through the EventSource adapter and the refresh response contains three images, Then the UI updates to `3/3` and renders the refreshed cover/badge without manually calling the component callback.

    Exercise through:
    - the provider's EventSource boundary, board refresh response, and rendered `CardAttachments` component.

    Test doubles:
    - fake EventSource and HTTP response at external browser boundaries
    - do not mock BoardProvider state transitions, CardAttachments rendering, or the attachment event dispatch.

    Expected RED:
    - current client flow has no attachment event-to-gallery integration, so the rendered counter remains stale after the event.

14. Run test — verify FAIL:
    `npm run test -- client/src/components/CardAttachments.integration.test.tsx`
    Expected failure: the mounted UI does not update from the attachment SSE payload.

15. Implement minimal code to satisfy the test:
    Files: `client/src/components/CardAttachments.tsx`, `client/src/components/CardAttachments.integration.test.tsx`
    Implement: only the component/test wiring needed for the T9 attachment event payload to refresh and render the new card state; preserve the external EventSource double as the network boundary.

16. Run test — verify PASS:
    `npm run test -- client/src/components/CardAttachments.integration.test.tsx`
    Expected: attachment SSE payload updates the mounted counter/gallery.

17. Refactor while green (bounded):
    - Re-run both CardAttachments suites, ContextPanel tests, and `npm run typecheck` — all must stay PASS.

18. Commit:
    `git add client/src/components/CardAttachments.tsx client/src/components/CardAttachments.integration.test.tsx`
    `git commit -m "test(attachments): verify gallery refresh from SSE"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — picker/paste scope, counter semantics, gallery/lightbox/download/delete behavior, and no drag-and-drop.
- `client/src/components/ContextPanel.tsx` — existing `CardEditor` composition and 300+ line extraction pressure.
- `client/src/types.ts` and `client/src/lib/imageAttachments.ts` — card attachment and preparation contracts.
- `client/src/context/BoardContext.tsx` and `client/src/api.ts` — upload/delete callbacks and SSE refresh.
- `docs/pocket/rule/creative-brief.md` — OKLCH tokens, Work Sans, accessible focus, calm copy.

## WHY THIS APPROACH

Complexity: deep
Justification: The panel is already over 300 lines and owns unrelated card-edit state. A domain component keeps picker/paste/gallery/lightbox state together and makes the component-level test boundary explicit.

## SANDWICH CONTEXT

[CRITICAL: Existing-card overflow is partial acceptance, but the persistent counter always reflects total server state; deleting the last image must return to no-media state.]
You are implementing the existing-card attachment surface for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: button/native picker and clipboard paste feed one prepared upload path; gallery uses authenticated response URLs.
Files in scope: `client/src/components/CardAttachments.tsx`, `client/src/components/CardAttachments.test.tsx`, `client/src/components/CardAttachments.integration.test.tsx`, `client/src/components/ContextPanel.tsx`, `client/src/components/ContextPanel.test.tsx`.
Available after: T3 client preparation and T9 API/context synchronization.
Architecture rule: no drag-and-drop, no tracker surface, no direct card-update mutation, and use existing design tokens.
[RESTATE: Existing-card overflow is partial acceptance, but the persistent counter always reflects total server state; deleting the last image must return to no-media state.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given one existing image and four selected images, When upload returns two accepted, Then the component says `2 of 4 images added — card limit is 3 images` and displays total `3/3`.
Given a clipboard image with no filename, When paste occurs while the panel is focused, Then it enters the same preparation/upload path.
Given two attachments, When a thumbnail is clicked, Then a lightbox shows the original and a distinct download action.
Given a delete confirmation, When cancelled, Then no delete callback runs; when confirmed, Then it runs and the last-image state becomes plain no-media after refresh.

All tests PASS. Commit messages match `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Native picker allows multiple files; clipboard paste accepts image blobs.
- Counter and overflow copy distinguish total card state from batch result.
- Gallery/lightbox/download/delete are keyboard-accessible and have explicit labels.
- UI uses existing tokens and no inline activity thumbnails.

Must-not-have:

- Drag-and-drop, manual cover selection/reordering, image annotation, or direct tracker/card mutation calls.

Open question risks:

- If `<img>` requests omit session cookies, report NEEDS_CONTEXT and use credentialed blob URLs as a focused transport adjustment.

Rollback note:

- Remove the `CardAttachments` composition from `ContextPanel` and hide the upload control; existing card editing remains.

## STOP CONDITIONS

Done when both component cycles and typecheck are green.
Uncertain when browser image delivery cannot authenticate; report NEEDS_CONTEXT before weakening route auth.
Escalate when UI scope expands to drag-and-drop or image editing.
