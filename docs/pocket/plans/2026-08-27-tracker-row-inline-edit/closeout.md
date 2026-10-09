# Closeout — 2026-08-27-tracker-row-inline-edit

- **Plan:** /Users/rfxlamia/project/camel/docs/pocket/plans/2026-08-27-tracker-row-inline-edit
- **Type:** phased
- **Started:** 2026-08-29  ·  **Closed:** 2026-08-29
- **Baseline SHA:** 24aed0c591822776658e219c612aaced0058c3f6  ·  **Final SHA:** d088459feff4dfdb3efc13d03bb453b691706fe0
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan/phase-1.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T1 | Shared per-item mutation queue module | 0b3dfdc187a6b8b20b57661d13cb73cbc43f6f37 | REVIEW_PASS |
| T2 | Wire status change through the shared queue | 6dc4f37214d8998b55b33e0991d778788abec678 | REVIEW_PASS |
| T3 | Build TrackerRowDatePopover + formatDateRange helper | 966cd01a7c57b36ec90728a8ea66fe74a6498c85 | REVIEW_PASS |

_SHA range: 24aed0c591822776658e219c612aaced0058c3f6..966cd01a7c57b36ec90728a8ea66fe74a6498c85_

### Phase 2 — execution-plan/phase-2.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T4 | Wire date popover into TrackerRow + TrackerPage | 31701b750fab1632f3e82e3e148925647a68e516 | REVIEW_PASS |
| T5 | Project/phase inline edit | 96ff27cac0e5d2a86ad825680a7d8799dd8c6ae2 | REVIEW_PASS |
| T6 | Priority inline edit | 169cc984ffc90e3c3df85157e93cbb3b7e7992cb | REVIEW_PASS |

_SHA range: 966cd01a7c57b36ec90728a8ea66fe74a6498c85..169cc984ffc90e3c3df85157e93cbb3b7e7992cb_

### Phase 3 — execution-plan/phase-3.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T7 | Labels/members isolated eager fetch | 69b4d27b0bef88fd69e407caec5dd9bc84eeba67 | REVIEW_PASS |
| T8 | Toggle-diff resolver helper | 1eeea76a5ddebd822722c9a9aef2e5263e92504a | REVIEW_PASS |
| T9 | Wire assignee/label pickers into TrackerRow + TrackerPage | 15fcd61d331c10d8a99681e52bf960df6527a7a7 | REVIEW_PASS |
| T10 | Mobile kebab menu | 1a912c0dc5f332116f4976eb0fdaa38687dac7e6 | REVIEW_PASS |
| T11 | TrackerRow.test.tsx — unit regression suite | d088459feff4dfdb3efc13d03bb453b691706fe0 | REVIEW_PASS |

_SHA range: 169cc984ffc90e3c3df85157e93cbb3b7e7992cb..d088459feff4dfdb3efc13d03bb453b691706fe0_

## Carried Forward

Non-blocking observations from review — accepted at close, recorded for follow-up.

- **T1** (strength): Implementation matches the packet snippet: factory createItemMutationQueue, Map per itemId, prior.then(task, task), swallowed settled chain, identity-checked delete (trackerItemMutationQueue.ts:1-17).
- **T1** (strength): All three DELIVERABLE GWT scenarios are covered through public enqueue only, with controlled promises and no queue-module mock (trackerItemMutationQueue.test.ts:5-75).
- **T1** (strength): In-scope files stay tiny (17 and 76 lines); enqueue is ~13 lines; no 3+ duplicated logic; no React/DOM/tracker-domain types, extra exports, UI, server, or dependency changes in the audited range.
- **T2** (strength): applyStatusMutation (42 lines, TrackerPage.tsx:268-309) holds the optimistic-update + PATCH + 409 revert + toast + refetch skeleton; changeStatus (27) and the inner enqueue callback (23) stay under ~50.
- **T2** (strength): Call site still owns mutationQueueRef.enqueue, recoveryBlockedItemIdsRef early-return, itemsRef live no-op, and status-group uncollapse (TrackerPage.tsx:311-337).
- **T2** (strength): Three rapid status picks enqueue as three sequential PATCHes in Todo → In Progress → Done order with incrementing versions; the row ends at Done (TrackerPage.test.tsx:375-432).
- **T2** (strength): 409 recovery adds the item id before await loadData(); a failed refresh leaves the block so the queued successor sends nothing; a later successful refresh clears it for a new user action (TrackerPage.tsx:295-301, 159-162, 315; TrackerPage.test.tsx:501-576).
- **T2** (strength): Successful 409 refresh lets the queued successor resume against the refetched version, not the pre-refresh one (TrackerPage.test.tsx:434-498).
- **T2** (strength): inFlightStatusRef/queuedStatusRef are gone; every item-list write goes through replaceItems/updateItems; loadData returns Promise<boolean>; Todo is appended (position 2000) without reordering statuses[0..2]; mocked ApiError stores optional code.
- **T2** (strength): Existing status tests were inserted around, not assertion-edited; TrackerRow.tsx and all files outside the listed pair are untouched. Refactor commit 54ab8a5 touched only TrackerPage.tsx.
- **T3** (strength): formatDateRange matches every Story 1 Rule 2 example: equal '6 Aug', same month '6–26 Aug' (U+2013), different month '28 Aug–3 Sep', different year '30 Dec 2026–3 Jan 2027', one-sided dates, neither-set null, reversed null (trackerUtils.ts:46-85; trackerUtils.test.ts:41-75). Parses YYYY-MM-DD via parseDateOnly; never new Date(iso) or toLocaleDateString.
- **T3** (strength): All five close paths (explicit close, trigger toggle, outside mousedown, Escape, parent open true→false) share one idempotent close() with closeHandledRef (TrackerRowDatePopover.tsx:81-128, 182-185, 219). Commit emits both keys as string | null only when the draft differs; invalid non-empty range sets the specified message and skips onCommit/onOpenChange(false).
- **T3** (strength): Controlled parent close calls close({ notifyParent: false }) so onCommit fires once without recursively calling the parent setter (TrackerRowDatePopover.tsx:102-107; test:116-153). Drafts passed to TrackerDateFields are strings (?? ''); portal root exposes data-tracker-row-date-popover={idPrefix} (TrackerRowDatePopover.tsx:194).
- **T3** (strength): Scope is exact: four listed files, two packet commits, no TrackerRow.tsx/TrackerPage.tsx wiring, no hardcoded Set date in the component (triggerLabel only), no new dependencies or server changes. formatDateRange is 40 lines with formatOneDate extracted; file sizes stay under the ~300-line heuristic (popover 228, trackerUtils 274). Positioning mirrors TrackerPropertyPicker rather than adding a generic popover abstraction.
- **T4** (strength): formatDateRange is imported from trackerUtils and used for triggerLabel (null → 'Set date'); not reimplemented (TrackerRow.tsx:2, 59-61, 154).
- **T4** (strength): onDateChange is optional on TrackerRow and required on TrackerSection; TrackerPage supplies it at the one TrackerSection call-site; TrackerPhaseSection still omits it and keeps the createdAt <time> fallback (TrackerRow.tsx:26-29, 149-168; TrackerSection.tsx:21-24, 108; TrackerPage.tsx:604; TrackerPhaseSection.tsx:106-111).
- **T4** (strength): requestPicker closes date first (setOpenPicker(null)) so TrackerRowDatePopover's parent-close contract (open true→false → close({ notifyParent: false })) commits the draft before the pending picker opens (TrackerRow.tsx:63-78, 157). Integration test clicks status while the date draft is dirty and asserts one PATCH then the status options (TrackerPage.test.tsx:452-494).
- **T4** (strength): changeDate/applyDateMutation mirror changeStatus/applyStatusMutation: queue enqueue, recoveryBlockedItemIdsRef early-return, itemsRef live read, optimistic field update, PATCH with version, hydrate, field-scoped rollback, identical 409 toast + await loadData(), distinct ordinary-error copy. Second copy only; packet defers applyItemPatch to T5 (TrackerPage.tsx:271-350 vs 352-421).
- **T4** (strength): Editable date column dropped w-12; uses pointer-events-auto, min-w-[9rem] shrink-0 truncate so the title column yields first. Read-only createdAt path retains w-12 (TrackerRow.tsx:149-168).
- **T4** (strength): Scope is exact: four listed files, one packet commit 31701b7. No TrackerRowDatePopover.tsx / TrackerPhaseSection.tsx / TrackerProjectPage.tsx. applyDateMutation 49 lines, changeDate 30; TrackerRow.tsx 171 and TrackerSection.tsx 115 stay under the ~300-line file heuristic. TrackerPage.tsx was already a hub file; T4 added the 2nd handler without extracting the shared helper.
- **T5** (strength): TrackerRow Props replaced projectLabel with optional projects/onProjectChange/onPhaseChange; chips render only when projects !== undefined, so TrackerPhaseSection (unmodified) still compiles with no chips (TrackerRow.tsx:31-33, 138-187).
- **T5** (strength): TrackerSection dropped showProjectChip/projectLabel suppression and passes projects through unconditionally (TrackerSection.tsx:25-27, 102-108). TrackerPage deleted the projectNames suppression Map and supplies projects plus both handlers (TrackerPage.tsx:630-634).
- **T5** (strength): applyItemPatch is the shared helper: build(current) runs after an itemsRef read inside the helper, returns null for live no-op, and rollback(latest) restores only the changed fields (TrackerPage.tsx:269-311, 351-355, 383, 413-417, 437-440). applyItemPatch is 43 lines; changeDate/changeStatus/changeProject/changePhase are 38/26/33/23 — under the ~50-line handler heuristic this task put in scope.
- **T5** (strength): changePhase reads current.phaseId and current.projectId inside the queued applyItemPatch build (TrackerPage.tsx:424-445). changeProject's no-op reads current.projectId inside enqueue (TrackerPage.tsx:390-393).
- **T5** (strength): projectGroupKey/priorityGroupKey are the only constructors; group builders and changeProject uncollapse use them; unit tests cover numeric and null→project:none/priority:none (trackerUtils.ts:151-157, 194, 210, 224, 239; TrackerPage.tsx:397; trackerUtils.test.ts:192-210).
- **T5** (strength): Empty phase list reuses TrackerPropertyPicker 'No matches' (no second empty-state UI). Diff is exactly the six scoped files; TrackerPropertyPicker, TrackerPhaseSection, and kebab are untouched.
- **T6** (strength): changePriority reuses applyItemPatch and uncollapseGroupFor; no third optimistic-update path and no second group-uncollapse implementation. changeProject was switched onto the same helper (TrackerPage.tsx:271-282, 410, 432-460). applyItemPatch is 43 lines; changePriority is 29; uncollapseGroupFor is 12 — under the ~50-line handler heuristic.
- **T6** (strength): NO_PRIORITY has one definition in trackerUtils.ts; TrackerProperties, TrackerCreateModal, and TrackerRow import it; both previous local const NO_PRIORITY = 'none' literals are gone (trackerUtils.ts:121; TrackerProperties.tsx:3,81,160; TrackerCreateModal.tsx:4; TrackerRow.tsx:3,117,152).
- **T6** (strength): onPriorityChange is optional on TrackerRow and TrackerSection; TrackerPage supplies it at the TrackerSection call-site; TrackerPhaseSection still omits it and keeps the read-only glyph (TrackerRow.tsx:31,137-162; TrackerSection.tsx:25,107-109; TrackerPage.tsx:668-670; TrackerPhaseSection.tsx:106-111).
- **T6** (strength): Live no-op compares c.priority?.id ?? null inside the applyItemPatch builder after the itemsRef read, not a pre-enqueue capture (TrackerPage.tsx:441-443). Cross-field test locks project version 4 then priority version 5 (TrackerPage.test.tsx:1670-1693).
- **T6** (strength): Scope is exact: the seven listed files, one packet commit 169cc98. TrackerPhaseSection, trackerItemMutationQueue, and kebab are untouched. TrackerRow.tsx is 280 lines (under ~300). Diff-introduced handlers stay under ~50 lines; no 3+ duplicated logic in scope.
- **T7** (Minor): Hidden data-testid probes in production render are justified until T9 wires pickers (and until then they consume labels/members for noUnusedLocals). Remove or replace them when row UI reads that state. — client/src/pages/TrackerPage.tsx:536
- **T7** (strength): Cycle-1 Important cleared: local sibling loadAuxiliary(seq) exists (TrackerPage.tsx:157-172); void loadAuxiliary(seq) runs after setLoading(false) only when primaryOk (TrackerPage.tsx:214-218); loadData is 174-221 (~48 lines, under ~50); independent .catch(() => []) on each fetch; single loadSeqRef check before committing both results (TrackerPage.tsx:169).
- **T7** (strength): Cycle-1 Important cleared: after resolving stale/workspace-A aux promises, tests flush React via await act(async () => { await Promise.resolve(); }) before asserting Sequence-B / empty probes (TrackerPage.test.tsx:2075-2077 and 2178-2180).
- **T7** (strength): Auxiliary requests start in finally after setLoading(false) and only when primaryOk; they never call setLoading or setLoadFailed (TrackerPage.tsx:213-219, 157-172).
- **T7** (strength): Workspace clear is keyed only on activeWorkspaceId, not on ordinary refresh (TrackerPage.tsx:132-135).
- **T7** (strength): No new files; aux loader stays in TrackerPage.tsx. Packet forbids a generic fetch framework; extraction stayed in-file as Step 5 required.
- **T8** (strength): Signature is exactly (currentIds: number[], toggledId: number) => number[] with no tracker-domain types (trackerUtils.ts:287).
- **T8** (strength): resolveToggle body has no TrackerItem / assignees / labels by name; one-liner matches the packet (trackerUtils.ts:287-291).
- **T8** (strength): Consumers import the shared helper; local toggle in TrackerCreateModal and inline toggle-diff in resolvePropertyPatch are gone (TrackerCreateModal.tsx:4, 399-400, 425-426; TrackerDetailPage.tsx:23, 220, 224).
- **T8** (strength): Scope is exact: four listed files, +27/−12. Detail page 611→608 and create modal 532→529 shrank. trackerUtils.ts 285→291 stays under ~300. resolveToggle is 5 lines (under ~50). Implementation exists once — call sites are reuse, not 3+ duplicated logic.
- **T8** (strength): Tests lock the three packet examples through resolveToggle directly with no mocks (trackerUtils.test.ts:44-56).
- **T9** (strength): TrackerRow.tsx is back under ~300 (289 lines) after extracting builders and picker/fallback blocks into TrackerRowMemberLabel.tsx; OpenPicker still includes assignees/labels; the four new props stay optional
- **T9** (strength): changeAssignee/changeLabel enqueue first and let applyItemPatch read itemsRef.current at execution time; they never capture item.assignees/item.labels before enqueue
- **T9** (strength): resolveToggle is imported from trackerUtils and used for both add and remove, not re-implemented
- **T9** (strength): Optimistic assignees are { id: member.userId, username, displayName } TrackerItemAssignee objects; unresolved ids return null and skip the patch
- **T9** (strength): Ordinary failures roll back only assignees or only labels; the 409 tail awaits loadData() so itemsRef is updated before the next queued toggle
- **T9** (strength): members, labels, onAssigneeToggle, and onLabelToggle are optional on TrackerRow; TrackerSection binds item at the Row call-site; TrackerPhaseSection.tsx is unmodified and still omits the four props
- **T9** (strength): Integration suite covers add, remove, live-state race, label add/remove, and the exact 409 PATCH { assigneeIds: [7, 10, 9], version: 9 }
- **T10** (strength): Cycle-1 file-size findings cleared: TrackerRowKebabMenu.tsx 386→106; TrackerRow.tsx 305→277. Chrome (position/dismiss/close+focus) lives in useTrackerRowKebabMenuChrome (trackerRowKebabMenuChrome.ts); six field rows in TrackerRowKebabMenuFields.tsx; kebab trigger wiring in TrackerRowKebabTrigger.tsx. All files under ~300.
- **T10** (strength): TrackerRowKebabMenu is a thin portal shell (74 lines) after the requested chrome/fields split; remaining body is required dialog JSX plus the chrome hook call — not an unsplit mixed-concern function.
- **T10** (strength): TrackerRowKebabMenu is pure composition: no api.updateTrackerItem and no mutation-queue logic; Row-level callbacks are passed through unchanged (TrackerRowKebabTrigger.tsx:94-99; TrackerRowKebabMenu.tsx:96-101; TrackerRowKebabMenuFields.tsx:86, 109, 134, 153-155, 185, 221)
- **T10** (strength): One activeField union; panel portaled and positioned from required anchorRef via computePopoverPosition (trackerRowKebabMenuChrome.ts:34, 115-143; TrackerRowKebabMenu.tsx:60-70)
- **T10** (strength): Close/Escape/outside honor the date child's close contract before onOpenChange(false); focus restore is true→false only
- **T10** (strength): Declared helpers stay in listed scope plus mandated refactor extracts; tests cover all 5 DELIVERABLE GWTs plus Close/Escape date-commit and the zero-handler omission case, with real TrackerRowDatePopover / TrackerPropertyPicker (no component mocks)
- **T11** (strength): Every test mounts TrackerRow directly; TrackerPage is not imported. jsdom harness + hoisted mockNavigate (TrackerRow.test.tsx:1-35, 187-203, 351-387).
- **T11** (strength): Mutex matrix covers all 8 OpenPicker values, date commit-before-switch, and kebab child queries scoped with within(panel) (TrackerRow.test.tsx:242-299).
- **T11** (strength): makeRowItem(overrides) extracted; 3+ fixture constructions share it (TrackerRow.test.tsx:86-105). Test-only range; production ~300/~50 heuristics do not apply.
- **T11** (strength): No API/queue/mutation retesting; on* doubles are vi.fn() only. Diff is TrackerRow.test.tsx only — in listed scope.
- **T11** (strength): T10 kebab-class tests preserved; T11 adds placeholders, two-row independence, read-only createdAt, and navigation isolation without production changes.

## Skipped Tasks

_None_
