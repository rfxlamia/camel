# Task T13 — Live auto-finish guards — task deleted, access revoked

**Phase:** 4
**Depends:** T12, T14
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 13: Live auto-finish guards — task deleted, access revoked [depends: T12, T14] [test-risk]

## OBJECTIVE

Auto-finish the focus session, with a notification, when the focused task is deleted or the user loses access while they are actively in the app. The load path is already covered server-side (T4 auto-finishes on `GET` when the task no longer resolves), and T14 finalizes membership revocation for offline users; this task covers the user who is sitting on the page when it happens.

Files:
- Modify: `client/src/context/FocusSessionContext.tsx`
- Test: `client/src/context/FocusSessionContext.guards.test.tsx`

T12 does not edit `FocusSessionContext.tsx` (T7 owns it). This task still `[depends: T12, T14]` so the switch-guard flags are already wired and the server-side revocation contract exists before live guards land — see the client single-file ownership note in the File Structure Map.

Three triggers, all arriving on the workspace SSE stream `BoardContext` already consumes: `card.deleted`, `tracker.deleted`, `membership.removed`.

T9's `FocusPage` subscribes to the same `subscribeCardEvents` / `subscribeTrackerEvents` registries to refresh the task title on `*.updated`. That is deliberate — the registries support multiple subscribers and the two concerns are different (page refresh vs. session lifecycle). Do not consolidate them into one handler.

**Test-name rule.** Every cycle below isolates one case with an **unquoted, dot-separated** `-t` filter (e.g. `-t matching.card.deleted`). npm strips quotes, so a filter with real spaces reaches vitest as `-t <first-word>` plus stray positional filters and reports `Tests N skipped` at **exit 0** — a green gate that ran nothing. Each `it()` title must contain its filter string verbatim (the `.` matches the space), and the fifteen filters must stay mutually exclusive: no title may match a filter belonging to another case. Do **not** "simplify" these steps by dropping `-t` and running the whole file — the per-case FAIL/PASS structure depends on the filter, and after Step 3 the unfiltered file legitimately fails on Cases B–F.

**`[test-risk]` — why.** These scenarios span the SSE transport, the provider's event handling, and (for two of the three) a server call, and the right test level is genuinely arguable. They are pinned here as provider-level integration tests driven through the real subscription seam with a mocked API — not as unit tests of a private handler, and not as end-to-end tests.

Steps:

1. Write failing test for deletion Case A only: board session + matching `card.deleted` auto-finishes
   Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
   Level: integration

   Test intent:
   Given a board-sourced session on `taskId: 481`, When the production `subscribeCardEvents` seam delivers `{ type: "card.deleted", actor, cardId: 481, payload }`, Then `api.focus.patch` is called with `finish`, `session` becomes null, and `showToast` warns. This cycle proves only the matching board-delete path.

   Exercise through: the `BoardContext` `subscribeCardEvents` seam the provider uses in production, delivering the literal Shared-Contract card payload
   Test doubles: test-controlled `subscribeCardEvents` registry on a stubbed `BoardContext`, plus `user`, `activeWorkspaceId`, `vi.fn()` `showToast`, and mocked `../api`; do NOT mock the provider's event handler
   Expected RED: the provider does not subscribe to card events, so `api.focus.patch` is never called when Case A requires it to be called. A "session stays populated" assertion is not this case's RED.

2. Run test — verify FAIL for Case A only: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t matching.card.deleted`
   Expected failure: `expected "spy" to be called at least once`

3. Implement Case A only: subscribe through `subscribeCardEvents` (T7 seam; if missing, report a T7 defect — do not patch `BoardContext.tsx` here). For `source: "board"`, compare `event.cardId` to `session.taskId` and then `finish()`, clear state, and toast. Do not yet handle tracker events or membership.

   **Order the clear after the finish attempt settles — in both the resolve and the reject path.** `reconcileVersionConflict` re-adopts the error body on a 409 `version_conflict` (`adoptSession(err.session ?? null)`), so a clear that runs before or independently of the settled promise is silently undone by the provider's own handler. Await the attempt, then clear and toast regardless of outcome. Step 4m depends on this ordering; getting it wrong makes that case pass or fail by accident.

4. Run test — verify PASS for Case A only: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t matching.card.deleted`

4a. Write/run a separate RED→implementation→PASS cycle for deletion Case B: board session + different `cardId` does nothing
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given the same board session on 481, When `card.deleted` arrives with `cardId: 482`, Then `api.focus.patch` is not called, `session` stays populated, and no toast fires.
    Exercise through: the same `subscribeCardEvents` seam with a literal non-matching payload
    Test doubles: stubbed `BoardContext` card registry, mocked `../api`, `vi.fn()` `showToast`; do not mock the handler
    Expected RED: a Case A handler that finishes on every `card.deleted` without comparing `cardId` fails this test because the spy was called. Do not use "no handler exists / patch never called" as Case B's RED — that would already pass before any subscription exists.
    Run FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t different.cardId`. If Step 3 already compared `cardId`, tighten nothing and continue to the PASS command; still run both commands. PASS: the same `-t different.cardId` command.

4b. Write a failing test for deletion Case C only: tracker session + matching `tracker.deleted` auto-finishes
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a tracker-sourced session on `taskId: 77`, When `subscribeTrackerEvents` delivers `{ type: "tracker.deleted", trackerItemId: 77 }`, Then finish is called, `session` clears, and the user is warned.
    Exercise through: the T7 `subscribeTrackerEvents` seam with the literal tracker payload. `TrackerEventHandler` is `{ type: string; payload?: unknown; trackerItemId?: number }` — there is **no** `actor` on tracker events (card events do carry one), and `trackerItemId` is optional, so the handler must treat an absent id as "does not match" rather than comparing it.
    Test doubles: test-controlled tracker registry, mocked `../api`, `vi.fn()` `showToast`; do not mock the handler
    Expected RED: the provider does not subscribe to tracker deletion, so the matching-tracker spy is never called.

4c. Run test — verify FAIL for Case C only: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t matching.tracker.deleted`
    Expected failure: `expected "spy" to be called at least once`

4d. Implement the tracker matching path only: subscribe through `subscribeTrackerEvents`; compare `event.trackerItemId` to `session.taskId` (an absent id never matches), then finish/clear/toast with the same settle-then-clear ordering as Step 3. Do **not** check `session.source` yet and do not add a cross-source id fallback. Case C's fixture is tracker-sourced, so source filtering is not required to make Case C green; leaving source unchecked is what makes Case D's RED reachable.

4e. Run test — verify PASS for Case C only: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t matching.tracker.deleted`

4f. Write a failing test for deletion Case D only: ADR #103 colliding id must not finish a board session
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a board-sourced session on `taskId: 481`, When `tracker.deleted` arrives with `trackerItemId: 481`, Then the session must stay populated and `api.focus.patch` must not be called. Assert the source check runs before any id comparison: a `tracker.*` event is ignored outright for a board-sourced session. Because `card.*` and `tracker.*` already use different field names, an implementation that reads `event.cardId ?? event.trackerItemId` (or any unified id) would pass Cases A/C by accident and still be wrong for a future unified `work_items` payload.
    Exercise through: the tracker subscription seam delivering a colliding-id tracker payload at a board session
    Test doubles: stubbed tracker registry, mocked `../api`, `vi.fn()` `showToast`; do not mock the handler
    Expected RED: after Step 4d, the tracker handler compares `trackerItemId` without checking `session.source`, so a board session on 481 finishes when `tracker.deleted` 481 arrives. If Step 4d already discarded tracker events for board sessions, do not chase a FAIL by stripping that guard — continue to the PASS command (same hatch as Case B). Never use "no handler exists" as Case D's RED.

4g. Run test — verify FAIL for Case D only: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t colliding.tracker.deleted`
    Expected failure: `expected "spy" not to be called` (finish ran). If the command is already green because Step 4d filtered on source, skip nothing: record that PASS and proceed to Step 4h only to make the source-before-id discard explicit.

4h. Implement the board←tracker source-before-id discard only, then verify PASS: ignore `tracker.*` events when `session.source === "board"` **before** comparing ids. Do **not** yet ignore `card.*` events for tracker-sourced sessions — that inverse is Case F below. Run `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t colliding.tracker.deleted`, then re-run Cases A–C `-t` filters so they stay PASS.

4i. Write/run a separate RED→implementation→PASS cycle for deletion Case E: tracker session + different `trackerItemId` does nothing
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a tracker-sourced session on `taskId: 77`, When `tracker.deleted` arrives with `trackerItemId: 99`, Then `api.focus.patch` is not called, `session` stays populated, and no toast fires. After Case D's source filter, a handler that finishes on every `tracker.deleted` still passes Cases C/D.
    Exercise through: the tracker subscription seam
    Test doubles: stubbed tracker registry, mocked `../api`, `vi.fn()` `showToast`
    Expected RED: a Case C handler that finishes on every `tracker.deleted` without comparing `trackerItemId` fails this test. If Step 4d already compared `trackerItemId`, continue to PASS (same hatch as Case B). Never use "no handler exists" as Case E's RED.
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t different.trackerItemId`

4j. Write a failing test for deletion Case F only: inverse ADR #103 — tracker session must ignore colliding `card.deleted`
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a tracker-sourced session on `taskId: 481`, When `card.deleted` arrives with `cardId: 481`, Then the session stays populated and `api.focus.patch` is not called. A unified `event.cardId ?? event.trackerItemId` matcher would finish this session after Case A exists.
    Exercise through: the card subscription seam delivering a colliding-id card payload at a tracker session
    Test doubles: stubbed card registry, mocked `../api`, `vi.fn()` `showToast`
    Expected RED: Step 4h only discarded tracker events for board sessions, so a tracker session still finishes on colliding `card.deleted`.
    Run FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t colliding.card.deleted`
    Expected failure: `expected "spy" not to be called` (finish ran).

4k. Implement the inverse source-before-id discard, then verify PASS: ignore `card.*` events when `session.source === "tracker"` before comparing ids. Run `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t colliding.card.deleted`, then re-run Cases A–E `-t` filters.

4l. Write/run a separate RED→implementation→PASS cycle for matching `*.updated` must not auto-finish
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Independent cases with their own `-t` names: (1) board session on 481 + `card.updated` `{ cardId: 481 }` does not call finish/PATCH and leaves the session populated; (2) tracker session on 77 + `tracker.updated` `{ trackerItemId: 77 }` does the same. T9 refreshes title on these events with a mocked `useFocusSession`, so it cannot catch the provider exiting focus on a title edit.
    Exercise through: the same card/tracker seams with `*.updated` payloads
    Test doubles: stubbed registries, mocked `../api` asserted not called for patch, `vi.fn()` `showToast`
    Expected RED: a `card.*` / `tracker.*` handler that finishes on any matching id, including `updated`, calls PATCH. Restrict auto-finish to `*.deleted` only.
    Run FAIL then PASS separately: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t card.updated.does.not.finish` and `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t tracker.updated.does.not.finish`

4m. Write/run a separate RED→implementation→PASS cycle for deletion auto-finish when PATCH rejects
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given a board session on 481, When matching `card.deleted` arrives and `api.focus.patch` rejects `409 { code: "version_conflict", session }` (and a second named case for 5xx), Then local `session` is still null, the toast still fires, and the provider must NOT adopt the 409 body as the active session. T7's PATCH `version_conflict` handler would otherwise put the user back on a deleted task.
    Exercise through: the card subscription seam plus the provider `finish()` path
    Test doubles: mocked `../api` rejecting with typed 409 then 5xx; stubbed card registry; `vi.fn()` `showToast`; do not mock the handler
    Expected RED: finish rejection is routed through T7's silent 409 adoption, so `session` stays populated with the body.
    Run FAIL then PASS separately: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t deleted.finish.409.still.clears` and `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t deleted.finish.5xx.still.clears`

5. Write failing test for membership Case A only: matching `membership.removed` auto-finishes even when PATCH 404s
   Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
   Level: integration

   Test intent:
   Given an active session in workspace 3 for user 7, When `subscribeMembershipEvents` delivers `{ type: "membership.removed", userId: 7, workspaceId: 3, workspaceName: "Workspace 3" }` and `api.focus.patch` rejects 404, Then local state is cleared and the user is notified; no unhandled rejection or phantom session remains. Do not assert BoardContext's redirect here (T7 Steps 7–9 cover the real provider).

   Exercise through: the T7 `subscribeMembershipEvents` seam with the literal four-field membership payload
   Test doubles: mocked `../api` whose `patch` rejects with a 404; stubbed membership registry; `vi.fn()` `showToast`; do not mock the handler
   Expected RED: the provider ignores membership events, so state stays populated, or the rejected finish surfaces as an unhandled rejection

6. Run test — verify FAIL for membership Case A only: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t matching.membership.removed`
   Expected failure: the event is ignored or the 404 rejection is unhandled.

6a. Implement the matching membership path only: subscribe through `subscribeMembershipEvents`; on a matching `userId`/`workspaceId` clear state and toast even when finish 404s — again awaiting the finish attempt before clearing, so the clear cannot be undone by the provider's error handling (a 404 is rethrown by `handleMutationError`, so the rejection must be caught here). Do not yet add the different-user filter as a combined assertion.

6b. Run test — verify PASS for membership Case A only: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t matching.membership.removed`

6c. Write/run a separate RED→implementation→PASS cycle for membership Case B: `membership.removed` for a different user does nothing
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Test intent: Given the same session for user 7, When `membership.removed` arrives with `userId: 9`, Then no finish call, state clear, or toast occurs.
    Exercise through: the membership seam with `userId: 9`, `workspaceId: 3`, `workspaceName: "Workspace 3"`
    Test doubles: mocked `../api`, stubbed membership registry, `vi.fn()` `showToast`
    Expected RED: a membership handler that does not compare `userId` finishes the current user's session. Do not use "no membership handler exists" as this case's RED.
    Run FAIL: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t different.user.membership`. Implement the user-id guard if the spy was called. PASS: the same `-t` command.

7. Write failing test for null-session Case A only: `card.deleted` is inert when `session` is null
   Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
   Level: integration

   Test intent:
   Given `session: null`, When a `card.deleted` event arrives, Then no API call or toast occurs. Write this after the deletion handlers exist so the RED is a handler that runs unconditionally, not the absence of a handler.

   Exercise through: `subscribeCardEvents` with a null session
   Test doubles: mocked `../api` asserted not called; stubbed card registry; `vi.fn()` `showToast`
   Expected RED: the Case A card handler runs unconditionally and calls `finish()` on a null session

7a. Run test — verify FAIL for null-session Case A only: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t no.session.card.deleted`
    Expected failure: `finish`/patch is called against a null session.

7b. Guard the card handler on an active session, then verify PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t no.session.card.deleted`

7c. Write/run a separate RED→implementation→PASS cycle for null-session Case B: `tracker.deleted` with `session: null` makes no API call or toast
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Exercise through: `subscribeTrackerEvents` with a null session
    Test doubles: mocked `../api` asserted not called
    Expected RED: the tracker handler runs unconditionally on a null session
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t no.session.tracker.deleted`

7d. Write/run a separate RED→implementation→PASS cycle for null-session Case C: `membership.removed` with `session: null` makes no API call or toast
    Test file: `client/src/context/FocusSessionContext.guards.test.tsx`
    Level: integration
    Exercise through: `subscribeMembershipEvents` with a null session
    Test doubles: mocked `../api` asserted not called
    Expected RED: the membership handler runs unconditionally on a null session
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx -t no.session.membership.removed`

8. Re-run the full guards file after the independent cycles: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx`
   Expected: PASS for every named `-t` case above.

9. Refactor while green (bounded):
   - Rule of three: "does this event refer to the focused task" is asked by three handlers — extract one named predicate (e.g. `eventTargetsFocusedTask(session, event)`) inside the provider, comparing `source` and `taskId` together. Never a generic `utils.ts`
   - "clear state + toast" also runs three times — one `autoFinish(reason)` helper
   - If `FocusSessionContext.tsx` crosses ~300 lines, extract the guard handlers into the mapped `client/src/lib/focusGuards.ts` as pure functions and add `client/src/lib/focusGuards.test.ts` covering the extracted predicates; both conditional files belong in the commit below
   - Re-run `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx`, the T7 suite `npm run test --workspace=client -- src/context/FocusSessionContext.test.tsx`, and the full client suite — all must stay PASS

10. Commit:
    `git add client/src/context/FocusSessionContext.tsx client/src/context/FocusSessionContext.guards.test.tsx`
    If Step 9 extracted `client/src/lib/focusGuards.ts` and its test, additionally run `git add client/src/lib/focusGuards.ts client/src/lib/focusGuards.test.ts` before committing.
    `git commit -m "feat(focus): auto-finish focus session on task deletion or access loss"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — rule: Guards (`✓ task deleted → auto-Finish + notification`, `✓ access revoked → auto-Finish + notification`); "Story: Workspace and access guards"; Implementation Notes ("subscribe to `card.deleted`, `tracker.deleted`, `membership.removed` SSE; toast via `showToast`"); Open Questions row confirming auto-finish + toast then the existing workspace redirect on `membership.removed`
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — `cards` and `tracker_items` ids overlap; an event must be matched on `source` **and** id, never id alone
- `client/src/context/BoardContext.tsx` (lines ~528–585) — the `onmessage` dispatch, the `membership.removed` handling, and the existing removal redirect this guard must not interfere with
- `client/src/context/FocusSessionContext.tsx` (T7) — the provider, its `finish` action, and the subscription seam
- `docs/pocket/rule/creative-brief.md` — Copy Guidelines; the notification is informative and calm, not alarming

## WHY THIS APPROACH

Complexity: standard
Justification: one primary file, but three event paths with different failure characteristics — and the revocation path must work correctly precisely when the API is guaranteed to fail.

## SANDWICH CONTEXT

[CRITICAL: match deletion events on `source` AND `taskId` together. `cards` and `tracker_items` have independent id sequences, so card 481 and tracker item 481 both exist. Matching on id alone will silently finish a user's focus session because an unrelated item in the other table was deleted.]

You are implementing the live auto-finish guards for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A — the server is the session authority, but the client reacts to realtime events so a user watching the page is not left focused on a task that no longer exists.
Files in scope: `client/src/context/FocusSessionContext.tsx`, `client/src/context/FocusSessionContext.guards.test.tsx` — no other files (plus a pure-guards extraction if Step 9 triggers one).
Test framework: Vitest + `@testing-library/react`, jsdom. Single file: `npm run test --workspace=client -- src/context/FocusSessionContext.guards.test.tsx`. Test paths are workspace-scoped AND workspace-relative — a root `npm run test -- client/src/...` does NOT filter and exits 1 with `No test files found`, indistinguishable from a real RED. Never quote a multi-word `-t` filter: npm strips the quotes and the run can exit 0 having skipped every test; use an unquoted regex dot per space.
Available after: T12 and T14 (T12 consumes parent flags only and must not edit this file; T14 supplies the server-side offline-revocation contract), and through them T7 (provider, all three subscription seams, `finish` action). T7 and T13 are the only writers of `FocusSessionContext.tsx`.
Architecture rule: react to events through the existing `BoardContext` subscription seam — do not open a second `EventSource`. On `membership.removed`, clear local state and toast even when the server call fails, and let `BoardContext`'s existing removal redirect proceed. Client imports carry no extension.

[RESTATE: compare `source` and `taskId` together — a dual-table id collision must never finish the wrong session.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given an active session on task T, When T is soft-deleted and the `card.deleted` or `tracker.deleted` event arrives, Then the session auto-finishes and the user is notified
Given an active session in workspace W, When the user is removed from W, Then the session auto-finishes with a notification (that the existing workspace redirect still runs is proven by T7 Steps 7–9 against a real `BoardProvider`; T13 stubs the context, so do not try to assert it here)
[derived] Given a deletion event for a different task, When it arrives, Then nothing happens — proven for both board (`different cardId`) and tracker (`different trackerItemId`)
[derived] Given a `membership.removed` for a different user, When it arrives, Then nothing happens
[derived] Given no active session, When any guard event arrives, Then no API call is made and no toast is shown
[must-not] Given a board-sourced session on `taskId: 481`, When `tracker.deleted` arrives for tracker item 481, Then the session must NOT be finished — the ids come from different tables, and the source must be checked before any id comparison, not inferred from which field happens to be present
[must-not] Given a tracker-sourced session on `taskId: 481`, When `card.deleted` arrives for card 481, Then the session must NOT be finished — the inverse ADR #103 collision
[must-not] Given an active session on task T, When `card.updated` or `tracker.updated` arrives for T, Then the session must NOT auto-finish — only `*.deleted` finishes; title refresh is T9
[must-not] Given matching `card.deleted`, When finish/PATCH rejects 409 or 5xx, Then the UI must NOT retain the 409 body as the active session — clear locally and toast
[must-not] Given `membership.removed` and a failing finish call, When the guard runs, Then the UI must NOT retain a phantom session or surface an unhandled rejection

All tests PASS. Commit exists with message matching `feat(focus): auto-finish focus session on task deletion or access loss`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Source checked **before** id on every deletion event — a `tracker.*` event is discarded for a board-sourced session without ever comparing ids, and vice versa
- Local state cleared and the user notified even when the server call fails
- The existing `membership.removed` redirect in `BoardContext` still runs
- Guards inert when no session is active
- Tests written BEFORE implementation (TDD — not after)
- Rule of three enforced — one target predicate and one auto-finish helper, not three copies of each
- Commit message follows conventional commits format

Must-not-have:
- A second `EventSource` or a polling loop
- Auto-finish on any trigger not listed here — in particular, not on a task status change, and not on the user simply navigating away
- Swallowing `membership.removed` so the workspace redirect never fires
- A `notifications` table write — the spec makes that optional and this plan does not include it

Open question risks:
- Assumption: a `showToast` warning is sufficient notification; no `notifications` row is written. If a persistent notification is required, that is additive → note it, do not block.
- Assumption: T7's `subscribeCardEvents`, `subscribeTrackerEvents`, and `subscribeMembershipEvents` all deliver their events. If a seam is missing, report it as a T7 defect rather than patching `BoardContext` here.

Rollback note:
- Flag off ⇒ no sessions exist ⇒ these handlers never fire. Nothing here changes board or tracker behavior.

Red flags:
- Work outside the two listed files → DONE_WITH_CONCERNS
- Id-only event matching → STOP
- Editing `BoardContext.tsx` → STOP
- A second SSE connection → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, `npm run test` and `npm run typecheck --workspace=client` are green, commit created
Uncertain when: a persistent `notifications` row is required instead of a toast
Escalate when: the guards appear to need a second realtime connection, or `BoardContext`'s removal redirect cannot coexist with the auto-finish
