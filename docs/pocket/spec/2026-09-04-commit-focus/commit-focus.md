# Commit Focus — Personal Focus Mode

**Date:** 2026-09-04
**Status:** draft
**Author:** pocket-grinding session (continued from pi-session)
**Spec path:** docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md

---

## Summary

Camel users need a personal, workspace-scoped focus mode that lets them deliberately work on one task at a time with an explicit lifecycle (Focus → Start → Pause/Resume → Finish). The feature removes competing tasks while preserving essential work context, tracks **active time** (excluding pauses) with server-authoritative persistence, and never implicitly changes a task's shared completion status.

---

## Context

### Current State

- Board routing (`/board`, `/board/card/:cardId`) and tracker detail (`/tracker/:key`) already exist (`client/src/App.tsx`).
- `BoardContext` manages active workspace, realtime, and settings — no focus/timer state.
- Persistence is workspace-wide (`settings`, `workspace_settings`); no `(user_id, workspace_id)` personal session primitive.
- Work items span dual tables (`cards` + `tracker_items`) with `source` discriminator and unified mutations via `workItemMutations.ts`.

### Problem / Motivation

Users cannot deliberately narrow attention to one task with a trustworthy duration and safe re-entry. Browser-only or workspace-wide state would break timer trust and personal intent boundaries.

### Related Areas

- `client/src/context/BoardContext.tsx` — workspace switch guard integration
- `client/src/components/ContextPanel.tsx` — board card detail entry
- `client/src/pages/TrackerDetailPage.tsx` — tracker entry
- `client/src/lib/workItemMutations.ts` — task edits from focus surface
- `server/src/routes/work-item-response.ts` — dual-table identity
- `server/src/db/schema.sql` — new `focus_sessions` table required
- `docs/pocket/adr/2026-09-board-tracker-dual-table.md` — ADR #103 constraints

---

## Scope

### In-Scope

- Personal focus: max one active session per `(user_id, workspace_id)`.
- Entry from **ContextPanel** (board card detail) and **TrackerDetailPage** header via **"Focus on this task"** — there is no standalone board card menu today (`CardView.tsx` opens panel only).
- Dedicated focus surface at `/focus` (Direction A) showing only the committed task.
- Lifecycle: Focus (select task, Ready) → Start (Running) → Pause/Resume → Finish focus.
- Active time only; server stores `accumulated_seconds` + `running_since`.
- Full server persistence: refresh, logout/login, multi-tab sync, cross-device.
- Support board cards (`source=board`) and tracker items (`source=tracker`).
- Essential work context in focus surface **v1 (ultra-minimal):** task title, description, and timer/controls only. Status, labels, assignees, due date, activity/changelog, checklist, comments, and attachments are **deferred** — user returns to board/detail for other edits.
- Global **Focus active** indicator in nav for re-entry.
- Confirm-then-switch when replacing focus; old session auto-stopped and Finished.
- Workspace switch blocked for any session state (Ready/Running/Paused) until Finish.
- Task deleted or access revoked → auto-Finish + notification.
- Optimistic locking (`version`) on session mutations; HTTP 409 on stale writes.
- SSE-driven task updates refresh focus surface without exiting focus mode.

### Out-of-Scope

- Shared/workspace-wide focus visible to other members.
- Session history or productivity analytics UI (server records may exist for future use).
- Finish focus → auto Done on task.
- Dual-table migration or unified `work_items` table changes.
- Board layout redesign beyond entry-point actions and focus route.
- Calendar, notification reminders, agent pipeline integration.
- Focus leaderboard or surveillance-style timer UX.

---

## Architecture Constraints

- **May touch:** client routing, focus page/components, focus context/hooks, server routes/services, `focus_sessions` schema + migration, SSE event handlers for session sync.
- **Must NOT touch:** workspace `settings` table for personal state; admin-only settings endpoints; dual-table merge.
- **Patterns:** NodeNext `.js` imports on server; `workItemMutations.ts` for task field edits; `recordActivity()` on session lifecycle mutations; optimistic locking with `version`; existing auth/membership checks.
- **Architecture validation:** PASS

---

## Dependencies

### Existing (to leverage)

- `react-router` — new `/focus` route and navigation from entry points.
- `BoardContext` — workspace membership, SSE subscription, workspace switch hook.
- `workItemMutations.ts` — checklist/comment/status edits from focus surface.
- Kysely + PostgreSQL — `focus_sessions` table.
- Redis Pub/Sub → SSE — multi-tab session sync (same pattern as cards).
- Vitest — client/server tests.

### New

- None. Timer uses server timestamps and accumulated seconds; no new npm packages.

---

## Stories + Scenarios

### Story: Focus on a task

> As a workspace member, I want to focus on one task from board or detail, so that I can work without competing tasks.

**Rule 1: Single session per user/workspace**

```gherkin
Scenario: Focus from board card
  Given user is a member of workspace W with board card C
  When user clicks "Focus on this task" on card C
  Then user navigates to /focus
  And focus surface shows only card C with essential work context
  And session state is Ready (task selected, timer not running)
  And session is persisted with {source: "board", id: C.id}

Scenario: Focus from tracker detail
  Given user is on /tracker/CAM-42 for tracker item T
  When user clicks "Focus on this task"
  Then focus surface shows item T with source=tracker identity preserved

Scenario: Idempotent re-focus on same task
  Given Ready session on task T
  When user clicks "Focus on this task" on task T again
  Then navigate to /focus without confirmation dialog
  And session remains Ready
```

**Rule 2: Direct URL without session**

```gherkin
Scenario: Navigate to /focus without active session
  Given no active focus session in workspace W
  When user opens /focus directly
  Then redirect to /board with no error
```

### Story: Session lifecycle

> As a user in focus mode, I want explicit Start/Pause/Resume/Finish controls, so that timer data is trustworthy.

**Rule 1: Active time only**

```gherkin
Scenario: Start and pause
  Given Ready session with 0 accumulated seconds
  When user clicks Start, waits 10 active minutes, then Pause
  Then displayed duration is ~10 minutes and timer stops

Scenario: Resume accumulates
  Given Paused session with 600 accumulated seconds
  When user Resumes for 5 active minutes then Pauses
  Then accumulated seconds is ~900

Scenario: Server authority on refresh
  Given Running session with 1200 accumulated seconds
  When user refreshes browser
  Then session restores as Running with correct accumulated + running_since
```

**Rule 2: Finish does not complete task**

```gherkin
Scenario: Finish focus preserves task status
  Given Running session on task T in column "In Progress"
  When user clicks "Finish focus"
  Then session ends (no active session)
  And task T remains "In Progress"
  And user returns to the surface they started from (board or detail)

Scenario: New focus after finish
  Given previously Finished session on task T
  When user clicks "Focus on this task" on T again
  Then new Ready session starts with 0 accumulated seconds
```

**Rule 3: API failure on Start**

```gherkin
Scenario: Start fails
  Given Ready session
  When user clicks Start and API returns 5xx
  Then timer does not run in UI
  And session stays Ready
  And user sees retryable error
```

### Story: Cross-tab and cross-device sync

> As a user with multiple tabs/devices, I want one consistent session, so that timer state never diverges.

```gherkin
Scenario: Multi-tab lifecycle sync
  Given Running session in tab A
  When tab B clicks Pause
  Then tab A receives SSE update and shows Paused state with correct duration

Scenario: Stale write rejected
  Given session version 3 in tab A (stale) and version 4 in tab B
  When tab A sends Resume with version 3
  Then server returns HTTP 409
  And tab A refreshes session state from server
```

### Story: Switch focus task

> As a user, I want to change my focused task safely, so that I don't lose data unexpectedly.

```gherkin
Scenario: Confirm switch while Running
  Given Running session on task A with 300 accumulated seconds
  When user focuses on task B and confirms switch
  Then server stops timer on A, accumulates time to switch moment, Finishes A
  And new Ready session on B begins with 0 seconds

Scenario: Cancel switch
  Given Paused session on task A
  When user attempts focus on B but cancels confirmation
  Then session A remains Paused unchanged
```

### Story: Workspace and access guards

```gherkin
Scenario: Block workspace switch
  Given any active session (Ready, Running, or Paused) in W1
  When user attempts workspace switch to W2
  Then switch is blocked with message to Finish focus first

Scenario: Task deleted
  Given active session on task T
  When task T is soft-deleted (card.deleted or tracker.deleted SSE)
  Then session auto-Finishes
  And user sees notification

Scenario: Access revoked
  Given active session in workspace W
  When user is removed from W or loses task access
  Then session auto-Finishes with notification
```

### Story: Work in focus surface

> As a user, I want essential task context in focus mode, so that I don't leave focus to do real work.

```gherkin
Scenario: Read-only task context in focus
  Given focus session on task T with title and description
  When user views focus surface
  Then title and description are visible
  And status, labels, and other fields are not shown in v1
  And user can edit title/description if inline edit is offered, otherwise read-only display

Scenario: External task update via SSE
  Given focus session on task T
  When another user updates T title via realtime
  Then focus surface refreshes title without exiting focus

Scenario: Version conflict on edit
  Given stale task version in focus surface
  When user saves and receives HTTP 409
  Then standard conflict handling (revert + toast) applies
  And user stays on focus surface
```

### Story: Global re-entry

```gherkin
Scenario: Return from board
  Given active session, user navigated to /board
  When user clicks "Focus active" in nav
  Then user returns to /focus with session preserved
```

---

## Acceptance Criteria

```
Rule: Focus entry
  ✓ Given board card C, When "Focus on this task", Then /focus shows C only, Ready state, source+id persisted
  ✓ Given tracker item T, When "Focus on this task", Then /focus shows T with source=tracker
  ✓ Given no session, When open /focus directly, Then redirect to /board
  ✗ Given non-member, When focus API called, Then 404 (matches `requireWorkspaceMember` convention)

Rule: Lifecycle
  ✓ Given Ready, When Start 10m then Pause, Then ~600 accumulated seconds
  ✓ Given Paused 600s, When Resume 5m then Pause, Then ~900s
  ✓ Given Running, When refresh, Then state and duration restored from server
  ✓ Given Running on "In Progress" task, When Finish focus, Then session ends, task status unchanged
  ✓ Given Finished, When focus same task again, Then new Ready session at 0s
  ✗ Given Ready, When Start fails 5xx, Then stays Ready, no timer, error shown

Rule: Concurrency
  ✓ Given two tabs, When Pause in tab B, Then tab A syncs via SSE
  ✗ Given stale version, When mutation, Then HTTP 409 and client refreshes

Rule: Switch task
  ✓ Given Running on A, When confirm switch to B, Then A Finished with accumulated time, B Ready at 0
  ✓ Given Paused on A, When cancel switch to B, Then A unchanged

Rule: Guards
  ✓ Given any session state, When workspace switch attempted, Then blocked until Finish
  ✓ Given session on T, When T deleted, Then auto-Finish + notification
  ✓ Given session, When access revoked, Then auto-Finish + notification

Rule: Work context
  ✓ Given focus on T, When surface loads, Then title + description visible; timer/controls visible
  ✓ Given SSE update on T title, When received, Then title refreshes in place on /focus
```

---

## Design Decision

**Chosen option:** Option A — Board Entry + Dedicated Focus Surface + `focus_sessions` API

**Summary:** Users enter focus from board card or task detail, work on a calm `/focus` page with essential context and lifecycle controls. Server persists session state with optimistic locking; SSE keeps tabs/devices in sync.

**Rejected options:**

- **Option B (Board-native focus mode):** Fails to sufficiently hide board distractions; conflicts with existing board layout, panels, and DnD state. Scenarios for "only one task visible" are harder to satisfy.
- **Option C (Browser-local session):** Fails refresh/cross-device scenarios (Discovery 7: full server persistence). Timer trust degrades on accidental refresh.

**Key tradeoffs accepted:**

- New route + schema + API surface area vs. strongest focus protection.
- Server timer complexity vs. trustworthy active time across devices.
- No session history UI in v1 despite server-side Finish records.

### Proposed technical shape (for pocket-planning)

| Layer | Approach |
|-------|----------|
| Schema | `focus_sessions(user_id, workspace_id, task_source, task_id INTEGER, task_key TEXT nullable, return_path TEXT, state, accumulated_seconds, running_since, version, created_at, updated_at, finished_at)` — unique partial index on active session per user/workspace; logical FK to cards/tracker_items (no cross-table FK) |
| API | `GET/POST/PATCH /workspaces/:id/focus-session` — lifecycle via explicit actions (`focus`, `switch`, `start`, `pause`, `resume`, `finish`); 409 `{ code: "version_conflict", session }` |
| Client | `FocusPage` at `/focus`, `useFocusSession` hook, nav indicator in `AppLayout` header (beside PresenceBar), entry in ContextPanel + TrackerDetailPage |
| Sync | SSE `focus_session.updated` via workspace stream; payload includes `userId` — client **must** filter to current user (privacy; workspace broadcast) |
| Timer display | Client ticks from server `accumulated_seconds` + `running_since` when Running; reconcile on SSE/refresh |

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Logout while Running — timer continues or auto-pause? | assumed: session state persists as-is (Running + running_since); duration accrues until Pause/Finish even if logged out | User may accumulate time while away; acceptable for v1 server-authoritative model |
| Focus surface status change — allowed? | assumed: yes, via workItemMutations; does not end session | Scope creep into board workflow; mitigated by existing mutation routing |
| Session record retention after Finish | assumed: row kept with `finished_at` for future analytics; no UI in v1 | Storage growth minimal per user |
| Workspace switch + unsaved card edits | extend `getSwitchAttemptState` with `hasActiveFocusSession`; focus guard blocks switch; combined dialog if both guards fire | UX friction; rare edge case |
| Activity logging for focus lifecycle | **default: `focus_events` table** (not `card_events`) — mirrors tracker_events shape; defer if v1.1 | Audit gap if deferred |
| `membership.removed` while focused | **confirmed:** auto-finish focus session + toast, then existing workspace redirect (`BoardContext` L542-559) | — |
| Essential context v1 scope | **confirmed:** title + description + timer/controls only; other fields deferred to board/detail | May feel limiting; reduces v1 scope and ship time |
| `FOCUS_MODE_ENABLED` client visibility | server config gate (404 on API) + expose flag via bootstrap (`GET /me` or workspace read) — no `import.meta.env` pattern exists today | Entry points visible if not gated client-side |

---

## Implementation Notes

- Store `return_path` (board or detail URL) on session at Focus time for post-Finish navigation.
- User-facing copy: **"Focus on this task"**, **"Start"**, **"Pause"**, **"Resume"**, **"Finish focus"** — avoid "Commit" in UI (Git/completion ambiguity).
- Task reference: `{source: "board" \| "tracker", id: INTEGER}` plus optional `task_key` for display/reload — never resolve by `key_number` alone (ADR #103).
- Focus page loads task via `api.getCard(id)` (board) or `api.getWorkItem(key)` (tracker) — do not derive card from `BoardContext.columns` (`cardPanel.ts` pattern).
- On workspace switch: extend `getSwitchAttemptState` (`workspaceSwitcher.ts`) with `hasActiveFocusSession` — block until Finish (any Ready/Running/Paused state).
- Switch-focus atomicity: single server transaction (finish old + create new Ready) via `POST` action `switch`.
- Idempotent re-focus: `POST` with same `(source, task_id)` returns existing Ready session.
- Auto-finish triggers: subscribe to `card.deleted`, `tracker.deleted`, `membership.removed` SSE; toast via `showToast`, optional `notifications` row.
- Activity logging: prefer dedicated `focus_events` table over overloading `card_events`.
- Feature flag: `FOCUS_MODE_ENABLED` in server `config.ts`; hide client entry points when flag off via bootstrap.

---

## Rollback Plan

- Disable `FOCUS_MODE_ENABLED` flag — hides entry points and /focus route; existing sessions can be bulk-Finished via migration script.
- Drop `focus_sessions` table only after confirming no active sessions in production (migration down).
- No changes to `cards` or `tracker_items` — rollback does not affect task data.
