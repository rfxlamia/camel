# Task T4 — Composite task title editor and command popover

**Phase:** 2
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 4: Composite task title editor and command popover [depends: T2]

## OBJECTIVE

Build the shared native-textarea editor and two-stage field/value popover with exact trigger, keyboard, accessibility, chip, focus, title, and IME behavior.

Files:

- Create: `client/src/components/task-entry/TaskTitleEditor.tsx`
- Create: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`
- Test: `client/src/components/task-entry/TaskTitleEditor.test.tsx`

Steps:

#### RED Cycle T4-C01 — GWT Scenario: Open the field menu

1. **Write the failing test.**
   - Scenario: `Open the field menu`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the Board title is "Fix login "; When the user types "@"; Then the field popover opens with the first available option represented as active.
   - Exercise through: the rendered native textarea and accessible field listbox.
   - Test doubles: fixed field definitions; keep the real TaskTitleEditor, TaskFieldCommandPopover, and reducer wrapper.
   - Expected RED: `TaskTitleEditor` and `TaskFieldCommandPopover` do not exist, so the component test fails to import the editor before it can query an active first field option.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Open the field menu\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskTitleEditor.tsx`, `client/src/components/task-entry/TaskFieldCommandPopover.tsx`. Create the native-textarea composite editor and the real field-command popover, wire terminal `@` to the first available field option, and keep the initial implementation limited to this valid trigger path.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Open the field menu\""`. Expected: PASS.

#### RED Cycle T4-C02 — GWT Scenario: Do not trigger inside an email-like word

1. **Write the failing test.**
   - Scenario: `Do not trigger inside an email-like word`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the title is "Notify <foo@bar.com>"; When the user continues typing; Then the field popover stays closed.
   - Exercise through: the rendered native textarea.
   - Test doubles: fixed field definitions; keep command-state handling real.
   - Expected RED: After T4-C01, the initial terminal-`@` detector has no word-boundary/email exclusion, so typing `foo@bar.com` opens the command popover and the closed-popover assertion fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not trigger inside an email-like word\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not trigger inside an email-like word\""`. Expected: PASS.

#### RED Cycle T4-C03 — GWT Scenario: Abandon a partial command

1. **Write the failing test.**
   - Scenario: `Abandon a partial command`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the editor contains "Fix login @pri"; When the user presses Escape and then repeats through click-away; Then the popover closes and "@pri" remains literal title text in both cases.
   - Exercise through: the rendered editor and document pointer boundary.
   - Test doubles: fixed field definitions; keep editor and popover real.
   - Expected RED: After T4-C02, the command state has no Escape/click-away abandonment transition that restores partial `@pri` as literal text, so the title-preservation assertion fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Abandon a partial command\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Abandon a partial command\""`. Expected: PASS.

#### RED Cycle T4-C04 — GWT Scenario: Ignore IME composition keystrokes

1. **Write the failing test.**
   - Scenario: `Ignore IME composition keystrokes`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given text composition is active; When "@" and Enter occur before compositionend; Then no command opens and no value selection fires.
   - Exercise through: composition events on the rendered native textarea.
   - Test doubles: fixed field definitions; keep composition guards real.
   - Expected RED: After T4-C03, key handling does not inspect `isComposing` or composition state, so an `@` or Enter generated before `compositionend` triggers command behavior.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Ignore IME composition keystrokes\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Ignore IME composition keystrokes\""`. Expected: PASS.

#### RED Cycle T4-C05 — GWT Scenario: Select an assignee with the keyboard

1. **Write the failing test.**
   - Scenario: `Select an assignee with the keyboard`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the field menu is open for "Fix login" with member Rafi available; When the user chooses Assignee, searches "raf", navigates with Arrow keys, and presses Enter; Then an Assignee Rafi chip appears while the persisted title candidate stays "Fix login".
   - Exercise through: the rendered textarea, combobox, listbox, and real reducer wrapper.
   - Test doubles: fixed external catalog data; keep editor, popover, and reducer real.
   - Expected RED: The popover created by T4-C01 lists fields only and has no searchable value stage or reducer dispatch, so filtering Assignee values to Rafi and creating the chip fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select an assignee with the keyboard\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`, `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the value-stage behavior required by this cycle to the real popover and connect it through the editor without duplicating reducer state.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select an assignee with the keyboard\""`. Expected: PASS.

#### RED Cycle T4-C06 — GWT Scenario: Do not create a missing option

1. **Write the failing test.**
   - Scenario: `Do not create a missing option`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the active value search has no results; When the user presses Enter; Then nothing is selected or created and cancellation remains available.
   - Exercise through: the rendered value listbox and keyboard event path.
   - Test doubles: an empty external catalog; keep editor and popover real.
   - Expected RED: After T4-C05 adds searchable values, Enter still assumes an active option; an empty filtered list is not consumed as a no-op, so the selection/creation assertion fails.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not create a missing option\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`, `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the value-stage behavior required by this cycle to the real popover and connect it through the editor without duplicating reducer state.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Do not create a missing option\""`. Expected: PASS.

#### RED Cycle T4-C07 — GWT Scenario: Consume Enter while the picker is unavailable

1. **Write the failing test.**
   - Scenario: `Consume Enter while the picker is unavailable`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the active picker is separately rendered as loading, failed, disabled, and empty; When the user presses Enter in each state; Then the keystroke is consumed without selecting a value or submitting the host form.
   - Exercise through: the rendered editor inside a submit-observing form.
   - Test doubles: external catalog states and a submit spy; keep editor, popover, and reducer real.
   - Expected RED: After T4-C06 handles empty results, loading, failed, and disabled option states do not yet consume Enter, allowing the host form submit handler to run.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Consume Enter while the picker is unavailable\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`, `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the value-stage behavior required by this cycle to the real popover and connect it through the editor without duplicating reducer state.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Consume Enter while the picker is unavailable\""`. Expected: PASS.

#### RED Cycle T4-C08 — GWT Scenario: Edit a chip by clicking it

1. **Write the failing test.**
   - Scenario: `Edit a chip by clicking it`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the real reducer wrapper contains Priority High; When the user clicks its chip; Then the Priority value picker opens with High selected.
   - Exercise through: the rendered chip button and value listbox.
   - Test doubles: fixed catalog data; keep editor, popover, and reducer real.
   - Expected RED: Selected values render after T4-C05, but chips have no edit action that reopens the matching value picker with the current value selected.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Edit a chip by clicking it\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Edit a chip by clicking it\""`. Expected: PASS.

#### RED Cycle T4-C09 — GWT Scenario: Remove a chip by pointer or keyboard

1. **Write the failing test.**
   - Scenario: `Remove a chip by pointer or keyboard`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given a metadata chip follows a plain title; When the user removes it through its control and then repeats using two-stage Backspace; Then the chip and reducer value disappear while the plain title is unchanged.
   - Exercise through: the rendered remove control, textarea boundary, and real reducer wrapper.
   - Test doubles: fixed catalog data; keep editor, popover, reducer, and key handling real.
   - Expected RED: After T4-C08 adds chip activation, the editor has no remove control plus two-stage boundary Backspace state, so chip selection/removal assertions fail.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Remove a chip by pointer or keyboard\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Remove a chip by pointer or keyboard\""`. Expected: PASS.

#### RED Cycle T4-C11 — GWT Scenario: Select multiple assignees

1. **Write the failing test.**
   - Scenario: `Select multiple assignees`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the Assignee value picker is open with Rafi and Maya available; When the user selects Rafi and then Maya; Then both reducer values are selected and the picker remains open until Done, then remains open in a repeated run until Escape.
   - Exercise through: the rendered multi-value listbox and real reducer wrapper.
   - Test doubles: fixed member catalog data; keep editor, popover, and reducer real.
   - Expected RED: The value stage added by T4-C05 closes after every Enter and has no multi-select stay-open/Done behavior, so selecting Rafi then Maya cannot retain both values before Escape or Done.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select multiple assignees\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskFieldCommandPopover.tsx`, `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the value-stage behavior required by this cycle to the real popover and connect it through the editor without duplicating reducer state.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Select multiple assignees\""`. Expected: PASS.

#### RED Cycle T4-C10 — GWT Scenario: Restore title focus after a picker closes

1. **Write the failing test.**
   - Scenario: `Restore title focus after a picker closes`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given a field picker and then a value picker are opened from a known caret; When each closes through Enter, Escape, Done, and click-away in separate assertions; Then focus and caret return to the native title textarea while the create surface stays mounted.
   - Exercise through: the rendered editor focus lifecycle.
   - Test doubles: fixed catalog data; keep focus management and command components real.
   - Expected RED: Popover close paths through selection, Escape, Done, and click-away do not yet restore the textarea ref and caret, so focus remains outside the title editor.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Restore title focus after a picker closes\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Restore title focus after a picker closes\""`. Expected: PASS.

#### RED Cycle T4-C12 — GWT Scenario: Reject a chips-only draft

1. **Write the failing test.**
   - Scenario: `Reject a chips-only draft`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the editor has chips and whitespace-only title text; When the host form requests a submit candidate; Then no create callback fires and title-required state appears.
   - Exercise through: the rendered native editor inside a submit-observing form.
   - Test doubles: fixed catalog data and submit spy; keep title extraction, editor, and reducer real.
   - Expected RED: The editor exposes chips and text after T4-C11 but has no plain-title validity result for the host, so a chips-only or whitespace-only draft is reported as submittable.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Reject a chips-only draft\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Reject a chips-only draft\""`. Expected: PASS.

#### RED Cycle T4-C13 — GWT Scenario: Exclude chips from title length validation

1. **Write the failing test.**
   - Scenario: `Exclude chips from title length validation`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given plain title text is exactly the endpoint limit and metadata chips are present; When the host form requests a submit candidate; Then validation counts only plain title text and returns no chip markup.
   - Exercise through: the rendered native editor validation callback.
   - Test doubles: fixed endpoint limit and catalog data; keep extraction logic and reducer real.
   - Expected RED: After T4-C12 adds title validity, the submit candidate has no endpoint-limit calculation isolated from chip labels, so the exact-max plain title plus chips is rejected or counted incorrectly.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Exclude chips from title length validation\""`. Expected: FAIL for the assertion described above.
3. **Implement the minimum behavior.** File: `client/src/components/task-entry/TaskTitleEditor.tsx`. Add only the production behavior required by this cycle while retaining every previously green cycle.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"Exclude chips from title length validation\""`. Expected: PASS.

#### RED Cycle T4-S01 — Support: exposes combobox semantics and announces chip changes

1. **Write the failing test.**
   - Scenario: `exposes combobox semantics and announces chip changes`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given the editor, field stage, value stage, and chip list are rendered; When keyboard focus, active options, chip add/remove, and invalid-chip state change; Then combobox/listbox roles, aria-expanded, aria-controls, aria-activedescendant, option selection state, and a polite live region expose the same state without moving DOM focus away from the textarea.
   - Exercise through: the real TaskTitleEditor and TaskFieldCommandPopover rendered with the real reducer wrapper.
   - Test doubles: fixed catalog data only; keep editor, popover, reducer, focus management, and ARIA output real.
   - Expected RED: The interaction cycles T4-C01 through T4-C13 add visible behavior but do not yet define aria-activedescendant wiring or a live region for chip add/remove/invalid announcements, so the accessibility queries and announcement assertions fail.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"exposes combobox semantics and announces chip changes\""`. Expected: FAIL for the missing ARIA relationships and announcements.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskTitleEditor.tsx`, `client/src/components/task-entry/TaskFieldCommandPopover.tsx`. Add the semantic relationships and polite announcements without changing keyboard focus ownership or adding animation.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"exposes combobox semantics and announces chip changes\""`. Expected: PASS.

#### RED Cycle T4-S02 — Support: preserves Tab navigation around the command editor

1. **Write the failing test.**
   - Scenario: `preserves Tab and Shift+Tab navigation around the command editor`
   - Test file: `client/src/components/task-entry/TaskTitleEditor.test.tsx`
   - Level: component integration.
   - Test intent: Given textarea focus owns an open field/value popover; When Tab is pressed; Then the popover closes without selecting, draft text/chips remain, and focus advances in DOM order from textarea to each rendered chip action and then the next form control (or directly to the next control when no chips exist). When Shift+Tab is pressed from the textarea; Then the popover closes without selecting and focus moves to the preceding form control. No path restores focus back to the textarea after the browser has moved it with Tab.
   - Exercise through: the real TaskTitleEditor and TaskFieldCommandPopover inside a form harness.
   - Test doubles: fixed catalog values only; keep browser focus order, editor, chips, popover, and reducer real.
   - Expected RED: Existing T4 interactions define Arrow/Enter/Escape and focus restoration but no Tab/Shift+Tab contract, so focus skips the intended chip/form destination or closes command state while the assertion expects preserved draft and surface.
2. **Run RED:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"preserves Tab and Shift\+Tab navigation around the command editor\""`. Expected: FAIL on focus order or preserved-state assertions.
3. **Implement the minimum behavior.** Files: `client/src/components/task-entry/TaskTitleEditor.tsx`, `client/src/components/task-entry/TaskFieldCommandPopover.tsx`. Keep DOM focus on the textarea while listbox options use aria-activedescendant; on Tab/Shift+Tab close the popover without selection or preventDefault, preserving draft and allowing native DOM order: textarea → chip actions in render order → next form control, with reverse order for Shift+Tab.
4. **Run PASS:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx -t "\"preserves Tab and Shift\+Tab navigation around the command editor\""`. Expected: PASS.

#### Task-wide refactor and commit

1. **Refactor while green.** Restrict changes to the listed modifiable files. Extract a named domain helper only when logic appears at least three times inside this scope. Split a modified function above roughly 50 lines or a modified file crossing roughly 300 lines using only files declared in the File Structure Map.
2. **Run the packet suite:** `npm run test --workspace=client -- src/components/task-entry/TaskTitleEditor.test.tsx`. Expected: PASS.
3. **Commit:** `git add client/src/components/task-entry/TaskTitleEditor.tsx client/src/components/task-entry/TaskFieldCommandPopover.tsx client/src/components/task-entry/TaskTitleEditor.test.tsx` then `git commit -m "feat(task-entry): add task field command editor"`.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md` — approved behavior, architecture constraints, assumptions, and rollback boundaries.
- The files listed in OBJECTIVE — existing public seams and test conventions to preserve.
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — separate Board and Tracker persistence and activity ownership.
- `docs/pocket/rule/creative-brief.md` — required focus, motion, and visual constraints for client tasks.

## WHY THIS APPROACH

Complexity: deep. The boundary is independently runnable after T2 and keeps one bounded deliverable without moving behavior into another task.

## SANDWICH CONTEXT

[CRITICAL: Keep the title source as a native textarea and chips as sibling end elements; keep TaskTitleEditor, TaskFieldCommandPopover, and the reducer real in component tests.]
You are implementing Composite task title editor and command popover for Task Field Tags for Create Flows.
Spec: `docs/pocket/spec/2026-09-02-task-field-tags/task-field-tags.md`.
Design decision: Option A2, shared native-textarea composite editor with transaction-scoped atomic create backends.
Files in scope: exactly the files listed in OBJECTIVE; read/import-only files must not be modified.
Test framework: Vitest 4 from repository root; client component integration uses React Testing Library; server integration uses Supertest and a real migrated PostgreSQL test database.
Available after: T2.
Architecture rule: preserve dual-table routing and source-specific activity; use no new dependency and no migration.
[RESTATE: Keep the title source as a native textarea and chips as sibling end elements; keep TaskTitleEditor, TaskFieldCommandPopover, and the reducer real in component tests.]

## DELIVERABLE

- Every owning GWT verification and supplementary cycle in OBJECTIVE passes through its declared public boundary with its documented RED or Regression mode.
- Production behavior is the minimum required by those cycles and remains within the listed files.
- The packet suite passes and commit `feat(task-entry): add task field command editor` exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Every RED cycle runs before its implementation and reruns the identical command for PASS; every Regression Verification records its stated baseline/prerequisite result and reruns the same command after production changes.
- Client component tests keep the reducer, editor, popover, provider, context, and field definitions real whenever those units collaborate.
- Real server integration tests use `RUN_INTEGRATION=1`, Supertest, and migrated PostgreSQL without mocking route, validator, Kysely, DBExecutor, relation, or activity collaborators.
- Rule-of-three and size refactors stay bounded to mapped files; server imports retain `.js`; client imports omit extensions.
- The conventional commit is created after every cycle is green.

Must-not-have:

- No files outside OBJECTIVE, no source behavior outside the approved scenarios, and no test implementation copied into this plan.
- No existing-task editing, Description command, extra command surface, value creation, Board Status or Column command, natural-language parsing, chip persistence, table or event consolidation, idempotency system, migration, dependency, `contenteditable`, editor library, or `camel-lottie/` change.
- No global database access from the shared validator and no pre-commit realtime or notification publication.

Open question risks:

- Click-away on a partial command remains literal.
- A lost committed response can still produce a duplicate after manual retry because durable idempotency is out of scope.
- Initial Board Due date is represented by create activity and does not emit a due-date-change notification.

Rollback note:

- Deploy server before client and roll back client before server. Preserve lock correctness unless directly proven regressive.

## STOP CONDITIONS

Done when every declared RED becomes green, the packet suite passes, scope remains bounded, and the conventional commit exists. Uncertain when an approved assumption conflicts with existing public behavior. Escalate before changing approved behavior, touching an unmapped file, adding schema or dependency work, publishing effects before commit, accepting Board statusId, or merging Board and Tracker persistence.
