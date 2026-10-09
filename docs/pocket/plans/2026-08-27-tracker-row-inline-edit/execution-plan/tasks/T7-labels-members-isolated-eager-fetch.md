# Task T7 — Labels/members isolated eager fetch

**Phase:** 3
**Depends:** T6
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Labels/members isolated eager fetch [depends: T6]

## OBJECTIVE
Add `labels` and `members` fetches to `TrackerPage.tsx`'s `loadData()`, each isolated from the
existing primary `Promise.all([statuses, priorities, projects, items])`, degrading to `[]` on
failure. The auxiliary requests run in parallel after primary data is committed, cannot blank the
list or hold its initial spinner open, and check the same `loadSeqRef` before updating state.

Files:
- Modify: `client/src/pages/TrackerPage.tsx`
- Modify: `client/src/pages/TrackerPage.test.tsx`

Steps:

1. Write the complete failing T7 suite before implementation:
   - labels fetch succeeds and is called with `(workspaceId, "label")`
   - labels fetch failure leaves an existing row visible and does not show the full-page load
     failure UI
   - members fetch failure leaves an existing row visible
   - a stale labels/members response from an older load sequence cannot overwrite the newer
     options. Use manually-controlled promises and invoke the registered refresh callback to
     start the second sequence before resolving the first auxiliary request.
   - switching workspaces clears the previous workspace's labels/members before the new
     auxiliary responses arrive, so stale options cannot be used by an editable row
   Test file: `client/src/pages/TrackerPage.test.tsx`
   Level: integration
   Test doubles: `mockListTrackerVocabularies` and `mockGetWorkspaceMembers`; branch the
   vocabulary mock by kind so status/priority remain successful, and use explicit labels/members
   whose names differ between the old and new sequences.
   Expected RED: the current page never requests labels/members, has no isolated auxiliary
   loader, and has no sequence guard for their responses.

2. Run the complete red suite:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`
   Expected failure: the new labels/members assertions fail before implementation exists.

3. Implement minimal code to satisfy the suite:
   File: `client/src/pages/TrackerPage.tsx`
   Implement: add `const [labels, setLabels] = useState<TrackerVocabulary[]>([])` and
   `const [members, setMembers] = useState<WorkspaceMember[]>([])`. Keep the primary
   `Promise.all([statuses, priorities, projects, items])` unchanged and keep its failure handling
   as the only source of `loadFailed`. After the primary data is committed and the primary
   `setLoading(false)` path has run, start `void loadAuxiliary(seq)` so auxiliary latency cannot
   hold the initial spinner open. Inside that local loader, start both requests in parallel with
   independent fallbacks:
   `api.listTrackerVocabularies(workspaceId, "label").catch(() => [])` and
   `api.getWorkspaceMembers(workspaceId).then((result) => result.members).catch(() => [])`.
   Await that pair, update labels/members only when `seq === loadSeqRef.current`, and discard
   stale results. Every rejection must be converted to its own `[]` fallback and must not escape
   into the primary `loadFailed` branch. Add a workspace-change effect that clears both arrays
   before the new workspace's auxiliary requests can resolve; do not clear them on an ordinary
   same-workspace refresh unless the workspace id changes.

4. Run the complete T7 suite — verify PASS:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

5. Refactor while green: keep the auxiliary loader local to `TrackerPage.tsx`; do not create a
   generic fetch framework for two concrete requests. Re-run:
   `npm run test -- client/src/pages/TrackerPage.test.tsx`

6. Commit:
    `git add client/src/pages/TrackerPage.tsx client/src/pages/TrackerPage.test.tsx`
    `git commit -m "feat(tracker): eagerly fetch labels and members with isolated failure handling"`

## REFERENCES LOADED
`docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md` — Story 4 Rule 2, Example C/D
`client/src/pages/TrackerDetailPage.tsx` — precedent for isolating vocab/member fetch failures from the rest of the page
`client/src/components/tracker/TrackerCreateModal.tsx:92-102` — `getWorkspaceMembers` response shape (`memberList.members`)
`client/src/pages/TrackerPage.test.tsx:222-233` — `mockGetWorkspaceMembers`/`mockListTrackerVocabularies` already mocked with label/member support in `beforeEach`

## WHY THIS APPROACH
Complexity: lightweight
Justification: Additive fetches with a clear, small isolation pattern — no branching logic, no UI changes, mocks for this already exist in the test file's `beforeEach`.

## SANDWICH CONTEXT
[CRITICAL: labels/members fetches must NOT join the existing Promise.all — each needs its own independent try/catch so a failure in either can never blank the item list]
You are implementing Task 7 for Camel's Tracker row inline-editing feature.
Spec: `docs/pocket/spec/2026-08-27-tracker-row-inline-edit/inline-edit-spec.md`
Design decision: isolated fetches, matching TrackerDetailPage's precedent
Files in scope: `client/src/pages/TrackerPage.tsx`, `client/src/pages/TrackerPage.test.tsx`
Available after: T6
Architecture rule: failure isolation — never let labels/members rejection propagate into the existing loadFailed path
[RESTATE: Isolated try/catch per fetch — never joins the main Promise.all]

## DELIVERABLE
Given labels fetch succeeds, When page loads, Then labels state populated
Given labels fetch fails, When page loads, Then labels state is [], item list still renders normally
Given members fetch fails, When page loads, Then members state is [], item list still renders normally
Given an older auxiliary load resolves after a newer primary load, When it tries to update state,
Then its labels/members result is discarded and the newer options remain visible
Given the active workspace changes, When the new auxiliary requests are still pending, Then the
previous workspace's labels and members are already cleared

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Each fetch wrapped in its own try/catch, independent of the other and of the main Promise.all
  - Auxiliary loading starts after the primary loading flag is cleared and never controls the
    full-page spinner or `loadFailed` state
  - The `loadSeqRef` check covers both labels and members before committing either result
  - A workspace change clears stale labels/members before the next auxiliary result is committed
  - Tests written BEFORE implementation

Must-not-have:
  - Joining labels/members into the existing `Promise.all([statuses, priorities, projects, items])`
  - Modifications to files outside listed scope

Open question risks:
  - None specific

Rollback note:
  - Revert removes the two new state variables and fetches; no other behavior affected

## STOP CONDITIONS
Done when: all 5 DELIVERABLE scenarios pass, commit created
Uncertain when: N/A
Escalate when: N/A
