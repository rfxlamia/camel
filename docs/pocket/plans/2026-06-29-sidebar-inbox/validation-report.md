# Plan Validation Report: Sidebar Inbox — Notification Center

**Plan:** docs/pocket/plans/2026-06-29-sidebar-inbox/execution-plan.md
**Validated:** 2026-06-30
**Method:** DRY / YAGNI / TDD + codebase-aware gap analysis (verified against live source)
**Resolution:** All findings (C1, C2, W1–W4, I1–I4) applied to `execution-plan.md` on 2026-06-30. Tags `[C1]`/`[C2]`/`[W#]`/`[I#]` mark each change in the plan.

## Executive Summary
- **Critical Issues:** 2 (must fix before execution)
- **Warnings:** 4 (should fix)
- **Info:** 4 (nice to have)
- **Overall Grade:** C+ — approve only after the 2 critical fixes; TDD discipline is otherwise strong.

The plan is well-structured, genuinely test-first, and respects the spec's architecture constraints (in-process EventEmitter, separate user-keyed SSE, no `publishEvent` reuse). Two correctness/coverage gaps block a clean approval: the welcome/member-joined feature never reaches users who join by invite, and the card-assign emit fires duplicate notifications because it is not gated on a real change.

---

## 🚨 CRITICAL (Must Fix)

### C1. Invite-acceptance path is uninstrumented — welcome feature misses its primary audience
**Location:** T4 (file scope = `routes/cards.ts`, `routes/members.ts` only)
**Evidence:** `server/src/routes/invites.ts:58` — `POST /invites/:inviteId/accept` does `INSERT INTO workspace_members (...)`. This is the path a *new* user takes to join a workspace. T4 emits `MEMBER_JOINED` only from `members.ts` (the admin direct-add branch at `members.ts:85`). members.ts also has a second branch (`members.ts:109`) that creates an *invite* for unknown users rather than a membership.
**Impact:** New users who accept an invite get no `welcome` notification, and existing members get no `member_joined` notification — exactly the audience the Welcome Message GWT targets. The plan's out-of-scope list never excludes invites.
**Fix:** Add `routes/invites.ts` to T4's file scope. Emit `MEMBER_JOINED` after the `INSERT INTO workspace_members` at `invites.ts:58`, querying `existingMemberIds` (before insert) and `workspaceName`. Add an emission test mirroring `members.notification.test.ts`.

### C2. Card-assign emit is not gated on a real change → duplicate "phantom" notifications
**Location:** T4 step 3 + T3 idempotency claim + T1 `idx_notifications_idempotency`
**Evidence:** The PATCH handler in `cards.ts` builds a dynamic `sets[]` and runs the `UPDATE ... RETURNING` as its first query (`cards.ts:260`) — there is **no pre-fetch of prior card state**. The unique index `idx_notifications_idempotency (user_id, type, card_id, created_at)` includes `created_at` (default `now()`), so two emits microseconds apart never collide — it provides almost no real dedup.
**Impact:** If Bob PATCHes a card already assigned to Alice (assignee unchanged), `CARD_ASSIGNED` fires again, the unique index does not dedup (different `created_at`), and Alice receives a phantom "Bob assigned X to you." Same class of bug for due-date re-saves.
**Fix (required, not polish):** In T4, add a pre-fetch `SELECT assignee_id, due_date FROM cards WHERE id=$1 ...` before the UPDATE, and gate each emit on an actual change:
- emit `CARD_ASSIGNED` only when `newAssigneeId !== oldAssigneeId`
- emit `CARD_DUE_DATE_CHANGED` / `CARD_DUE_DATE_REMOVED` only when `newDueDate !== oldDueDate`
The pre-fetch also supplies `oldDueDate` for the notification title (the RETURNING clause only gives new state). The plan's T4 test mocks a pre-SELECT but step 3 never instructs the implementer to add it — make it explicit.

---

## ⚡ WARNINGS (Should Fix)

### W1. `workspaceName` is not available in members.ts — title renders "Welcome to undefined!"
**Evidence:** `members.ts` POST never selects the workspace name (verified — no `SELECT name FROM workspaces`). T3 `onMemberJoined` uses `workspaceName` in both the welcome and member_joined titles.
**Fix:** T4 must fetch the workspace name (e.g. `SELECT name FROM workspaces WHERE id=$1`) and include it in the `MEMBER_JOINED` payload, in both members.ts and invites.ts (see C1).

### W2. POST create-with-assignee is documented but untested (TDD miss)
**Evidence:** T4 step 3 lists five emit points, including "after successful card creation with assignee → emit `CARD_ASSIGNED`." `cards.notification.test.ts` covers only PATCH-assignee, DELETE, and PATCH-due-date. One documented behavior has zero failing test.
**Fix:** Add a test that POSTs a card with `assigneeId` and asserts `CARD_ASSIGNED` is emitted — or drop the create-path emit from scope if not required for MVP.

### W3. Duplicate `useNotifications` instances (Sidebar + InboxPage)
**Evidence:** T8 mounts `useNotifications` in both `Sidebar.tsx` and `InboxPage.tsx`. Each opens its own `EventSource` to `/notifications/stream` and its own REST fetch, with independent `unreadCount` state. `BoardContext.tsx:440` already runs a separate board `EventSource`.
**Impact:** Two notification SSE connections + two REST calls per render of `/inbox`; optimistic `markAsRead` in the page does not directly update the sidebar badge (it re-syncs only via the server's SSE fan-out to all the user's connections). Works, but wasteful and fragile.
**Fix:** Lift `useNotifications` into a shared provider (the codebase already centralises SSE/state in `BoardContext` — follow that convention) so badge and page share one connection and one state.

### W4. `idx_notifications_idempotency` does not deliver the idempotency it claims
**Evidence:** Index is `UNIQUE (user_id, type, card_id, created_at)`. Because `created_at` defaults to `now()`, distinct events almost never collide; and `card_id` is NULL for `welcome`/`member_joined`/`system_alert` (NULLs are distinct in a unique index), so it never fires for those types.
**Fix:** Either drop the index (the per-type handlers already guard dedup: actor-exclusion, 24h welcome SELECT, daily partial index for reminders) to avoid implying a guarantee it doesn't provide, or document it explicitly as a same-second retry guard only. Pair with the C2 change-gating, which is the real duplicate defense.

---

## ✨ INFO (Nice to Have)

- **I1. `board_id` column is YAGNI.** `notifications.board_id` (T1) is never written by any handler nor read by any consumer (navigation uses `cardId`). Drop it unless a board-scoped notification is imminent.
- **I2. `withCredentials: true` is over-stated as CRITICAL (T7).** The existing `BoardContext` EventSource omits it and works (same-origin cookies are sent automatically). Harmless, but the "auth fails without it" claim is inaccurate.
- **I3. `export interface Notification` (T7) shadows the DOM global `Notification`.** Harmless here; consider a distinct name if the page ever uses the browser Notification API.
- **I4. T4 DELETE/PATCH test mocks assume query counts that differ from the live handlers.** The soft-delete handler runs a single `UPDATE ... RETURNING` (`cards.ts:311`), not SELECT-then-UPDATE; the PATCH handler likewise has no pre-SELECT today. The mocks pass coincidentally — but once C2's pre-fetch is added, re-verify the mock sequences line up.

---

## What the Plan Gets Right
- **TDD:** Every behavioral task (T2–T8, IT1, IT2) is genuinely test-first with an explicit RED step and expected failure message. T1 is correctly marked `[no-tdd — structural]`.
- **Architecture fidelity:** In-process `EventEmitter` (no Redis), separate user-keyed SSE hub, `registerPush` dependency injection to avoid the service↔sse circular import, no modification of `publishEvent` — all match the spec constraints.
- **Codebase facts verified:** `AuthUser.displayName` exists (`auth.ts:23`); `supertest` is installed; `requireWorkspaceMember`, `validateDueDate`, `createScopedBoardService`, `checkActorCanManage`/`countUserMemberships`/`checkInviteeCap`/`workspaceAccessService` all exist; `cards.due_date` is `DATE`, `columns.is_done` exists; `workspace_settings` and `notifications` genuinely do not exist yet (T1's CREATE-not-ALTER assumption is correct); routes mount pattern (`api.use("/workspaces/:workspaceId", ...)`) matches T5.
- **DRY note:** `sse.ts` duplicating `realtime.ts` SSE boilerplate is spec-mandated (user-keyed vs workspace-keyed) — an accepted separation, not a violation.

## Dismissed Concern
- The T6 "ON CONFLICT only references one index" worry is theoretical: the scheduler runs once/minute and touches each qualifying card once per run, so two `due_date_reminder` rows for the same card differ by ~60s in `created_at` — the general index is never violated and the partial daily index does its job. No action needed.

---

## Recommended Action
Approve **after C1 and C2**. Suggested ordering: fold the invites.ts emit and the change-gating into T4's scope and tests before T4 is dispatched; W1/W2 belong in the same task; W3 can be folded into T7/T8; W4 and the INFO items are cleanups.
