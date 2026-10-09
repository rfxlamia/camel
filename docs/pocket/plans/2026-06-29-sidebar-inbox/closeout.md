# Closeout — 2026-06-29-sidebar-inbox

- **Plan:** docs/pocket/plans/2026-06-29-sidebar-inbox
- **Type:** phased
- **Started:** 2026-06-30  ·  **Closed:** 2026-06-30
- **Baseline SHA:** 83d3ae5aedb8080368dc3be702c29c299c243b6e  ·  **Final SHA:** cde69a17a4ef7b7f0066ee345c91b934f240dca5
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan-phase-1.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T1 | DB Schema Migration | 3751d9e845b44f722e56163f0f1774d80dbf1b4d | REVIEW_PASS |
| T2 | Domain Event Bus | 9a561c9b51c1c98a3021c8a5f8dc7d44e955c51e | REVIEW_PASS |
| T3 | Notification Service Core | 557fd6f0dddc6d9359e338acdaf5dbc7404aed04 | REVIEW_PASS |
| T4 | Route Event Emitters | 6b35d1734ab7a20a5422af8be184861863b99468 | REVIEW_PASS |

_SHA range: 83d3ae5aedb8080368dc3be702c29c299c243b6e..6b35d1734ab7a20a5422af8be184861863b99468_

### Phase 2 — execution-plan-phase-2.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T5 | Notification REST API + SSE Hub | 9897ebddfa820ba1417d4395215d87667436d857 | REVIEW_PASS |
| T6 | Due Date Reminder Scheduler | f0542405b42714e7b65737941a278c82c49fe935 | REVIEW_PASS |
| T7 | Client Notifications Hook + API Layer | 0441aa4fcce54f2f15a5e404853a627b04f95d9b | REVIEW_PASS |

_SHA range: 6b35d1734ab7a20a5422af8be184861863b99468..0441aa4fcce54f2f15a5e404853a627b04f95d9b_

### Phase 3 — execution-plan-phase-3.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T8 | InboxPage + Sidebar Wiring | cde69a17a4ef7b7f0066ee345c91b934f240dca5 | REVIEW_PASS |

_SHA range: 0441aa4fcce54f2f15a5e404853a627b04f95d9b..cde69a17a4ef7b7f0066ee345c91b934f240dca5_

## Carried Forward

Non-blocking observations from review — accepted at close, recorded for follow-up.

- **T1** (Minor): `AT TIME ZONE 'UTC'` in unique index expression — spec says bare `::date`, but implementation is functionally equivalent and arguably more robust. `server/src/db/schema.sql:332`
- **T3** (Minor): `onCardDeleted` silently swallows errors via `void pool.query(...)` — inconsistent with other handlers that have try/catch. Low risk since card deletion is rare. `server/src/notifications/service.ts:129`
- **T3** (Minor): No dedicated test for `card:dueDateRemoved` event — implementation correctly delegates to `onCardDueDateChanged` but a direct test would catch refactoring regressions. `server/src/notifications/service.test.ts`
- **T5** (Minor): Type assertions `(req.user as { id: number })` used throughout router.ts instead of a shared typed interface. `server/src/notifications/router.ts:34`
- **T7** (Minor): `normalizeNotification` handles both camelCase and snake_case keys — could be simplified if server SSE payloads consistently use one format. `client/src/hooks/useNotifications.ts:6-18`
- **T8** (Minor): `markAllAsRead()` is fire-and-forget without error handling on user action — acceptable for non-critical mutation but could surface toast on failure. `client/src/pages/InboxPage.tsx:43`

### Strengths Noted

- **T1**: All `IF NOT EXISTS` guards present, proper FK relationships with ON DELETE clauses, consistent with existing schema patterns
- **T2**: Clean minimal implementation with zero non-Node dependencies, proper `as const` type-safe literals
- **T3**: Clean separation of concerns (event subscription, DB insertion, push delivery), `registerPush()` DI avoids circular imports
- **T4**: Clean change-gating logic with C2 pre-fetch pattern, `MEMBER_JOINED` wired from both membership-insert paths
- **T5**: SSE hub user isolation verified, Last-Event-ID reconnection replay, TDD followed
- **T6**: Clean separation of `runDueDateReminders()` and `startDueDateScheduler()`, per-card try/catch prevents cascade failures
- **T7**: Optimistic updates with rollback-on-failure, good test coverage with custom MockEventSource
- **T8**: Clean component separation with `NotificationItem`, keyboard accessibility (Enter/Space), semantic color tokens per creative-brief

## Skipped Tasks

_None_
