# Task T9 — Wire assignee/label pickers into TrackerRow + TrackerPage

**Phase:** 3
**Depends:** T7, T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 9: Wire assignee/label pickers into TrackerRow + TrackerPage [depends: T7, T8]

## OBJECTIVE
Turn the row's assignee avatars and label chips into `TrackerPropertyPicker` `multiple`-mode
triggers, wire their toggle patches through the shared mutation queue using `resolveToggle`
(T8) and `itemsRef` (T2) so rapid sequential toggles on the same item compute correctly
against live settled state rather than stale click-time snapshots.

Files:
- Modify: `client/src/components/tracker/TrackerRow.tsx`
- Modify: `client/src/components/tracker/TrackerSection.tsx`
- Modify: `client/src/pages/TrackerPage.tsx`
- Modify: `client/src/pages/TrackerPage.test.tsx`

**Correction from Phase 5 review + scope boundary (same as T4/T5/T6):** `members`, `labels`,
`onAssigneeToggle`, `onLabelToggle` thread through `TrackerSection.tsx`, not directly from
`TrackerPage.tsx` to `TrackerRow`. All four are OPTIONAL on `TrackerRow`'s Props — when
absent, the assignee avatars and label chips render exactly as they do today (read-only),
matching `TrackerPhaseSection.tsx`'s unmodified, out-of-scope call site.

Steps:

Before the first red run, extend `mockGetWorkspaceMembers` so the default fixture includes
Alice (`userId: 7`), Bob (`userId: 8`), Carol (`userId: 9`), and Dave (`userId: 10`), each
with `username`/`displayName` matching those names. Existing tests that only query Alice/Bob
must keep passing. Then draft the complete T9 red suite in the test file: assignee add,
assignee remove, assignee live-state race, label add, label remove, and 409 mid-queue recovery.
The later numbered entries describe each assertion and its verification checkpoint; they are
not permission to implement a behavior before its assertion exists.

1. Write failing test for: toggling an assignee adds them (Story 4 Example A)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given item CA-1 has assignees=[Alice] (`TrackerItemAssignee.id` 7, matching Alice's `userId`), When the user opens the row's assignee picker and toggles Bob (`userId` 8), Then `mockUpdateTrackerItem` is called with `{ assigneeIds: [7, 8], version }`
   Exercise through: clicking the row's assignee trigger, selecting Bob in the multi-select picker
   Test doubles: `mockUpdateTrackerItem`
   Expected RED: today's assignee avatars in `TrackerRow.tsx` are plain, non-interactive spans

2. Run test — verify FAIL:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

3. Implement minimal code to satisfy the test:
   File: `client/src/components/tracker/TrackerRow.tsx`
   Implement: add `members?: WorkspaceMember[]`, `labels?: TrackerVocabulary[]`,
   `onAssigneeToggle?: (toggledId: number) => void`,
   `onLabelToggle?: (toggledId: number) => void` (all OPTIONAL); when
   `members`/`onAssigneeToggle` are both defined, replace the assignee avatar block with a
   `TrackerPropertyPicker multiple` trigger with accessible name `Assignees` and
   `data-testid={\`row-inline-assignees-${item.key}\`}`, options built the same way
   `TrackerProperties.tsx`'s `assigneeOptions` are built (`id: String(m.userId)`, selected via
   `item.assignees` ids); when either is undefined, keep today's plain read-only avatar display; apply the identical
   defined/undefined split for the label chip block using `labels`/`onLabelToggle`/`labelOptions`,
   with accessible name `Labels` and `data-testid={\`row-inline-labels-${item.key}\`}`;
   extend the "which picker" union to include `"assignees"` and `"labels"`

   File: `client/src/components/tracker/TrackerSection.tsx`
   Implement: add `members: WorkspaceMember[]`, `labels: TrackerVocabulary[]`,
   `onAssigneeToggle: (item: TrackerItem, toggledId: number) => void`,
   `onLabelToggle: (item: TrackerItem, toggledId: number) => void` to `Props`. Bind item at the
   Row call-site the same way status/date already do:
   `onAssigneeToggle={(toggledId) => onAssigneeToggle(item, toggledId)}` and
   `onLabelToggle={(toggledId) => onLabelToggle(item, toggledId)}`. Pass `members` and `labels`
   straight through.

   File: `client/src/pages/TrackerPage.tsx`
   Implement: add `changeAssignee` and `changeLabel` through `applyItemPatch`. Each builder reads
   `itemsRef.current` inside the queued closure, uses `resolveToggle`, and builds the request with
   the current version. The optimistic `assignees` array is `TrackerItemAssignee[]`: map each id
   through `members.find((m) => m.userId === id)` to `{ id: member.userId, username: member.username, displayName: member.displayName }`. Optimistic `labels` are the matching `TrackerVocabulary` objects from the loaded `labels` state. If a toggled ID cannot be resolved, return
   `null` and do not send a partial optimistic item. Pass `members`, `labels`, and both handlers
   through the `<TrackerSection ... />` call-site.

4. Run test — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

5. Execute the pre-written regression case for: rapid sequential toggles compute against live settled state, not stale snapshot (Story 4 Example B — the core race-condition fix)
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration

   Test intent:
   Given item CA-1 has assignees=[Alice] (`TrackerItemAssignee.id` 7), version=5, with `mockUpdateTrackerItem` set up
   so the FIRST call (toggling Bob, `userId` 8) resolves only after the test explicitly triggers it
   (via a manually-controlled promise, same technique as T1's queue tests), returning
   `{ ...current, assignees: [{ id: 7, username: "alice", displayName: "Alice" }, { id: 8, username: "bob", displayName: "Bob" }], version: 6 }`
   When the user toggles Bob, then immediately toggles Carol (`userId` 9) before Bob's call resolves
   Then:
   - `mockUpdateTrackerItem` is called first with `{ assigneeIds: [7, 8], version: 5 }` (Bob added to Alice)
   - Only after that call is manually resolved does the second call fire, with `{ assigneeIds: [7, 8, 9], version: 6 }` — computed against the SETTLED state (including Bob and the new version), not the pre-Bob snapshot
   - Neither toggle is dropped; final displayed assignees are Alice, Bob, Carol

   Exercise through: clicking the row's assignee trigger twice in quick succession, toggling different members each time, with the mock controlling exact resolution timing

   Test doubles: `mockUpdateTrackerItem` (manually-controlled promise for the first call, resolved value for the second)

   Regression check: if `changeAssignee`'s closure reads `item.assignees` (the value captured when the row was rendered / the toggle was clicked) instead of `itemsRef.current`'s live value at execution time, the second call computes `assigneeIds: [7, 9]` (missing Bob) instead of `[7, 8, 9]`.

6. Run regression test — verify PASS (verify, don't assume — Step 3's sketch already reads
   `itemsRef.current.find(...)` INSIDE the enqueued closure, which is the correct pattern, so
   this may already pass; if Step 3's actual implementation instead captured `item.assignees`
   from the outer scope before calling `enqueue`, this fails with the second call's
   `assigneeIds` argument as `[7, 9]` instead of `[7, 8, 9]`):
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

7. (If Step 6 fails, fix the implementation.) Verify `changeAssignee`'s enqueued task reads `itemsRef.current.find(...)` INSIDE
   the async function body (not destructured from the outer `item` parameter before the
   `enqueue` call) — this is the exact bug the test targets; fix by moving the
   `current.assignees` read to occur at the top of the enqueued async closure, not before it

8. Run test — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

9. Execute the pre-written regression case for: label toggle follows the identical pattern
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test intent: Given an item with labels=[Feature], When the user toggles the Bug label in the row's label picker, Then `mockUpdateTrackerItem` is called with `{ labelIds: [Feature.id, Bug.id], version }`
   Exercise through: clicking the row's label trigger, toggling a label
   Test doubles: `mockUpdateTrackerItem`
   Regression check: `changeLabel` should already use the same helper path as `changeAssignee`;
   if it fails, write the failing assertion before changing the implementation.

10. Run test — verify PASS (verify): `npm run test -- client/src/pages/TrackerPage.test.tsx`

10a. Execute the pre-written regression case for: toggling an assignee off removes them
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration
    Test intent: Given item CA-1 has assignees=[Alice, Bob] (ids 7 and 8), When the user
    toggles Alice in the row's assignee picker, Then `mockUpdateTrackerItem` is called with
    `{ assigneeIds: [8], version }` and the row no longer shows Alice as selected.
    Exercise through: opening the assignee picker and toggling the already-selected Alice option
    Test doubles: `mockUpdateTrackerItem`
    Regression check: `resolveToggle` already covers remove at unit level; this locks the
    page wiring for the off path, not only add.

10b. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

10c. Execute the pre-written regression case for: toggling a label off removes it
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration
    Test intent: Given an item with labels=[Feature, Bug], When the user toggles Feature in
    the row's label picker, Then `mockUpdateTrackerItem` is called with
    `{ labelIds: [Bug.id], version }`.
    Test doubles: `mockUpdateTrackerItem`

10d. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

11. Execute the pre-written regression case for: 409 mid-toggle-queue reverts that step and resumes the rest (Story 4, final scenario)
    Test file: `client/src/pages/TrackerPage.test.tsx`
    Level: integration

    Test intent:
    Given item CA-1 has assignees=[Alice] (`TrackerItemAssignee.id` 7), version=5, When the user toggles Bob (`userId` 8)
    then immediately toggles Carol (`userId` 9) before Bob's call resolves, and the FIRST
    (`mockUpdateTrackerItem` for Bob) is rejected with a `version_conflict` ApiError, with
    `mockListTrackerItems`'s refetch (triggered by `loadData()`) set to return CA-1 with
    assignees=[{ id: 7, username: "alice", displayName: "Alice" }, { id: 10, username: "dave", displayName: "Dave" }]
    (Dave's `userId` 10 — a value distinguishable from both the pre-toggle state
    [Alice] and the naively-expected-but-wrong post-Bob state [Alice, Bob]) and version=9
    Then:
    - The Bob toggle reverts visibly (row shows [Alice, Dave] after the refetch, not [Alice, Bob])
    - A toast reads "Someone else updated this item first — refreshed."
    - The second queued toggle (Carol) still fires afterward, computed against the REFETCHED
      state — asserting the exact PATCH payload `{ assigneeIds: [7, 10, 9], version: 9 }`
      (Alice + Dave, from the refetch, plus Carol) — a test that only passes if the
      implementation actually re-reads the refetched state before computing Carol's toggle;
      an implementation that stalls, drops Carol, or computes against any other assignee set
      fails this specific assertion (test-strategy-audit finding — the prior wording had no
      way to distinguish a correct refetch-then-resume from a stale-read bug)

    Exercise through: same double-toggle interaction as Step 5, with the first mock call
    rejecting instead of resolving

    Test doubles: `mockUpdateTrackerItem`, `mockShowToast`, `mockListTrackerItems` (for the refetch, returning the distinguishable [Alice, Dave]/version=9 state above)

    Regression check: if `changeAssignee`'s catch branch doesn't call `loadData()`, if the queue
    doesn't continue to the next task after a rejection, or if Carol's toggle is computed
    against any state other than the refetched [Alice, Dave] (this exercises T1's
    rejection-resilience guarantee at the integration level with a payload precise enough to
    catch a stale-read implementation that Step 5's happy-path test cannot)

12. Run regression test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

13. If Step 12 fails, align `changeAssignee`/`changeLabel`'s catch branches with the established
    409-handling shape from `changeStatus`/`changeDate`/`changeProject`/`changePriority`, then
    rerun the regression test.

14. Run test — verify PASS: `npm run test -- client/src/pages/TrackerPage.test.tsx`

15. Refactor while green: `changeAssignee` and `changeLabel` are now near-identical except for
    the field name (`assigneeIds` vs `labelIds`) and source array (`assignees` vs `labels`) —
    Rule of Three has now fired across the whole file for the optimistic/409 skeleton; if
    `applyItemPatch` (from T5) doesn't already parameterize cleanly over toggle-based fields,
    extend it now rather than leaving two near-duplicate functions
    Re-run: `npm run test -- client/src/pages/TrackerPage.test.tsx` — must stay PASS

16. Commit:
    `git add client/src/components/tracker/TrackerRow.tsx client/src/components/tracker/TrackerSection.tsx client/src/pages/TrackerPage.tsx client/src/pages/TrackerPage.test.tsx`
    `git commit -m "feat(tracker): add inline assignee and label toggle editing to tracker rows"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 4, full GWT, especially Example B
`client/src/components/tracker/TrackerProperties.tsx:96-114` — `assigneeOptions`/`labelOptions` construction pattern reused
`client/src/lib/trackerUtils.ts` (post-T8) — `resolveToggle` consumed here
`client/src/pages/TrackerPage.tsx` (post-T7) — `labels`/`members` state consumed here

## WHY THIS APPROACH
Complexity: standard
Justification: The core race-condition scenario (Step 5-8) requires precise closure-timing correctness that's easy to get subtly wrong (reading stale vs. live state) — this is the exact bug class the edge-case hunter flagged in the grinding session, so it gets dedicated, explicit test coverage rather than being folded into a lighter task.

## SANDWICH CONTEXT
[CRITICAL: The enqueued task's closure MUST read itemsRef.current at execution time, inside the async function body — never capture assignee/label state before calling enqueue, or rapid sequential toggles will silently drop each other]
You are implementing Task 9 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: Option A — changeAssignee/changeLabel reuse mutationQueueRef/itemsRef from T2, resolveToggle from T8
Files in scope: `client/src/components/tracker/TrackerRow.tsx`, `client/src/components/tracker/TrackerSection.tsx`, `client/src/pages/TrackerPage.tsx`, `client/src/pages/TrackerPage.test.tsx`
Available after: T7 and T8 (T7∥T8 must both complete first)
Architecture rule: read itemsRef.current inside the enqueued closure, not before enqueue is called; members/labels/onAssigneeToggle/onLabelToggle are OPTIONAL on TrackerRow's Props; Row callbacks omit `item`
[RESTATE: Live-state read inside the closure, at execution time — this is the load-bearing constraint for this whole task]

## DELIVERABLE
Given item has assignees=[Alice], When user toggles Bob, Then patch sent assigneeIds=[Alice.id,Bob.id]
Given item has assignees=[Alice, Bob], When user toggles Alice off, Then patch sent assigneeIds=[Bob.id]
Given two rapid toggles (Bob then Carol) before the first settles, When both settle, Then final assigneeIds=[Alice,Bob,Carol], computed via live state at execution time
Given labels toggle used, Then same add and remove pattern with labelIds
Given a 409 mid-queue, Then that step reverts+toasts+refetches, remaining queued toggles resume against refetched state

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `itemsRef.current` read happens inside the enqueued async closure body, verified by the Step 5-8 test passing
  - `resolveToggle` (T8) imported and used, not re-implemented inline
  - Assignee/label ordinary failures restore only their own field; a 409 tail proceeds only after
    `loadData()` has synchronously updated `itemsRef` with the authoritative list
  - Optimistic assignees are `TrackerItemAssignee` objects mapped from `member.userId`, never `WorkspaceMember`
  - `members`, `labels`, `onAssigneeToggle`, `onLabelToggle` are OPTIONAL on `TrackerRow`'s Props, threaded through `TrackerSection.tsx` with item bound at the Section→Row call-site
  - Tests written BEFORE implementation

Must-not-have:
  - Reading assignee/label state from the `item` parameter captured before `enqueue` is called
  - Making any of the four new props required on `TrackerRow` (breaks `TrackerPhaseSection.tsx`)
  - Modifications to files outside listed scope

Open question risks:
  - None specific — this task resolves the exact concurrency risk the edge-case hunter flagged

Rollback note:
  - Revert restores plain, non-interactive assignee avatars and label chips

## STOP CONDITIONS
Done when: all 5 DELIVERABLE scenarios pass (especially the race-condition scenario), commit created
Uncertain when: N/A
Escalate when: the race-condition test (Step 5) cannot be made to pass without changing T1's queue module itself — report back rather than patching T1 silently from within this task
