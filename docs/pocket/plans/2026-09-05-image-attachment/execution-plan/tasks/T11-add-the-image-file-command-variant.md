# Task T11 — Add the `@image` file-command variant

**Phase:** 2
**Depends:** T3
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 11: Add the `@image` file-command variant [depends: T3] [test-risk]

## OBJECTIVE

Extend the existing command palette with a distinct file-trigger definition for `@image` that opens a native multi-file picker and reports selected files to its owner without pretending files are metadata options.

Files:

- Modify: `client/src/components/task-entry/TaskTitleEditor.tsx`
- Modify: `client/src/components/task-entry/TaskTitleEditor.test.tsx`

Steps:

1. Write failing test for: selecting the `@image` command invokes a file-command callback instead of dispatching a metadata action.
   Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   Level: unit/component

   Test intent:
   Given a `TaskTitleEditor` with a file command definition, When the user types `@image`, chooses the command, and selects files in the native input, Then the callback receives the file list, the input exposes `multiple` plus `accept="image/png,image/jpeg"`, the title remains the plain task title, no metadata reducer action is dispatched, and the existing field-command options remain unchanged.

   Exercise through:
   - rendered combobox/popover and hidden file input event boundary.

   Test doubles:
   - synthetic `File` objects, metadata dispatch spy, and native input change event
   - do not mock TaskTitleEditor command state or the file-command callback under test.

   Expected RED:
   - current `TaskTitleEditor` accepts only `TaskFieldCommandDefinition` options-list commands and has no file-trigger variant/input.

2. Run test — verify FAIL:
   `npm run test -- client/src/components/task-entry/TaskTitleEditor.test.tsx`
   Expected failure: file-command fixture cannot compile/render or selection dispatches no callback.

3. Implement minimal code to satisfy the test:
   File: `client/src/components/task-entry/TaskTitleEditor.tsx`
   Implement: exported `TaskFileCommandDefinition` discriminated from `TaskFieldCommandDefinition`, optional file-command input props, field-stage rendering for `@image`, native `accept="image/png,image/jpeg"`/multiple input, callback invocation, title cleanup, and command-state reset. Preserve existing metadata command behavior and keyboard/pointer semantics.

4. Run test — verify PASS:
   `npm run test -- client/src/components/task-entry/TaskTitleEditor.test.tsx`
   Expected: file trigger invokes callback without metadata mutation; existing command tests remain PASS.

5. Refactor while green (bounded):
   - Keep the file command additive; do not rewrite `TaskFieldCommandPopover` into a generic upload manager.
   - Re-run the focused suite and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add client/src/components/task-entry/TaskTitleEditor.tsx client/src/components/task-entry/TaskTitleEditor.test.tsx`
   `git commit -m "feat(attachments): add image file command"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — additive `@image` command requirement and hard stage cap owned by create-card UI.
- `client/src/components/task-entry/TaskTitleEditor.tsx` — existing two-stage metadata command state and imperative submit handle.
- `client/src/components/task-entry/TaskFieldCommandPopover.tsx` — existing keyboard/pointer field-stage rendering.
- `client/src/components/task-entry/TaskTitleEditor.test.tsx` — command palette interaction tests.

## WHY THIS APPROACH

Complexity: standard
Justification: The file trigger is a distinct interaction from catalog-backed metadata selection. A single RED cycle proves the public command boundary while preserving existing field commands and keeping staging policy in AddCard.

## SANDWICH CONTEXT

[CRITICAL: `@image` must be additive and must not dispatch tracker/metadata actions or replace existing field-command behavior.]
You are implementing the `@image` file-command variant for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: native file picker triggers a callback; AddCard owns staged files and submission.
Files in scope: `client/src/components/task-entry/TaskTitleEditor.tsx`, `client/src/components/task-entry/TaskTitleEditor.test.tsx`.
Available after: T3 client image preparation.
Architecture rule: use client-side image validation/preparation and preserve no-extension client imports.
[RESTATE: `@image` must be additive and must not dispatch tracker/metadata actions or replace existing field-command behavior.]

## DELIVERABLE

Verification — task is DONE when:

Given a create-card editor with `@image`, When a user chooses it and selects PNG/JPEG files, Then owner callback receives the files and the plain title remains clean.
Given existing metadata commands, When they are used, Then their reducer actions/chips/keyboard interactions remain unchanged.

All tests PASS. Commit exists with message matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Distinct file-command type/branch is visible in the public editor props.
- Native file input supports multi-select and accepted PNG/JPEG MIME.
- Existing command tests stay green.

Must-not-have:

- File bytes in metadata draft, tracker mutation, drag-and-drop, or a generic command-palette rewrite.

Open question risks:

- Browser picker cancellation must leave command/title state unchanged; if the browser does not emit a reliable empty selection, report DONE_WITH_CONCERNS with evidence.

Rollback note:

- Remove only the `@image` command definition/prop; metadata commands remain.

## STOP CONDITIONS

Done when focused command tests and client typecheck pass.
Uncertain when the existing popover cannot represent a file row without changing field semantics; report NEEDS_CONTEXT.
Escalate when implementing the file command requires changing tracker metadata contracts.
