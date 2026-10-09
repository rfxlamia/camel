# EXECUTION PLAN — Sidebar Inbox — Notification Center

**Date:** 2026-06-29
**Spec:** docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
**Status:** draft
**Total tasks:** 10

---

## Execution Overview

### Recommended Order
```
T1, T2 (parallel) → T3, T4 (parallel; T3 needs T1+T2, T4 needs T2) → T5, T6, IT1 (parallel, after T3; IT1 also needs T4) → IT2 (after T3+T5) → T7 → T8
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T1, T2 | — (both prereq) |
| Group B | T3, T4 | T2 (T4); T1+T2 (T3) |
| Group C | T5, T6, IT1 | T3+T4 (IT1); T3 (T5, T6) |
| Serial | IT2 | T3+T5 |
| Serial | T7 | T5 completes |
| Serial | T8 | T7 completes |

### Constraints Reminder
**Architecture:** Use Node EventEmitter (not Redis pub/sub) for domain event bus; separate `/notifications/stream` SSE endpoint (do NOT reuse or modify `publishEvent` pipeline in realtime.ts); notification SSE is user-keyed (not workspace-keyed); server uses NodeNext ESM (.js extensions required on all imports)
**Out-of-scope:** agent events, global cross-workspace inbox, notification preferences, smart grouping/digest, comment/mention notifications, push notifications (browser/mobile), notification expiry/retention automation, bulk aggregation
**Assumptions at risk:** workspace_settings table must be CREATED (not just ALTERed) — it does not exist in schema.sql yet; due date reminder cron uses setInterval check every minute (per spec assumption)
**Sequencing:** Dependency order shown is recommended only — pocket enforces actual blocking rules.

### File Structure Map

```
Rule: DB Schema (notifications table + workspace_settings)
  Modify: server/src/db/schema.sql                              (modified by: T1)

Rule: Domain Event Bus
  Create: server/src/events.ts                                   (created by: T2)
  Test:   server/src/events.test.ts                              (created by: T2)

Rule: Card Assignment + Due Date Change (service core)
  Create: server/src/notifications/service.ts                    (created by: T3)
  Test:   server/src/notifications/service.test.ts               (created by: T3)
  Modify: server/src/index.ts                                    (modified by: T3)

Rule: Route Event Emitters
  Modify: server/src/routes/cards.ts                             (modified by: T4)
  Modify: server/src/routes/members.ts                           (modified by: T4)
  Modify: server/src/routes/invites.ts                           (modified by: T4)
  Test:   server/src/routes/cards.notification.test.ts           (created by: T4)
  Test:   server/src/routes/members.notification.test.ts         (created by: T4)
  Test:   server/src/routes/invites.notification.test.ts         (created by: T4)

Rule: REST API + SSE Delivery
  Create: server/src/notifications/router.ts                     (created by: T5)
  Create: server/src/notifications/sse.ts                        (created by: T5)
  Modify: server/src/routes.ts                                   (modified by: T5)
  Test:   server/src/notifications/router.test.ts                (created by: T5)
  Test:   server/src/notifications/sse.test.ts                   (created by: T5)

Rule: Due Date Reminder
  Create: server/src/notifications/scheduler.ts                  (created by: T6)
  Test:   server/src/notifications/scheduler.test.ts             (created by: T6)
  Modify: server/src/index.ts                                    (modified by: T6)

Rule: Client Hook + API Layer
  Modify: client/src/types.ts                                    (modified by: T7)
  Modify: client/src/api.ts                                      (modified by: T7)
  Create: client/src/hooks/useNotifications.ts                   (created by: T7)
  Test:   client/src/hooks/useNotifications.test.ts              (created by: T7)
  Create: client/src/context/NotificationsContext.tsx           (created by: T7)

Rule: InboxPage + Sidebar Wiring
  Create: client/src/pages/InboxPage.tsx                         (created by: T8)
  Test:   client/src/pages/InboxPage.test.tsx                    (created by: T8)
  Modify: client/src/layout/sidebar/navItems.ts                  (modified by: T8)
  Modify: client/src/layout/sidebar/Sidebar.tsx                  (modified by: T8)
  Modify: client/src/layout/AppLayout.tsx                        (modified by: T8)
  Modify: client/src/App.tsx                                     (modified by: T8)

Rule: Integration Tests
  Test:   server/src/routes/cards-notification.integration.test.ts  (created by: IT1)
  Test:   server/src/notifications/service-sse.integration.test.ts  (created by: IT2)
```

---

## Pocket Packets

---

### Task 1: DB Schema Migration [prereq]

## OBJECTIVE
Add `notifications` table and `workspace_settings` table to `server/src/db/schema.sql`. Both must use `IF NOT EXISTS` guards for idempotent re-runs.

Files:
- Modify: `server/src/db/schema.sql`

Steps:
1. This is a structural task — no behavioral GWT, TDD not applicable. `[no-tdd — structural task]`

2. Append the following SQL to `server/src/db/schema.sql` after the last existing block:

```sql
-- Notification center (2026-06: inbox, domain events, due date reminders)

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id  INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  timezone      TEXT NOT NULL DEFAULT 'UTC'
);

CREATE TABLE IF NOT EXISTS notifications (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  card_id         INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  read_at         TIMESTAMPTZ,
  source_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read_at) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- Due-date reminder: one reminder per user+card per calendar day (scheduler runs every minute)
-- This is the ONLY dedup index. Per-type handlers gate the rest (actor-exclusion, 24h welcome
-- SELECT, and C2 change-gating in the route emitters). No general (user,type,card,created_at)
-- unique index: created_at varies per emit so it never deduped anything real.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_reminder_daily
  ON notifications(user_id, card_id, (created_at::date))
  WHERE type = 'due_date_reminder';
```

3. Verify SQL syntax and idempotency:
   `make db-migrate`
   Expected: migration exits 0, no errors. Re-run produces same result (IF NOT EXISTS guards).

4. Commit:
   `git add server/src/db/schema.sql`
   `git commit -m "chore(db): add notifications table and workspace_settings"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — Data Model section, notifications table + workspace_settings schema
server/src/db/schema.sql — existing pattern: IF NOT EXISTS guards, ALTER TABLE for additions, single migration file

## WHY THIS APPROACH
Complexity: lightweight
Justification: Single file edit, structural only. Follows existing schema.sql convention (idempotent, IF NOT EXISTS, no separate migration files). workspace_settings created fresh (does not exist yet in codebase).

## SANDWICH CONTEXT
[CRITICAL: workspace_settings table does NOT exist — CREATE TABLE, do not ALTER]
You are implementing DB schema migration for Sidebar Inbox — Notification Center.
Spec: docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
Design decision: Domain Event Bus + Notifications Table
Files in scope: `server/src/db/schema.sql` only
Available after: none (prereq)
Architecture rule: Single migration file (schema.sql). All additions use `IF NOT EXISTS`. No separate migration scripts. Re-run must be safe.
[RESTATE: workspace_settings does not exist yet — CREATE TABLE IF NOT EXISTS, not ALTER]

## DELIVERABLE
[no-tdd — structural task]

`make db-migrate` exits 0.
`make db-migrate` run a second time exits 0 with no errors (idempotency).
`notifications` table exists with all columns: id, user_id, workspace_id, type, title, body, card_id, actor_id, read_at, source_deleted, created_at.
`workspace_settings` table exists with columns: workspace_id, timezone.
All three indexes exist: idx_notifications_user_unread, idx_notifications_user_created, idx_notifications_reminder_daily.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All SQL uses `IF NOT EXISTS` guards
  - workspace_settings created with CREATE TABLE (not ALTER)
  - Idempotent: `make db-migrate` twice produces no errors
  - Partial UNIQUE index `idx_notifications_reminder_daily` on (user_id, card_id, (created_at::date)) WHERE type = 'due_date_reminder' — the only dedup index

Must-not-have:
  - Separate migration files / migrations/ directory
  - Any JSONB columns (schema uses typed columns only)
  - A `board_id` column (dropped — never written or read; cardId drives navigation)
  - A general `idx_notifications_idempotency` unique index (dropped — created_at varies per emit, deduped nothing real)
  - Modifications to existing table columns not in scope

Open question risks:
  - None blocking for this task

Rollback note:
  - No rollback plan in spec — if schema breaks, revert schema.sql and re-run migrate

## STOP CONDITIONS
Done when: `make db-migrate` succeeds twice, tables + indexes exist in DB
Escalate when: SQL error in migrate — fix SQL before committing

---

### Task 2: Domain Event Bus [prereq] [parallel: T1]

## OBJECTIVE
Create `server/src/events.ts` — Node EventEmitter singleton, `DomainEvent` interface, and `EVENTS` constants for all notification triggers.

Files:
- Create: `server/src/events.ts`
- Create: `server/src/events.test.ts`

Steps:
1. Write failing test for EventEmitter identity and event constants:
   File: `server/src/events.test.ts`
   Test verifies:
   - `domainBus` is an instance of EventEmitter
   - `EVENTS.CARD_ASSIGNED === "card:assigned"`
   - `EVENTS.CARD_DUE_DATE_CHANGED === "card:dueDateChanged"`
   - `EVENTS.CARD_DUE_DATE_REMOVED === "card:dueDateRemoved"`
   - `EVENTS.MEMBER_JOINED === "member:joined"`
   - `EVENTS.SYSTEM_ALERT === "system:alert"`
   - Emitting CARD_ASSIGNED delivers payload to registered listener

   ```typescript
   import { describe, expect, it } from "vitest";
   import { EventEmitter } from "node:events";
   import { domainBus, EVENTS } from "./events.js";
   import type { DomainEvent } from "./events.js";

   describe("domainBus", () => {
     it("is an EventEmitter", () => {
       expect(domainBus).toBeInstanceOf(EventEmitter);
     });

     it("delivers CARD_ASSIGNED to listener", () => {
       const received: DomainEvent[] = [];
       const payload: DomainEvent = {
         type: EVENTS.CARD_ASSIGNED,
         workspaceId: 1,
         actorId: 2,
         payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix bug" },
       };
       domainBus.once(EVENTS.CARD_ASSIGNED, (e: DomainEvent) => received.push(e));
       domainBus.emit(EVENTS.CARD_ASSIGNED, payload);
       expect(received).toHaveLength(1);
       expect(received[0]).toEqual(payload);
     });
   });

   describe("EVENTS", () => {
     it.each([
       ["CARD_ASSIGNED", "card:assigned"],
       ["CARD_DUE_DATE_CHANGED", "card:dueDateChanged"],
       ["CARD_DUE_DATE_REMOVED", "card:dueDateRemoved"],
       ["MEMBER_JOINED", "member:joined"],
       ["SYSTEM_ALERT", "system:alert"],
       ["CARD_DELETED", "card:deleted"],
     ])("EVENTS.%s === %s", (key, value) => {
       expect(EVENTS[key as keyof typeof EVENTS]).toBe(value);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/events.test.ts`
   Expected failure: `Cannot find module './events.js'`

3. Implement `server/src/events.ts`:
   ```typescript
   import { EventEmitter } from "node:events";

   export interface DomainEvent {
     type: string;
     workspaceId: number;
     actorId: number;
     payload: Record<string, unknown>;
   }

   export const domainBus = new EventEmitter();

   export const EVENTS = {
     CARD_ASSIGNED: "card:assigned",
     CARD_DUE_DATE_CHANGED: "card:dueDateChanged",
     CARD_DUE_DATE_REMOVED: "card:dueDateRemoved",
     MEMBER_JOINED: "member:joined",
     SYSTEM_ALERT: "system:alert",
     CARD_DELETED: "card:deleted",
   } as const;
   ```

4. Run test — verify PASS:
   `npm run test -- server/src/events.test.ts`
   Expected: PASS (all 7 assertions)

5. Commit:
   `git add server/src/events.ts server/src/events.test.ts`
   `git commit -m "feat(notifications): add domain event bus"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — Domain Event Bus section, Event Types (EVENTS constants), DomainEvent interface
server/src/core/wip.test.ts — existing test pattern: describe/it/expect, no mocks needed for pure modules

## WHY THIS APPROACH
Complexity: lightweight
Justification: Pure module, no DB dependency. EventEmitter is Node built-in. EVENTS as const ensures type-safe string literals throughout the codebase.

## SANDWICH CONTEXT
[CRITICAL: domainBus is in-process EventEmitter — do NOT use Redis pub/sub for domain events]
You are implementing the domain event bus for Sidebar Inbox — Notification Center.
Spec: docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
Design decision: Lightweight in-process EventEmitter; notification service subscribes; routes emit
Files in scope: `server/src/events.ts`, `server/src/events.test.ts` only
Available after: none (prereq)
Architecture rule: Must not import from db/, realtime.ts, or any route file — this module has zero dependencies
[RESTATE: domainBus uses Node EventEmitter — no Redis, no external dependencies]

## DELIVERABLE
[derived] Given `domainBus` is imported, When checked, Then it is an instance of node:events EventEmitter
[derived] Given a listener registered on EVENTS.CARD_ASSIGNED, When event emitted with payload, Then listener receives exact payload
[derived] Given EVENTS constants, When accessed, Then all five match their string literals ("card:assigned", "card:dueDateChanged", "card:dueDateRemoved", "member:joined", "system:alert")

All tests PASS. Commit exists with message `feat(notifications): add domain event bus`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `EVENTS` uses `as const` for type-safe string literals
  - `DomainEvent` interface exported (used by all event emitters + service)
  - Zero imports from db/, routes/, or realtime.ts
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Redis or any external broker
  - Any DB imports
  - Agent event types (agent.card.done, etc.) — out of scope

Open question risks:
  - None for this task

## STOP CONDITIONS
Done when: all tests PASS, module has zero non-Node dependencies
Escalate when: any import from db/ or realtime.ts added — remove it

---

### Task 3: Notification Service Core [depends: T1, T2]

## OBJECTIVE
Create `server/src/notifications/service.ts` — subscribes to domain events, inserts notifications into DB with actor exclusion logic, exposes a `registerPush` function for SSE delivery wiring (dependency injection). Register service in `server/src/index.ts` on startup.

Files:
- Create: `server/src/notifications/service.ts`
- Create: `server/src/notifications/service.test.ts`
- Modify: `server/src/index.ts` (call `initNotificationService()` after `initRealtime()`)

Steps:
1. Write failing tests for notification creation logic:
   File: `server/src/notifications/service.test.ts`
   Test verifies actor exclusion, assignee routing, and all GWT rules from spec.

   ```typescript
   import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
   import { domainBus, EVENTS } from "../events.js";

   vi.mock("../db/pool.js", () => ({
     pool: { query: vi.fn() },
   }));

   import { pool } from "../db/pool.js";
   import { initNotificationService } from "./service.js";

   const mockQuery = vi.mocked(pool.query);

   describe("initNotificationService — card:assigned", () => {
     let cleanup: (() => void) | undefined;

     beforeEach(() => {
       mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
       cleanup = initNotificationService();
     });

     afterEach(() => {
       cleanup?.();
       vi.clearAllMocks();
     });

     it("inserts notification when actor != assignee", async () => {
       domainBus.emit(EVENTS.CARD_ASSIGNED, {
         type: EVENTS.CARD_ASSIGNED,
         workspaceId: 1,
         actorId: 7,
         payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix login bug" },
       });
       await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
       const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
       expect(sql).toContain("INSERT INTO notifications");
       expect(params).toContain(3);   // user_id = assigneeId
       expect(params).toContain("card_assigned");
     });

     it("skips notification when actor === assignee (self-assign)", async () => {
       domainBus.emit(EVENTS.CARD_ASSIGNED, {
         type: EVENTS.CARD_ASSIGNED,
         workspaceId: 1,
         actorId: 3,
         payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix login bug" },
       });
       await new Promise((r) => setTimeout(r, 10));
       expect(mockQuery).not.toHaveBeenCalled();
     });

     it("skips notification when assigneeId is null (unassigned)", async () => {
       domainBus.emit(EVENTS.CARD_ASSIGNED, {
         type: EVENTS.CARD_ASSIGNED,
         workspaceId: 1,
         actorId: 7,
         payload: { cardId: 10, assigneeId: null, cardTitle: "Fix login bug" },
       });
       await new Promise((r) => setTimeout(r, 10));
       expect(mockQuery).not.toHaveBeenCalled();
     });
   });

   describe("initNotificationService — card:dueDateChanged", () => {
     let cleanup: (() => void) | undefined;

     beforeEach(() => {
       mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
       cleanup = initNotificationService();
     });

     afterEach(() => {
       cleanup?.();
       vi.clearAllMocks();
     });

     it("inserts notification when actor != assignee", async () => {
       domainBus.emit(EVENTS.CARD_DUE_DATE_CHANGED, {
         type: EVENTS.CARD_DUE_DATE_CHANGED,
         workspaceId: 1,
         actorId: 7,
         payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix login bug", oldDueDate: null, newDueDate: "2026-07-01" },
       });
       await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
       const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
       expect(sql).toContain("INSERT INTO notifications");
     });

     it("skips notification when actor === assignee", async () => {
       domainBus.emit(EVENTS.CARD_DUE_DATE_CHANGED, {
         type: EVENTS.CARD_DUE_DATE_CHANGED,
         workspaceId: 1,
         actorId: 3,
         payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix login bug", oldDueDate: "2026-06-30", newDueDate: "2026-07-01" },
       });
       await new Promise((r) => setTimeout(r, 10));
       expect(mockQuery).not.toHaveBeenCalled();
     });
   });

   describe("initNotificationService — member:joined", () => {
     let cleanup: (() => void) | undefined;

     beforeEach(() => {
       mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
       cleanup = initNotificationService();
     });

     afterEach(() => {
       cleanup?.();
       vi.clearAllMocks();
     });

     it("inserts welcome notification for new member", async () => {
       domainBus.emit(EVENTS.MEMBER_JOINED, {
         type: EVENTS.MEMBER_JOINED,
         workspaceId: 1,
         actorId: 99,
         payload: {
           newMemberId: 5,
           newMemberDisplayName: "Charlie",
           workspaceName: "Team Alpha",
           existingMemberIds: [1, 2],
         },
       });
       await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
       const allCalls = mockQuery.mock.calls.map(([sql]: [string]) => sql);
       expect(allCalls.some((s) => s.includes("INSERT INTO notifications"))).toBe(true);
     });
   });

   describe("initNotificationService — card:deleted (source_deleted)", () => {
     let cleanup: (() => void) | undefined;

     beforeEach(() => {
       mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
       cleanup = initNotificationService();
     });

     afterEach(() => {
       cleanup?.();
       vi.clearAllMocks();
     });

     it("sets source_deleted=true on notifications when card is deleted", async () => {
       domainBus.emit(EVENTS.CARD_DELETED, {
         type: EVENTS.CARD_DELETED,
         workspaceId: 1,
         actorId: 7,
         payload: { cardId: 10 },
       });
       await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
       const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
       expect(sql).toContain("UPDATE notifications");
       expect(sql).toContain("source_deleted = true");
       expect(params).toContain(10); // cardId
     });
   });

   describe("initNotificationService — system:alert", () => {
     let cleanup: (() => void) | undefined;

     beforeEach(() => {
       // First query: fetch all workspace member IDs
       mockQuery
         .mockResolvedValueOnce({ rows: [{ user_id: 1 }, { user_id: 2 }], rowCount: 2 } as never)
         // Subsequent inserts
         .mockResolvedValue({ rows: [], rowCount: 0 } as never);
       cleanup = initNotificationService();
     });

     afterEach(() => {
       cleanup?.();
       vi.clearAllMocks();
     });

     it("inserts system_alert notification for all workspace members", async () => {
       domainBus.emit(EVENTS.SYSTEM_ALERT, {
         type: EVENTS.SYSTEM_ALERT,
         workspaceId: 1,
         actorId: 99,
         payload: { title: "Maintenance at midnight", body: "Server restart at 00:00 UTC" },
       });
       await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(3)); // 1 SELECT + 2 INSERTs
       const [selectSql] = mockQuery.mock.calls[0] as [string];
       expect(selectSql).toContain("workspace_members");
       const insertCalls = mockQuery.mock.calls.slice(1).map(([sql]: [string]) => sql);
       expect(insertCalls.every((s) => s.includes("INSERT INTO notifications"))).toBe(true);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/notifications/service.test.ts`
   Expected failure: `Cannot find module './service.js'`

3. Implement `server/src/notifications/service.ts`:

   ```typescript
   import { pool } from "../db/pool.js";
   import { domainBus, EVENTS, type DomainEvent } from "../events.js";

   type PushFn = (userId: number, workspaceId: number, notification: Record<string, unknown>) => void;
   let pushFn: PushFn = () => {};

   export function registerPush(fn: PushFn): void {
     pushFn = fn;
   }

   async function insertNotification(params: {
     userId: number;
     workspaceId: number;
     type: string;
     title: string;
     body?: string;
     cardId?: number | null;
     actorId?: number | null;
   }): Promise<Record<string, unknown> | null> {
     try {
       const { rows } = await pool.query(
         `INSERT INTO notifications (user_id, workspace_id, type, title, body, card_id, actor_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *`,
         [params.userId, params.workspaceId, params.type, params.title,
          params.body ?? null, params.cardId ?? null, params.actorId ?? null],
       );
       return rows[0] ?? null;
     } catch {
       return null;
     }
   }

   function onCardAssigned(event: DomainEvent): void {
     const { assigneeId, cardId, cardTitle, actorDisplayName } = event.payload as {
       assigneeId: number | null; cardId: number; cardTitle: string; actorDisplayName: string;
     };
     if (!assigneeId || assigneeId === event.actorId) return;
     void insertNotification({
       userId: assigneeId,
       workspaceId: event.workspaceId,
       type: "card_assigned",
       title: `${actorDisplayName} assigned '${cardTitle}' to you`,
       cardId,
       actorId: event.actorId,
     }).then((n) => n && pushFn(assigneeId, event.workspaceId, n));
   }

   function onCardDueDateChanged(event: DomainEvent): void {
     const { assigneeId, cardId, cardTitle, actorDisplayName, oldDueDate, newDueDate } = event.payload as {
       assigneeId: number | null; cardId: number; cardTitle: string;
       actorDisplayName: string; oldDueDate: string | null; newDueDate: string | null;
     };
     if (!assigneeId || assigneeId === event.actorId) return;
     const title = !newDueDate
       ? `${actorDisplayName} removed due date from '${cardTitle}'`
       : oldDueDate
         ? `${actorDisplayName} changed due date of '${cardTitle}' from ${oldDueDate} to ${newDueDate}`
         : `${actorDisplayName} set due date of '${cardTitle}' to ${newDueDate}`;
     void insertNotification({
       userId: assigneeId,
       workspaceId: event.workspaceId,
       type: "due_date_changed",
       title,
       cardId,
       actorId: event.actorId,
     }).then((n) => n && pushFn(assigneeId, event.workspaceId, n));
   }

   function onCardDueDateRemoved(event: DomainEvent): void {
     // Route to same handler with newDueDate = null
     void onCardDueDateChanged({ ...event, payload: { ...event.payload, newDueDate: null } });
   }

   function onMemberJoined(event: DomainEvent): void {
     const { newMemberId, newMemberDisplayName, workspaceName, existingMemberIds } = event.payload as {
       newMemberId: number; newMemberDisplayName: string;
       workspaceName: string; existingMemberIds: number[];
     };
     // Welcome for new member (dedup: check for existing welcome in last 24h)
     void (async () => {
       const { rows } = await pool.query(
         `SELECT id FROM notifications WHERE user_id = $1 AND workspace_id = $2 AND type = 'welcome'
          AND created_at > now() - interval '24 hours' LIMIT 1`,
         [newMemberId, event.workspaceId],
       );
       if (rows.length === 0) {
         const n = await insertNotification({
           userId: newMemberId,
           workspaceId: event.workspaceId,
           type: "welcome",
           title: `Welcome to ${workspaceName}! Start by exploring the board.`,
         });
         if (n) pushFn(newMemberId, event.workspaceId, n);
       }
     })();
     // member_joined for all existing members
     for (const memberId of existingMemberIds) {
       if (memberId === newMemberId) continue;
       void insertNotification({
         userId: memberId,
         workspaceId: event.workspaceId,
         type: "member_joined",
         title: `${newMemberDisplayName} joined ${workspaceName}`,
         actorId: newMemberId,
       }).then((n) => n && pushFn(memberId, event.workspaceId, n));
     }
   }

   function onCardDeleted(event: DomainEvent): void {
     const { cardId } = event.payload as { cardId: number };
     void pool.query(
       "UPDATE notifications SET source_deleted = true WHERE card_id = $1",
       [cardId],
     );
   }

   async function onSystemAlert(event: DomainEvent): Promise<void> {
     const { title, body } = event.payload as { title: string; body?: string };
     const { rows } = await pool.query(
       "SELECT user_id FROM workspace_members WHERE workspace_id = $1",
       [event.workspaceId],
     );
     for (const row of rows) {
       const n = await insertNotification({
         userId: row.user_id,
         workspaceId: event.workspaceId,
         type: "system_alert",
         title,
         body,
         actorId: event.actorId,
       });
       if (n) pushFn(row.user_id, event.workspaceId, n);
     }
   }

   export function initNotificationService(): () => void {
     domainBus.on(EVENTS.CARD_ASSIGNED, onCardAssigned);
     domainBus.on(EVENTS.CARD_DUE_DATE_CHANGED, onCardDueDateChanged);
     domainBus.on(EVENTS.CARD_DUE_DATE_REMOVED, onCardDueDateRemoved);
     domainBus.on(EVENTS.MEMBER_JOINED, onMemberJoined);
     domainBus.on(EVENTS.CARD_DELETED, onCardDeleted);
     domainBus.on(EVENTS.SYSTEM_ALERT, (e: DomainEvent) => { void onSystemAlert(e); });
     return () => {
       domainBus.off(EVENTS.CARD_ASSIGNED, onCardAssigned);
       domainBus.off(EVENTS.CARD_DUE_DATE_CHANGED, onCardDueDateChanged);
       domainBus.off(EVENTS.CARD_DUE_DATE_REMOVED, onCardDueDateRemoved);
       domainBus.off(EVENTS.MEMBER_JOINED, onMemberJoined);
       domainBus.off(EVENTS.CARD_DELETED, onCardDeleted);
       domainBus.off(EVENTS.SYSTEM_ALERT, onSystemAlert);
     };
   }
   ```

4. Run test — verify PASS:
   `npm run test -- server/src/notifications/service.test.ts`
   Expected: PASS (all tests)

5. In `server/src/index.ts`, after `await initRealtime();` add:
   ```typescript
   import { initNotificationService } from "./notifications/service.js";
   // ...
   initNotificationService();
   ```

6. Commit:
   `git add server/src/notifications/service.ts server/src/notifications/service.test.ts server/src/index.ts`
   `git commit -m "feat(notifications): add notification service with domain event subscriptions"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — Notification Types table, Routing Rules (actor exclusion, assignee-only), Rule: Card Assignment GWT, Rule: Due Date Change GWT, Rule: Welcome Message GWT, Rule: Membership Change GWT
server/src/core/wip.test.ts — vi.mock pattern for db/pool
server/src/realtime.ts — pattern for cleanup functions returned from init functions

## WHY THIS APPROACH
Complexity: standard
Justification: Multiple event handlers with routing logic across 3 files. Actor exclusion and null-check logic requires judgment. `registerPush` dependency injection pattern avoids circular import between service.ts and sse.ts (T5 wires itself to T3 at startup, not the reverse).

## SANDWICH CONTEXT
[CRITICAL: service.ts must NOT import from server/src/notifications/sse.ts or realtime.ts — use registerPush() injection]
You are implementing the notification service core for Sidebar Inbox — Notification Center.
Spec: docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
Design decision: EventEmitter bus → service subscribes → DB insert + push via injected function
Files in scope: `server/src/notifications/service.ts`, `server/src/notifications/service.test.ts`, `server/src/index.ts`
Available after: T1 (notifications table in DB), T2 (events.ts + domainBus)
Architecture rule: Do NOT import from realtime.ts or sse.ts — SSE wires itself via registerPush(). Do NOT modify publishEvent pipeline.
[RESTATE: service.ts has no import of sse.ts — push is injected via registerPush()]

## DELIVERABLE
Given user Bob (actorId=7) creates a card with assignee = Alice (assigneeId=3), When CARD_ASSIGNED event emitted, Then INSERT INTO notifications called with user_id=3, type="card_assigned"
Given user Alice (actorId=3) assigns card to herself (assigneeId=3), When CARD_ASSIGNED event emitted, Then no INSERT called (actor exclusion)
Given card has no assignee (assigneeId=null), When CARD_ASSIGNED event emitted, Then no INSERT called
Given card assigned to Alice, When Bob (actorId=7) emits CARD_DUE_DATE_CHANGED, Then INSERT called with type="due_date_changed", user_id=Alice
Given Alice changes her own card due date (actorId=assigneeId), When CARD_DUE_DATE_CHANGED emitted, Then no INSERT called
Given Charlie (newMemberId=5) joins workspace, When MEMBER_JOINED emitted with existingMemberIds=[1,2], Then INSERT called for user_id=5 (welcome) AND user_id=1 AND user_id=2 (member_joined)
Given card id=10 is soft-deleted, When CARD_DELETED emitted, Then UPDATE notifications SET source_deleted=true WHERE card_id=10
Given admin emits SYSTEM_ALERT with title+body for workspaceId=1, When 2 members exist, Then INSERT called twice (user_id=1 and user_id=2) with type="system_alert"
Given new due_date set on card with no prior due date (oldDueDate=null), When CARD_DUE_DATE_CHANGED emitted, Then notification title contains "set due date of ... to {new_date}" (not "from none to")
[must-not] Given actor is assignee, When any card event emitted, Then notification must NOT be inserted

All tests PASS. Commit exists with message matching `feat(notifications): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Actor exclusion: `if (!assigneeId || assigneeId === event.actorId) return` in card handlers
  - `initNotificationService()` returns cleanup function (removes all listeners)
  - `registerPush()` exported for T5 to wire SSE delivery
  - Dedup is handled upstream: actor-exclusion + null-assignee guard here, 24h welcome SELECT, and C2 change-gating in T4 route emitters. No ON CONFLICT on the generic insert (the general unique index was dropped in T1).
  - Tests written BEFORE implementation (TDD)
  - `initNotificationService()` called in index.ts after initRealtime()

Must-not-have:
  - Import of sse.ts or realtime.ts in service.ts
  - Modification of publishEvent or existing SSE channels
  - Agent event handling (agent.card.done etc.) — out of scope

Open question risks:
  - actorDisplayName must be included in event payload by T4 emitters — if T4 omits it, title will be "undefined assigned..." → report NEEDS_CONTEXT

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, service registered in index.ts
Uncertain when: T4 hasn't been written yet — test service by emitting directly on domainBus in tests
Escalate when: circular import between service.ts and any other notifications/* file

---

### Task 4: Route Event Emitters [depends: T2] [parallel: T3]

## OBJECTIVE
Emit domain events from `server/src/routes/cards.ts` (CARD_ASSIGNED, CARD_DUE_DATE_CHANGED, CARD_DUE_DATE_REMOVED, CARD_DELETED) and emit MEMBER_JOINED from BOTH membership-insert paths — `server/src/routes/members.ts` (admin direct-add) and `server/src/routes/invites.ts` (invite acceptance, the path a new user actually takes to join). Include all payload fields required by T3 service handlers. Card emits are **gated on an actual change** (assignee/due_date differs from prior state) to prevent duplicate notifications.

Files:
- Modify: `server/src/routes/cards.ts`
- Modify: `server/src/routes/members.ts`
- Modify: `server/src/routes/invites.ts`

Steps:
1. Write failing test that exercises the actual route handler via supertest:
   File: `server/src/routes/cards.notification.test.ts`
   Test verifies: CARD_ASSIGNED emitted from cardsRouter after successful PATCH, CARD_DELETED emitted after soft-delete.

   ```typescript
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import express from "express";
   import request from "supertest";
   import { domainBus, EVENTS } from "../events.js";

   vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));
   vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
   vi.mock("./helpers.js", () => ({
     lookupMembership: vi.fn().mockResolvedValue("member"),
     parseWorkspaceId: vi.fn((id: string) => Number(id)),
     recordActivity: vi.fn().mockResolvedValue(undefined),
     createScopedBoardService: vi.fn(),
   }));
   vi.mock("../middleware/workspace.js", () => ({
     requireWorkspaceMember: (_req: unknown, _res: unknown, next: () => void) => next(),
   }));
   vi.mock("../validators/input-length.js", () => ({
     validateCardTitle: vi.fn().mockReturnValue({ valid: true }),
     validateCardDescription: vi.fn().mockReturnValue({ valid: true }),
     validateDueDate: vi.fn().mockReturnValue({ valid: true }),
   }));

   import { pool } from "../db/pool.js";
   import { cardsRouter } from "./cards.js";

   const mockQuery = vi.mocked(pool.query);

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
     (req as Record<string, unknown>).user = { id: 7, displayName: "Bob" };
     next();
   });
   app.use("/workspaces/:workspaceId", cardsRouter);

   describe("cards route — CARD_ASSIGNED event emission", () => {
     beforeEach(() => vi.clearAllMocks());

     it("emits CARD_ASSIGNED when card is PATCHed with a new assignee", async () => {
       mockQuery
         // SELECT existing card (assignee_id = null)
         .mockResolvedValueOnce({ rows: [{ id: 10, workspace_id: 1, column_id: 1, title: "Fix bug", description: "", position: 1024, version: 1, assignee_id: null, due_date: null, deleted_at: null }], rowCount: 1 } as never)
         // UPDATE card returning new state
         .mockResolvedValueOnce({ rows: [{ id: 10, workspace_id: 1, column_id: 1, title: "Fix bug", description: "", position: 1024, version: 2, assignee_id: 3, due_date: null }], rowCount: 1 } as never)
         // recordActivity + any other queries
         .mockResolvedValue({ rows: [], rowCount: 0 } as never);

       const received: unknown[] = [];
       domainBus.once(EVENTS.CARD_ASSIGNED, (e) => received.push(e));

       await request(app)
         .patch("/workspaces/1/cards/10")
         .send({ assigneeId: 3, version: 1 });

       // FAILS before T4 implementation (emit not yet added to cards.ts)
       expect(received).toHaveLength(1);
       expect((received[0] as { payload: { assigneeId: number } }).payload.assigneeId).toBe(3);
       expect((received[0] as { payload: { actorDisplayName: string } }).payload.actorDisplayName).toBe("Bob");
     });
   });

   describe("cards route — CARD_DELETED event emission", () => {
     beforeEach(() => vi.clearAllMocks());

     it("emits CARD_DELETED when card is soft-deleted", async () => {
       mockQuery
         // Live handler does a SINGLE query: UPDATE cards SET deleted_at = now() ... RETURNING title, column_id
         .mockResolvedValueOnce({ rows: [{ title: "Fix bug", column_id: 1 }], rowCount: 1 } as never)
         // recordActivity + anything after
         .mockResolvedValue({ rows: [], rowCount: 0 } as never);

       const received: unknown[] = [];
       domainBus.once(EVENTS.CARD_DELETED, (e) => received.push(e));

       await request(app).delete("/workspaces/1/cards/10");

       // FAILS before T4 implementation (emit not yet added to cards.ts)
       expect(received).toHaveLength(1);
       expect((received[0] as { payload: { cardId: number } }).payload.cardId).toBe(10);
     });
   });

   describe("cards route — CARD_DUE_DATE_CHANGED event emission", () => {
     beforeEach(() => vi.clearAllMocks());

     it("emits CARD_DUE_DATE_CHANGED when due_date is PATCHed on assigned card", async () => {
       mockQuery
         // SELECT existing card (assignee_id = 3, due_date = null)
         .mockResolvedValueOnce({ rows: [{ id: 10, workspace_id: 1, column_id: 1, title: "Fix bug", description: "", position: 1024, version: 1, assignee_id: 3, due_date: null, deleted_at: null }], rowCount: 1 } as never)
         // UPDATE card returning new state with due_date
         .mockResolvedValueOnce({ rows: [{ id: 10, workspace_id: 1, column_id: 1, title: "Fix bug", description: "", position: 1024, version: 2, assignee_id: 3, due_date: "2026-07-01" }], rowCount: 1 } as never)
         .mockResolvedValue({ rows: [], rowCount: 0 } as never);

       const received: unknown[] = [];
       domainBus.once(EVENTS.CARD_DUE_DATE_CHANGED, (e) => received.push(e));

       await request(app)
         .patch("/workspaces/1/cards/10")
         .send({ dueDate: "2026-07-01", version: 1 });

       // FAILS before T4 implementation (emit not yet added to cards.ts)
       expect(received).toHaveLength(1);
       expect((received[0] as { payload: { newDueDate: string } }).payload.newDueDate).toBe("2026-07-01");
     });
   });
   ```

   Also create `server/src/routes/members.notification.test.ts` covering `MEMBER_JOINED` emission:

   ```typescript
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import express from "express";
   import request from "supertest";
   import { domainBus, EVENTS } from "../events.js";

   vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));
   vi.mock("./helpers.js", () => ({
     lookupMembership: vi.fn(),
     checkActorCanManage: vi.fn(),
     countUserMemberships: vi.fn(),
     checkInviteeCap: vi.fn(),
     workspaceAccessService: vi.fn(),
     parseWorkspaceId: vi.fn((id: string) => Number(id)),
     recordActivity: vi.fn().mockResolvedValue(undefined),
   }));
   vi.mock("../middleware/workspace.js", () => ({
     requireWorkspaceMember: (_req: unknown, _res: unknown, next: () => void) => next(),
   }));

   import { pool } from "../db/pool.js";
   import {
     lookupMembership,
     checkActorCanManage,
     countUserMemberships,
     checkInviteeCap,
   } from "./helpers.js";
   import { membersRouter } from "./members.js";

   const mockQuery = vi.mocked(pool.query);

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
     (req as Record<string, unknown>).user = { id: 99, displayName: "Admin" };
     next();
   });
   app.use("/workspaces/:workspaceId", membersRouter);

   describe("members route — MEMBER_JOINED event emission", () => {
     beforeEach(() => {
       vi.clearAllMocks();
       vi.mocked(lookupMembership)
         .mockResolvedValueOnce("admin")  // actor role check
         .mockResolvedValueOnce(null);    // target not yet a member
       vi.mocked(checkActorCanManage).mockReturnValue({ allowed: true } as never);
       vi.mocked(countUserMemberships).mockResolvedValue(0);
       vi.mocked(checkInviteeCap).mockReturnValue({ ok: true } as never);
     });

     it("emits MEMBER_JOINED after successful member insert with existingMemberIds", async () => {
       mockQuery
         // SELECT user by username
         .mockResolvedValueOnce({ rows: [{ id: 5, username: "charlie", display_name: "Charlie" }], rowCount: 1 } as never)
         // SELECT existing members BEFORE insert (new query added by T4)
         .mockResolvedValueOnce({ rows: [{ user_id: 1 }, { user_id: 2 }], rowCount: 2 } as never)
         // SELECT workspace name (new query added by T4 — W1)
         .mockResolvedValueOnce({ rows: [{ name: "Team Alpha" }], rowCount: 1 } as never)
         // INSERT INTO workspace_members
         .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
         .mockResolvedValue({ rows: [], rowCount: 0 } as never);

       const received: unknown[] = [];
       domainBus.once(EVENTS.MEMBER_JOINED, (e) => received.push(e));

       await request(app)
         .post("/workspaces/1/members")
         .send({ username: "charlie" });

       // FAILS before T4 implementation (emit not yet added to members.ts)
       expect(received).toHaveLength(1);
       const event = received[0] as { payload: { newMemberId: number; existingMemberIds: number[] } };
       expect(event.payload.newMemberId).toBe(5);
       expect(event.payload.existingMemberIds).toEqual([1, 2]);
     });
   });
   ```

2. Run tests — verify FAIL:
   `npm run test -- server/src/routes/cards.notification.test.ts`
   `npm run test -- server/src/routes/members.notification.test.ts`
   Expected failure: `expect(received).toHaveLength(1)` — received is empty because no emit in cards.ts/members.ts yet

3. Modify `server/src/routes/cards.ts` — add event emission:
   - Import: `import { domainBus, EVENTS } from "../events.js";`

   **[C2 — required] Pre-fetch prior card state in the PATCH handler.** The current PATCH
   handler runs its `UPDATE ... RETURNING` as the first query (no prior SELECT), so it cannot
   tell whether the assignee/due_date actually changed and has no `oldDueDate` for the title.
   Before the UPDATE, add:
   ```typescript
   const prevRes = await pool.query(
     "SELECT assignee_id, due_date::text AS due_date FROM cards WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
     [cardId, workspaceId],
   );
   const prev = prevRes.rows[0]; // { assignee_id, due_date } or undefined
   ```
   Then **gate every emit on an actual change** (the RETURNING row gives the new state):

   - Card POST with a non-null assignee: emit `EVENTS.CARD_ASSIGNED`.
   - Card PATCH where `newAssigneeId !== prev.assignee_id` AND `newAssigneeId != null`: emit `EVENTS.CARD_ASSIGNED`. (Do NOT emit when the PATCH includes `assigneeId` unchanged.)
   - Card PATCH where `newDueDate !== prev.due_date` AND `newDueDate != null`: emit `EVENTS.CARD_DUE_DATE_CHANGED` with `oldDueDate: prev.due_date ?? null`.
   - Card PATCH where `newDueDate !== prev.due_date` AND `newDueDate == null` (cleared): emit `EVENTS.CARD_DUE_DATE_REMOVED`.
   - After successful card soft-delete (DELETE /cards/:id → `UPDATE cards SET deleted_at = now()` succeeds, rowCount > 0): emit `EVENTS.CARD_DELETED`.

   > Without this gating a repeat PATCH that re-sends an unchanged assignee re-fires CARD_ASSIGNED;
   > there is no general unique index to swallow it (dropped in T1), so the assignee gets a phantom
   > "X assigned … to you". Gating is the dedup.

   Payload shape for CARD_DELETED:
   ```typescript
   domainBus.emit(EVENTS.CARD_DELETED, {
     type: EVENTS.CARD_DELETED,
     workspaceId,
     actorId: req.user!.id,
     payload: { cardId: card.id },
   });
   ```

   Payload shape for CARD_ASSIGNED:
   ```typescript
   domainBus.emit(EVENTS.CARD_ASSIGNED, {
     type: EVENTS.CARD_ASSIGNED,
     workspaceId,
     actorId: req.user!.id,
     payload: {
       cardId: card.id,
       assigneeId: newAssigneeId,
       cardTitle: card.title,
       actorDisplayName: req.user!.displayName,
     },
   });
   ```

   Payload shape for CARD_DUE_DATE_CHANGED:
   ```typescript
   domainBus.emit(EVENTS.CARD_DUE_DATE_CHANGED, {
     type: EVENTS.CARD_DUE_DATE_CHANGED,
     workspaceId,
     actorId: req.user!.id,
     payload: {
       cardId: card.id,
       assigneeId: card.assigneeId ?? null,   // new assignee from RETURNING row
       cardTitle: card.title,
       actorDisplayName: req.user!.displayName,
       oldDueDate: prev?.due_date ?? null,    // from the C2 pre-fetch, NOT the RETURNING row
       newDueDate: newDueDate,
     },
   });
   ```

4. Modify `server/src/routes/members.ts` — after successful `INSERT INTO workspace_members` (the admin direct-add branch, `members.ts:85`):
   - Import: `import { domainBus, EVENTS } from "../events.js";`
   - **[W1 — required]** members.ts does NOT currently select the workspace name. Fetch it (one query) so the title is not "Welcome to undefined!".
   - Query existing member IDs BEFORE the insert (so the new member is excluded), then emit:
   ```typescript
   const existingRes = await pool.query(
     "SELECT user_id FROM workspace_members WHERE workspace_id = $1",
     [workspaceId],
   );
   const existingMemberIds = existingRes.rows.map((r: { user_id: number }) => r.user_id);

   const wsRes = await pool.query("SELECT name FROM workspaces WHERE id = $1", [workspaceId]);
   const workspaceName = wsRes.rows[0]?.name ?? "the workspace";

   await pool.query(`INSERT INTO workspace_members ...`);

   domainBus.emit(EVENTS.MEMBER_JOINED, {
     type: EVENTS.MEMBER_JOINED,
     workspaceId,
     actorId: req.user!.id,
     payload: {
       newMemberId: target.id,
       newMemberDisplayName: target.display_name,
       workspaceName,
       existingMemberIds,
     },
   });
   ```

4b. **[C1 — required] Modify `server/src/routes/invites.ts`** — this is the path a genuinely new
    user takes to join (accepting an invite), and it `INSERT INTO workspace_members` at
    `invites.ts:58`. Without instrumenting it, new users never get a `welcome` and existing
    members never get `member_joined` — the Welcome Message GWT's primary audience is missed.
    - Import: `import { domainBus, EVENTS } from "../events.js";`
    - BEFORE the membership insert, capture `existingMemberIds` (same SELECT as members.ts) and the
      accepting user's display name + the workspace name.
    - AFTER the insert succeeds, emit `EVENTS.MEMBER_JOINED` with the same payload shape:
    ```typescript
    domainBus.emit(EVENTS.MEMBER_JOINED, {
      type: EVENTS.MEMBER_JOINED,
      workspaceId,
      actorId: req.user!.id,                  // the accepting user
      payload: {
        newMemberId: req.user!.id,            // accepting user is the new member
        newMemberDisplayName: req.user!.displayName,
        workspaceName,                        // SELECT name FROM workspaces WHERE id = $1
        existingMemberIds,                    // captured BEFORE the insert
      },
    });
    ```
    - Add a failing emission test `server/src/routes/invites.notification.test.ts` mirroring
      `members.notification.test.ts` (mock the same helpers/pool, assert MEMBER_JOINED emitted with
      `newMemberId = accepting user`, `existingMemberIds` excludes them).

5. **[W2 — required]** Add a failing test in `cards.notification.test.ts` for the **create-with-assignee**
   path: POST a card with `assigneeId` set, assert `CARD_ASSIGNED` is emitted (this emit point is
   documented in step 3 but currently has no test). Also add a PATCH test asserting CARD_ASSIGNED is
   **NOT** emitted when the assignee is unchanged (the C2 gating invariant).

6. Run tests:
   `npm run test --workspace=server`
   Expected: All existing tests still PASS. New emission test PASS.

7. Commit:
   `git add server/src/routes/cards.ts server/src/routes/members.ts server/src/routes/invites.ts server/src/routes/cards.notification.test.ts server/src/routes/members.notification.test.ts server/src/routes/invites.notification.test.ts`
   `git commit -m "feat(notifications): emit domain events from card, member, and invite routes"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — Domain Event Bus section (Route Handler Integration example), Notification Types table (payload fields required by service)
server/src/routes/cards.ts — existing card PATCH/POST structure, req.user shape
server/src/routes/members.ts — existing member POST structure

## WHY THIS APPROACH
Complexity: standard
Justification: Three existing files (cards, members, invites). Card emits require a pre-fetch SELECT and change-comparison gating (C2) to avoid duplicate notifications; MEMBER_JOINED must be wired from both membership-insert paths (C1), and workspaceName fetched where absent (W1). More than mechanical — emit conditions carry judgment.

## SANDWICH CONTEXT
[CRITICAL: emit events ONLY after successful DB write — never before or on error paths]
You are wiring domain event emission for Sidebar Inbox — Notification Center.
Spec: docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
Design decision: Route handlers emit to domainBus; notification service subscribes
Files in scope: `server/src/routes/cards.ts`, `server/src/routes/members.ts`, `server/src/routes/invites.ts`, `server/src/routes/cards.notification.test.ts`, `server/src/routes/members.notification.test.ts`, `server/src/routes/invites.notification.test.ts`
Available after: T2 (events.ts exists)
Architecture rule: Emit AFTER successful DB write only. Do not emit on error branches. Do not await domainBus.emit() (EventEmitter is synchronous). Do not modify publishEvent or workspace SSE.
[RESTATE: domainBus.emit() is synchronous — no await needed; call it after pool.query succeeds]

## DELIVERABLE
[derived] Given Bob (req.user.id=7) PATCHes a card to set assignee_id=3, When DB update succeeds, Then CARD_ASSIGNED emitted with payload.assigneeId=3, payload.actorDisplayName="Bob"
[derived] Given Bob changes due_date from "2026-06-30" to "2026-07-01", When DB update succeeds, Then CARD_DUE_DATE_CHANGED emitted with oldDueDate="2026-06-30", newDueDate="2026-07-01"
[derived] Given Bob removes due_date (sets to null), When DB update succeeds, Then CARD_DUE_DATE_REMOVED emitted
[derived] Given Charlie is admin-added via POST /members, When INSERT into workspace_members succeeds, Then MEMBER_JOINED emitted with newMemberId=Charlie.id, workspaceName set, existingMemberIds=[...all current members]
[derived] Given a new user accepts an invite via POST /invites/:id/accept, When INSERT into workspace_members succeeds, Then MEMBER_JOINED emitted with newMemberId=acceptingUser.id [C1]
[derived] Given card id=10 is soft-deleted via DELETE /cards/10, When UPDATE cards SET deleted_at succeeds, Then CARD_DELETED emitted with payload.cardId=10
[derived] Given POST /cards with assigneeId=3, When create succeeds, Then CARD_ASSIGNED emitted with assigneeId=3 [W2]
[must-not] Given a PATCH re-sends the SAME assignee (unchanged), When update succeeds, Then CARD_ASSIGNED must NOT be emitted [C2]
[must-not] Given DB write fails, When error is thrown, Then event must NOT be emitted

All tests PASS. Commit exists with message matching `feat(notifications): emit domain events ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - actorDisplayName included in all event payloads (required by T3 service for notification title)
  - workspaceName included in MEMBER_JOINED payload from BOTH paths (fetched, not assumed available) [W1]
  - MEMBER_JOINED emitted from BOTH `members.ts` (admin add) AND `invites.ts` (invite accept) [C1]
  - Card emits gated on actual change via the pre-fetch: CARD_ASSIGNED only when assignee differs and is non-null; due-date emits only when due_date differs [C2]
  - Events emitted only in success path (after `pool.query` resolves)
  - `existingMemberIds` queried BEFORE the new member insert (both paths)
  - CARD_DELETED emitted from the soft-delete path in cards.ts (after `UPDATE cards SET deleted_at = now()`)
  - Tests written BEFORE implementation (TDD), including the create-with-assignee emit and the unchanged-assignee no-emit [W2]
  - Test files: `cards.notification.test.ts`, `members.notification.test.ts`, `invites.notification.test.ts` (add invites file to File Structure Map)

Must-not-have:
  - Emitting on error branches
  - Emitting CARD_ASSIGNED / CARD_DUE_DATE_* when the value did not change [C2]
  - Awaiting domainBus.emit (it's synchronous)
  - Modifying workspace SSE (publishEvent) calls

Open question risks:
  - req.user.displayName — confirmed present on AuthUser (`auth.ts:23`), no longer a blocker

## STOP CONDITIONS
Done when: all server tests pass; gated CARD_ASSIGNED/CARD_DUE_DATE_CHANGED/CARD_DUE_DATE_REMOVED/CARD_DELETED emitted from cards.ts; MEMBER_JOINED emitted from BOTH members.ts and invites.ts
Escalate when: invites.ts acceptance flow is structured so existingMemberIds/workspaceName cannot be captured before the insert → report NEEDS_CONTEXT

---

### Task 5: Notification REST API + SSE Hub [depends: T3]

## OBJECTIVE
Create `server/src/notifications/sse.ts` (user-keyed SSE hub) and `server/src/notifications/router.ts` (REST + SSE endpoints). Wire SSE hub to notification service via `registerPush()`. Mount router in `server/src/routes.ts`.

Files:
- Create: `server/src/notifications/sse.ts`
- Create: `server/src/notifications/router.ts`
- Create: `server/src/notifications/router.test.ts`
- Modify: `server/src/routes.ts`

Steps:
1. Write failing tests for REST endpoints:
   File: `server/src/notifications/router.test.ts`

   ```typescript
   import { describe, expect, it, vi, beforeEach } from "vitest";

   vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));
   vi.mock("../auth.js", () => ({
     requireAuth: vi.fn((req: { user?: unknown }, _res: unknown, next: () => void) => {
       req.user = { id: 1, displayName: "Alice" };
       next();
     }),
   }));
   vi.mock("../middleware/workspace.js", () => ({
     requireWorkspaceMember: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
   }));

   import { pool } from "../db/pool.js";
   import { domainBus, EVENTS } from "../events.js";
   import express from "express";
   import request from "supertest";
   import { notificationsRouter } from "./router.js";

   const mockQuery = vi.mocked(pool.query);
   const app = express();
   app.use(express.json());
   app.use("/workspaces/:workspaceId/notifications", notificationsRouter);

   describe("GET /workspaces/:workspaceId/notifications", () => {
     beforeEach(() => vi.clearAllMocks());

     it("returns notifications list with unreadCount", async () => {
       mockQuery
         .mockResolvedValueOnce({ rows: [{ id: 1, type: "card_assigned", title: "Bob assigned...", read_at: null, source_deleted: false, created_at: new Date().toISOString(), card_id: 10, actor_id: 7 }], rowCount: 1 } as never)
         .mockResolvedValueOnce({ rows: [{ count: "2" }], rowCount: 1 } as never);

       const res = await request(app).get("/workspaces/1/notifications");
       expect(res.status).toBe(200);
       expect(res.body).toHaveProperty("notifications");
       expect(res.body).toHaveProperty("unreadCount", 2);
     });
   });

   describe("PATCH /workspaces/:workspaceId/notifications/:id/read", () => {
     it("marks notification as read", async () => {
       mockQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 } as never);
       const res = await request(app).patch("/workspaces/1/notifications/1/read");
       expect(res.status).toBe(200);
       expect(res.body).toEqual({ ok: true });
     });

     it("returns 404 for unknown notification", async () => {
       mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
       const res = await request(app).patch("/workspaces/1/notifications/999/read");
       expect(res.status).toBe(404);
     });
   });

   describe("POST /workspaces/:workspaceId/notifications/read-all", () => {
     it("marks all as read and returns markedCount", async () => {
       mockQuery.mockResolvedValue({ rows: [], rowCount: 5 } as never);
       const res = await request(app).post("/workspaces/1/notifications/read-all");
       expect(res.status).toBe(200);
       expect(res.body).toEqual({ ok: true, markedCount: 5 });
     });
   });

   describe("POST /workspaces/:workspaceId/notifications/system-alert", () => {
     it("returns 202 when admin posts a system alert", async () => {
       // role lookup returns admin
       mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }], rowCount: 1 } as never);
       const spy = vi.spyOn(domainBus, "emit");

       const res = await request(app)
         .post("/workspaces/1/notifications/system-alert")
         .send({ title: "Maintenance tonight", body: "Server restart at midnight" });

       expect(res.status).toBe(202);
       expect(spy).toHaveBeenCalledWith(
         EVENTS.SYSTEM_ALERT,
         expect.objectContaining({ payload: expect.objectContaining({ title: "Maintenance tonight" }) }),
       );
       spy.mockRestore();
     });

     it("returns 403 when non-admin posts a system alert", async () => {
       mockQuery.mockResolvedValueOnce({ rows: [{ role: "member" }], rowCount: 1 } as never);
       const res = await request(app)
         .post("/workspaces/1/notifications/system-alert")
         .send({ title: "Alert" });
       expect(res.status).toBe(403);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/notifications/router.test.ts`
   Expected failure: `Cannot find module './router.js'`

2b. Also write failing unit test for the user-keyed isolation invariant in `sse.ts`:
    File: `server/src/notifications/sse.test.ts`

    ```typescript
    import { describe, expect, it, vi, afterEach } from "vitest";
    import type { Request, Response } from "express";

    vi.mock("../db/pool.js", () => ({
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    }));

    import { sseNotificationHandler, pushNotificationToUser } from "./sse.js";

    describe("pushNotificationToUser — user-keyed isolation", () => {
      vi.useFakeTimers();

      const closeHandlers: Array<() => void> = [];

      afterEach(() => {
        closeHandlers.forEach((fn) => fn());
        closeHandlers.length = 0;
        vi.clearAllMocks();
      });

      it("delivers to matching userId only — other connected users are NOT notified", async () => {
        const write1 = vi.fn();
        const write2 = vi.fn();

        const makeReq = (userId: number) => {
          let closeCb: () => void = () => {};
          const req = {
            user: { id: userId },
            params: { workspaceId: "1" },
            headers: {},
            on: (event: string, cb: () => void) => { if (event === "close") closeCb = cb; },
          } as unknown as Request;
          return { req, close: () => closeCb() };
        };

        const c1 = makeReq(1);
        const c2 = makeReq(2);
        const res1 = { writeHead: vi.fn(), write: write1 } as unknown as Response;
        const res2 = { writeHead: vi.fn(), write: write2 } as unknown as Response;

        await sseNotificationHandler(c1.req, res1);
        await sseNotificationHandler(c2.req, res2);
        closeHandlers.push(c1.close, c2.close);

        // Clear initial ": connected\n\n" writes
        write1.mockClear();
        write2.mockClear();

        pushNotificationToUser(1, 1, { id: 42, type: "card_assigned", title: "Assigned!" });

        expect(write1).toHaveBeenCalledOnce();
        expect(write1.mock.calls[0][0]).toContain("notification.created");
        expect(write2).not.toHaveBeenCalled();
      });
    });
    ```

    Run test — verify FAIL:
    `npm run test -- server/src/notifications/sse.test.ts`
    Expected failure: `Cannot find module './sse.js'`

3. Implement `server/src/notifications/sse.ts` — user-keyed SSE hub:

   ```typescript
   import type { Request, Response } from "express";

   interface SseClient {
     userId: number;
     workspaceId: number;
     lastEventId: number;
     res: Response;
     keepAlive: ReturnType<typeof setInterval>;
   }

   const clients = new Set<SseClient>();

   export async function sseNotificationHandler(req: Request, res: Response): Promise<void> {
     const userId = (req.user as { id: number }).id;
     const workspaceId = Number(req.params.workspaceId);
     const lastEventId = Number(req.headers["last-event-id"] ?? 0) || 0;

     res.writeHead(200, {
       "Content-Type": "text/event-stream",
       "Cache-Control": "no-cache",
       Connection: "keep-alive",
     });
     res.write(": connected\n\n");

     const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
     const client: SseClient = { userId, workspaceId, lastEventId, res, keepAlive };
     clients.add(client);

     req.on("close", () => {
       clearInterval(keepAlive);
       clients.delete(client);
     });
   }

   export function pushNotificationToUser(
     userId: number,
     _workspaceId: number,
     notification: Record<string, unknown>,
   ): void {
     const event = `id: ${notification.id}\nevent: notification.created\ndata: ${JSON.stringify(notification)}\n\n`;
     for (const client of clients) {
       if (client.userId === userId) {
         client.res.write(event);
       }
     }
   }

   export function pushReadEvent(userId: number, notificationId: number): void {
     const event = `event: notification.read\ndata: ${JSON.stringify({ id: notificationId })}\n\n`;
     for (const client of clients) {
       if (client.userId === userId) client.res.write(event);
     }
   }

   export function pushReadAllEvent(userId: number): void {
     const event = `event: notifications.read-all\ndata: {}\n\n`;
     for (const client of clients) {
       if (client.userId === userId) client.res.write(event);
     }
   }
   ```

4. Implement `server/src/notifications/router.ts`:

   ```typescript
   import { Router } from "express";
   import { pool } from "../db/pool.js";
   import { domainBus, EVENTS } from "../events.js";
   import { requireWorkspaceMember } from "../middleware/workspace.js";
   import { registerPush } from "./service.js";
   import {
     pushNotificationToUser,
     pushReadAllEvent,
     pushReadEvent,
     sseNotificationHandler,
   } from "./sse.js";

   // Wire SSE push into notification service
   registerPush(pushNotificationToUser);

   export const notificationsRouter = Router({ mergeParams: true });

   notificationsRouter.use(requireWorkspaceMember);

   notificationsRouter.get("/", async (req, res) => {
     const workspaceId = Number(req.params.workspaceId);
     const userId = (req.user as { id: number }).id;
     const limit = Math.min(Number(req.query.limit ?? 50), 100);
     const cursor = req.query.cursor ? Number(req.query.cursor) : null;

     const { rows } = await pool.query(
       `SELECT * FROM notifications
        WHERE user_id = $1 AND workspace_id = $2
          ${cursor ? "AND id < $3" : ""}
        ORDER BY created_at DESC LIMIT ${cursor ? "$4" : "$3"}`,
       cursor ? [userId, workspaceId, cursor, limit] : [userId, workspaceId, limit],
     );

     const { rows: countRows } = await pool.query(
       "SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND workspace_id = $2 AND read_at IS NULL",
       [userId, workspaceId],
     );

     const notifications = rows.map((r) => ({
       id: r.id, type: r.type, title: r.title, body: r.body,
       cardId: r.card_id, actorId: r.actor_id, readAt: r.read_at,
       sourceDeleted: r.source_deleted, createdAt: r.created_at,
     }));

     res.json({
       notifications,
       unreadCount: countRows[0]?.count ?? 0,
       nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
     });
   });

   notificationsRouter.patch("/:id/read", async (req, res) => {
     const userId = (req.user as { id: number }).id;
     const id = Number(req.params.id);
     const { rows, rowCount } = await pool.query(
       "UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING id",
       [id, userId],
     );
     if (!rowCount) return res.status(404).json({ error: "Not found" });
     pushReadEvent(userId, rows[0].id);
     res.json({ ok: true });
   });

   notificationsRouter.post("/read-all", async (req, res) => {
     const userId = (req.user as { id: number }).id;
     const workspaceId = Number(req.params.workspaceId);
     const { rowCount } = await pool.query(
       "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND workspace_id = $2 AND read_at IS NULL",
       [userId, workspaceId],
     );
     pushReadAllEvent(userId);
     res.json({ ok: true, markedCount: rowCount ?? 0 });
   });

   notificationsRouter.get("/stream", sseNotificationHandler);

   // Admin endpoint: create system alert for all workspace members
   notificationsRouter.post("/system-alert", async (req, res) => {
     const workspaceId = Number(req.params.workspaceId);
     const actor = req.user as { id: number; role?: string };
     // Require admin or owner role
     const { rows: memberRows } = await pool.query(
       "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
       [workspaceId, actor.id],
     );
     if (!memberRows.length || !["admin", "owner"].includes(memberRows[0].role)) {
       return res.status(403).json({ error: "Admin or owner required" });
     }
     const { title, body } = req.body ?? {};
     if (typeof title !== "string" || !title.trim()) {
       return res.status(400).json({ error: "title is required" });
     }
     domainBus.emit(EVENTS.SYSTEM_ALERT, {
       type: EVENTS.SYSTEM_ALERT,
       workspaceId,
       actorId: actor.id,
       payload: { title: title.trim(), body: body ?? null },
     });
     res.status(202).json({ ok: true });
   });
   ```

5. Mount in `server/src/routes.ts`:
   ```typescript
   import { notificationsRouter } from "./notifications/router.js";
   // Add after existing router mounts:
   api.use("/workspaces/:workspaceId/notifications", notificationsRouter);
   ```

6. Also handle SSE reconnect with Last-Event-ID in `sseNotificationHandler`:
   After writing `: connected\n\n`, query missed notifications and replay them if `lastEventId > 0`:
   ```typescript
   if (lastEventId > 0) {
     const { rows } = await pool.query(
       "SELECT * FROM notifications WHERE user_id = $1 AND id > $2 ORDER BY id",
       [userId, lastEventId],
     );
     for (const row of rows) {
       res.write(`id: ${row.id}\nevent: notification.created\ndata: ${JSON.stringify(row)}\n\n`);
     }
   }
   ```

7. Run tests:
   `npm run test -- server/src/notifications/router.test.ts`
   Expected: PASS

8. Commit:
   `git add server/src/notifications/router.ts server/src/notifications/sse.ts server/src/notifications/router.test.ts server/src/notifications/sse.test.ts server/src/routes.ts`
   `git commit -m "feat(notifications): add REST API and SSE hub for notification delivery"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — API Endpoints section (GET, PATCH, POST, SSE), SSE Architecture section (reconnection with Last-Event-ID, heartbeat 25s)
server/src/realtime.ts — SSE hub pattern (sseHandler, 25s keepAlive, req.on("close"))
server/src/routes.ts — router mounting pattern

## WHY THIS APPROACH
Complexity: standard
Justification: Two new files, SSE hub pattern different from workspace SSE (user-keyed vs workspace-keyed). `registerPush(pushNotificationToUser)` called at module load in router.ts wires T3→T5 without circular import.

## SANDWICH CONTEXT
[CRITICAL: notification SSE is user-keyed (by userId) — do NOT use workspaceId as the fanout key]
You are implementing REST API + SSE hub for Sidebar Inbox — Notification Center.
Spec: docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
Design decision: Separate SSE endpoint /notifications/stream; per-user push; reconnection with Last-Event-ID
Files in scope: `server/src/notifications/sse.ts`, `server/src/notifications/router.ts`, `server/src/notifications/router.test.ts`, `server/src/routes.ts`
Available after: T3 (service.ts with registerPush exported)
Architecture rule: sseNotificationHandler streams ONLY to the authenticated user's connections — must check client.userId === userId on push. Do NOT reuse or modify workspace SSE (realtime.ts publishEvent).
[RESTATE: pushNotificationToUser filters by userId — all workspace members must NOT receive each other's notifications]

## DELIVERABLE
Given Alice has 3 unread + 2 read notifications, When GET /workspaces/1/notifications, Then response.notifications has 5 items, response.unreadCount = 3
Given notification id=10 exists for Alice (read_at=null), When PATCH /workspaces/1/notifications/10/read, Then response { ok: true }, readAt set in DB
Given Alice has 5 unread, When POST /workspaces/1/notifications/read-all, Then response { ok: true, markedCount: 5 }, all read_at set
Given notification created for Alice, When Alice has SSE connection, Then notification pushed as `notification.created` event
Given SSE disconnected (lastEventId=5), When client reconnects with Last-Event-ID: 5, Then server replays all notifications with id > 5
Given admin POSTs /notifications/system-alert with title+body, When role check passes, Then EVENTS.SYSTEM_ALERT emitted on domainBus, response 202 { ok: true }
Given non-admin POSTs /notifications/system-alert, When role = "member", Then response 403
[must-not] Given Bob and Alice share workspace, When Bob's notification is created, Then Alice's SSE connection must NOT receive it

All tests PASS. Commit exists with message `feat(notifications): add REST API and SSE hub ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - SSE hub uses `userId` as fanout key (not workspaceId)
  - `registerPush(pushNotificationToUser)` called in router.ts to wire service → SSE
  - Last-Event-ID reconnection replays missed notifications
  - Heartbeat `: ping\n\n` every 25 seconds
  - req.on("close") cleanup for SSE clients
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Importing from or modifying `server/src/realtime.ts`
  - Broadcasting notification to workspace-level clients

Open question risks:
  - supertest may not be installed — check package.json; if missing, use mock express + Response pattern instead

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, router mounted in routes.ts
Escalate when: circular import detected (service imports from sse or vice versa) — use registerPush pattern to break cycle

---

### Task 6: Due Date Reminder Scheduler [depends: T3] [parallel: T5]

## OBJECTIVE
Create `server/src/notifications/scheduler.ts` — queries cards due today in each workspace's timezone, inserts `due_date_reminder` notifications for assignees. Skip if card is in done column or if reminder already sent today (idempotency). Wire into `server/src/index.ts` startup.

Files:
- Create: `server/src/notifications/scheduler.ts`
- Create: `server/src/notifications/scheduler.test.ts`
- Modify: `server/src/index.ts` (call `startDueDateScheduler()`)

Steps:
1. Write failing tests:
   File: `server/src/notifications/scheduler.test.ts`

   ```typescript
   import { describe, expect, it, vi, beforeEach } from "vitest";

   vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));

   import { pool } from "../db/pool.js";
   import { runDueDateReminders } from "./scheduler.js";

   const mockQuery = vi.mocked(pool.query);

   describe("runDueDateReminders", () => {
     beforeEach(() => vi.clearAllMocks());

     it("inserts reminder for card due today in workspace timezone", async () => {
       // First query: find qualifying cards
       mockQuery.mockResolvedValueOnce({
         rows: [
           { card_id: 10, assignee_id: 3, card_title: "Fix bug", workspace_id: 1 },
         ],
         rowCount: 1,
       } as never);
       // Second query: insert notification (ON CONFLICT DO NOTHING)
       mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

       await runDueDateReminders();

       expect(mockQuery).toHaveBeenCalledTimes(2);
       const [insertSql, insertParams] = mockQuery.mock.calls[1] as [string, unknown[]];
       expect(insertSql).toContain("INSERT INTO notifications");
       expect(insertSql).toContain("due_date_reminder");
       expect(insertParams).toContain(3); // assignee_id
     });

     it("skips cards in done columns", async () => {
       // Query returns empty (done-column filter in SQL)
       mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
       await runDueDateReminders();
       // Only 1 query (the select), no insert
       expect(mockQuery).toHaveBeenCalledTimes(1);
     });

     it("is idempotent — second run does not throw when partial index conflict fires", async () => {
       // First run: card found, insert succeeds
       mockQuery
         .mockResolvedValueOnce({
           rows: [{ card_id: 10, assignee_id: 3, card_title: "Fix bug", workspace_id: 1 }],
           rowCount: 1,
         } as never)
         .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never); // first INSERT succeeds

       await runDueDateReminders();

       // Second run: card still found, ON CONFLICT DO NOTHING silently skips (rowCount=0)
       mockQuery
         .mockResolvedValueOnce({
           rows: [{ card_id: 10, assignee_id: 3, card_title: "Fix bug", workspace_id: 1 }],
           rowCount: 1,
         } as never)
         .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // conflict, skipped

       await runDueDateReminders();

       // 4 total calls (2 SELECTs + 2 INSERT attempts), no error thrown
       expect(mockQuery).toHaveBeenCalledTimes(4);
       // Both INSERT calls use the partial-index conflict clause
       const insertCalls = mockQuery.mock.calls.filter(([sql]: [string]) =>
         sql.includes("INSERT INTO notifications"),
       );
       expect(insertCalls).toHaveLength(2);
       expect((insertCalls[0] as [string])[0]).toContain("WHERE type = 'due_date_reminder' DO NOTHING");
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/notifications/scheduler.test.ts`
   Expected failure: `Cannot find module './scheduler.js'`

3. Implement `server/src/notifications/scheduler.ts`:

   ```typescript
   import { pool } from "../db/pool.js";

   export async function runDueDateReminders(): Promise<void> {
     // Find all cards due today (in workspace timezone), not in done column, with assignee
     const { rows } = await pool.query(`
       SELECT
         c.id AS card_id,
         c.assignee_id,
         c.title AS card_title,
         c.workspace_id
       FROM cards c
       JOIN columns col ON col.id = c.column_id
       LEFT JOIN workspace_settings ws ON ws.workspace_id = c.workspace_id
       WHERE
         c.deleted_at IS NULL
         AND c.assignee_id IS NOT NULL
         AND col.is_done = FALSE
         AND c.due_date = (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(ws.timezone, 'UTC'))::date
     `);

     for (const row of rows) {
       try {
         await pool.query(
           `INSERT INTO notifications (user_id, workspace_id, type, title, card_id)
            VALUES ($1, $2, 'due_date_reminder', $3, $4)
            ON CONFLICT (user_id, card_id, (created_at::date)) WHERE type = 'due_date_reminder' DO NOTHING`,
           [row.assignee_id, row.workspace_id, `'${row.card_title}' is due today`, row.card_id],
         );
       } catch {
         // log and continue — don't let one failure block others
         console.error(`Failed to insert due_date_reminder for card ${row.card_id}`);
       }
     }
   }

   export function startDueDateScheduler(): ReturnType<typeof setInterval> {
     // Check every minute; send reminders if any workspace hits local midnight
     return setInterval(() => {
       void runDueDateReminders();
     }, 60_000);
   }
   ```

4. Run test — verify PASS:
   `npm run test -- server/src/notifications/scheduler.test.ts`
   Expected: PASS

5. In `server/src/index.ts`, after `initNotificationService()`:
   ```typescript
   import { startDueDateScheduler } from "./notifications/scheduler.js";
   // ...
   startDueDateScheduler();
   ```

6. Commit:
   `git add server/src/notifications/scheduler.ts server/src/notifications/scheduler.test.ts server/src/index.ts`
   `git commit -m "feat(notifications): add due date reminder scheduler"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — Scheduled Jobs section (due date reminder logic, idempotency), Rule: Due Date Reminder GWT
server/src/db/schema.sql — columns.is_done exists, cards.due_date is DATE type, workspace_settings.timezone (added by T1)

## WHY THIS APPROACH
Complexity: lightweight
Justification: Single file, setInterval pattern. SQL handles timezone conversion and done-column filter. ON CONFLICT DO NOTHING + UNIQUE index handles idempotency without application-level locking.

## SANDWICH CONTEXT
[CRITICAL: due_date is a DATE column — compare using ::date cast in workspace timezone, not UTC midnight]
You are implementing the due date reminder scheduler for Sidebar Inbox — Notification Center.
Spec: docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
Design decision: setInterval check every minute; SQL timezone conversion; ON CONFLICT DO NOTHING idempotency
Files in scope: `server/src/notifications/scheduler.ts`, `server/src/notifications/scheduler.test.ts`, `server/src/index.ts`
Available after: T1 (workspace_settings table + notifications table), T3 (insertNotification logic understood)
Architecture rule: Use ON CONFLICT DO NOTHING on INSERT — the UNIQUE index on (user_id, type, card_id, created_at) provides idempotency. Do not implement application-level deduplication.
[RESTATE: due_date comparison must use workspace timezone via COALESCE(ws.timezone, 'UTC') — not server UTC time]

## DELIVERABLE
Given card assigned to Alice with due_date = today (workspace TZ Asia/Jakarta), card NOT in done column, When runDueDateReminders() called, Then INSERT INTO notifications with type="due_date_reminder", user_id=Alice.id
Given card in done column (is_done=true) with due_date = today, When runDueDateReminders() called, Then no INSERT (done-column filter in SQL)
Given reminder already sent for card today (partial index `idx_notifications_reminder_daily` fires), When runDueDateReminders() called again (up to 1439 more times), Then ON CONFLICT DO NOTHING on partial index, no duplicate inserted, no error thrown

All tests PASS. Commit exists with message `feat(notifications): add due date reminder scheduler`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - SQL uses `COALESCE(ws.timezone, 'UTC')` for timezone-aware date comparison
  - `col.is_done = FALSE` filter in SQL (server-side, not post-query filter)
  - `ON CONFLICT (user_id, card_id, (created_at::date)) WHERE type = 'due_date_reminder' DO NOTHING` — matches partial index `idx_notifications_reminder_daily` (created by T1); do NOT use the general idempotency index here
  - `try/catch` per-card so one failure doesn't block others
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Application-level deduplication (SELECT then INSERT) — use UNIQUE index + ON CONFLICT
  - Modifying existing workspace SSE or notification service subscription logic

Open question risks:
  - Dedup relies solely on the partial daily index `idx_notifications_reminder_daily` (the general idempotency index was dropped in T1). The scheduler processes each qualifying card once per minute-run, so same-card reminders always differ by ~60s — only the daily partial index matters, and `ON CONFLICT ... WHERE type = 'due_date_reminder'` targets exactly it. No competing unique index to collide with.

## STOP CONDITIONS
Done when: all tests pass, scheduler registered in index.ts
Escalate when: workspace_settings table doesn't exist at runtime — verify T1 ran first

---

### Task 7: Client Notifications Hook + API Layer [depends: T5]

## OBJECTIVE
Add `AppNotification` type to `client/src/types.ts`, add notification API methods to `client/src/api.ts`, and create `client/src/hooks/useNotifications.ts` — SSE connection + REST fetch, exposing `notifications[]`, `unreadCount`, `markAsRead(id)`, `markAllAsRead()`. Wrap the hook in a **single shared context** (`NotificationsProvider` / `useNotificationsContext`) so the sidebar badge (T8) and InboxPage (T8) consume ONE connection and ONE state — not two independent instances [W3].

Files:
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Create: `client/src/hooks/useNotifications.ts`
- Create: `client/src/hooks/useNotifications.test.ts`
- Create: `client/src/context/NotificationsContext.tsx`

Steps:
1. Write failing tests:
   File: `client/src/hooks/useNotifications.test.ts`

   ```typescript
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { renderHook, act } from "@testing-library/react";
   import { useNotifications } from "./useNotifications";

   vi.mock("../api", () => ({
     api: {
       getNotifications: vi.fn(),
       markNotificationAsRead: vi.fn(),
       markAllNotificationsAsRead: vi.fn(),
     },
   }));

   // Mock EventSource — captures event handlers so SSE events can be fired in tests
   let capturedListeners: Record<string, (e: MessageEvent) => void> = {};
   const mockEventSource = {
     addEventListener: vi.fn((event: string, handler: (e: MessageEvent) => void) => {
       capturedListeners[event] = handler;
     }),
     close: vi.fn(),
   };
   vi.stubGlobal("EventSource", vi.fn(() => mockEventSource));

   import { api } from "../api";
   const mockApi = vi.mocked(api);

   describe("useNotifications", () => {
     beforeEach(() => {
       capturedListeners = {};
       vi.clearAllMocks();
     });

     it("fetches notifications on mount", async () => {
       mockApi.getNotifications.mockResolvedValue({
         notifications: [{ id: 1, type: "card_assigned", title: "Bob assigned...", readAt: null, sourceDeleted: false, createdAt: "2026-06-29T10:00:00Z" }],
         unreadCount: 1,
         nextCursor: null,
       });

       const { result } = renderHook(() => useNotifications({ workspaceId: 1 }));

       await vi.waitFor(() => expect(result.current.unreadCount).toBe(1));
       expect(result.current.notifications).toHaveLength(1);
     });

     it("markAsRead updates local state", async () => {
       mockApi.getNotifications.mockResolvedValue({
         notifications: [{ id: 1, type: "card_assigned", title: "Bob assigned...", readAt: null, sourceDeleted: false, createdAt: "2026-06-29T10:00:00Z" }],
         unreadCount: 1,
         nextCursor: null,
       });
       mockApi.markNotificationAsRead.mockResolvedValue({ ok: true });

       const { result } = renderHook(() => useNotifications({ workspaceId: 1 }));
       await vi.waitFor(() => expect(result.current.notifications).toHaveLength(1));

       await act(async () => {
         await result.current.markAsRead(1);
       });

       expect(result.current.unreadCount).toBe(0);
       expect(result.current.notifications[0].readAt).toBeTruthy();
     });

     it("markAllAsRead zeroes unreadCount", async () => {
       mockApi.getNotifications.mockResolvedValue({
         notifications: [],
         unreadCount: 5,
         nextCursor: null,
       });
       mockApi.markAllNotificationsAsRead.mockResolvedValue({ ok: true, markedCount: 5 });

       const { result } = renderHook(() => useNotifications({ workspaceId: 1 }));
       await vi.waitFor(() => expect(result.current.unreadCount).toBe(5));

       await act(async () => {
         await result.current.markAllAsRead();
       });

       expect(result.current.unreadCount).toBe(0);
     });

     it("SSE notification.created prepends notification and increments unreadCount", async () => {
       mockApi.getNotifications.mockResolvedValue({
         notifications: [],
         unreadCount: 0,
         nextCursor: null,
       });

       const { result } = renderHook(() => useNotifications({ workspaceId: 1 }));
       await vi.waitFor(() => expect(result.current.notifications).toHaveLength(0));

       const newNotif = {
         id: 2,
         type: "card_assigned",
         title: "Bob assigned 'Fix bug' to you",
         readAt: null,
         sourceDeleted: false,
         createdAt: "2026-06-29T11:00:00Z",
       };

       act(() => {
         capturedListeners["notification.created"]?.({ data: JSON.stringify(newNotif) } as MessageEvent);
       });

       expect(result.current.notifications).toHaveLength(1);
       expect(result.current.notifications[0].title).toBe("Bob assigned 'Fix bug' to you");
       expect(result.current.unreadCount).toBe(1);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- client/src/hooks/useNotifications.test.ts`
   Expected failure: `Cannot find module './useNotifications'`

3. Add `AppNotification` interface to `client/src/types.ts` (named `AppNotification`, not `Notification`, to avoid shadowing the DOM global `Notification`) [I3]:
   ```typescript
   export interface AppNotification {
     id: number;
     type: string;
     title: string;
     body: string | null;
     cardId: number | null;
     actorId: number | null;
     readAt: string | null;
     sourceDeleted: boolean;
     createdAt: string;
   }

   export interface NotificationsResponse {
     notifications: AppNotification[];
     unreadCount: number;
     nextCursor: number | null;
   }
   ```

4. Add API methods to `client/src/api.ts`:
   ```typescript
   getNotifications: (workspaceId: number, cursor?: number) =>
     request<NotificationsResponse>(
       `/workspaces/${workspaceId}/notifications${cursor ? `?cursor=${cursor}` : ""}`,
     ),
   markNotificationAsRead: (workspaceId: number, id: number) =>
     request<{ ok: boolean }>(`/workspaces/${workspaceId}/notifications/${id}/read`, {
       method: "PATCH",
     }),
   markAllNotificationsAsRead: (workspaceId: number) =>
     request<{ ok: boolean; markedCount: number }>(
       `/workspaces/${workspaceId}/notifications/read-all`,
       { method: "POST" },
     ),
   ```

5. Implement `client/src/hooks/useNotifications.ts`:
   ```typescript
   import { useCallback, useEffect, useState } from "react";
   import { api } from "../api";
   import type { AppNotification } from "../types";

   interface UseNotificationsOptions {
     workspaceId: number | null;
   }

   export function useNotifications({ workspaceId }: UseNotificationsOptions) {
     const [notifications, setNotifications] = useState<AppNotification[]>([]);
     const [unreadCount, setUnreadCount] = useState(0);

     const fetchNotifications = useCallback(async () => {
       if (!workspaceId) return;
       const res = await api.getNotifications(workspaceId);
       setNotifications(res.notifications);
       setUnreadCount(res.unreadCount);
     }, [workspaceId]);

     useEffect(() => {
       void fetchNotifications();
     }, [fetchNotifications]);

     useEffect(() => {
       if (!workspaceId) return;
       const url = `/api/workspaces/${workspaceId}/notifications/stream`;
       // Browser EventSource automatically sends Last-Event-ID header on reconnection
       // when SSE events include an `id:` field — no manual query param needed
       const es = new EventSource(url, { withCredentials: true });

       es.addEventListener("notification.created", (e: MessageEvent) => {
         const notif = JSON.parse(e.data as string) as AppNotification;
         // Browser EventSource auto-sends Last-Event-ID via the SSE `id:` field — no manual tracking needed
         setNotifications((prev) => [notif, ...prev]);
         setUnreadCount((c) => c + 1);
       });

       es.addEventListener("notification.read", (e: MessageEvent) => {
         const { id } = JSON.parse(e.data as string) as { id: number };
         setNotifications((prev) =>
           prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
         );
       });

       es.addEventListener("notifications.read-all", () => {
         const now = new Date().toISOString();
         setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
         setUnreadCount(0);
       });

       return () => es.close();
     }, [workspaceId]);

     const markAsRead = useCallback(
       async (id: number) => {
         if (!workspaceId) return;
         await api.markNotificationAsRead(workspaceId, id);
         setNotifications((prev) =>
           prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
         );
         setUnreadCount((c) => Math.max(0, c - 1));
       },
       [workspaceId],
     );

     const markAllAsRead = useCallback(async () => {
       if (!workspaceId) return;
       await api.markAllNotificationsAsRead(workspaceId);
       const now = new Date().toISOString();
       setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
       setUnreadCount(0);
     }, [workspaceId]);

     return { notifications, unreadCount, markAsRead, markAllAsRead, refetch: fetchNotifications };
   }
   ```

5b. **[W3 — required]** Create `client/src/context/NotificationsContext.tsx` — a thin provider that
    calls `useNotifications` ONCE and exposes its value via context, so the sidebar badge and the
    InboxPage share a single SSE connection + single state (no duplicate connections, no split
    unreadCount). The provider reads `activeWorkspaceId` from `BoardContext` (same source the sidebar
    already uses):
    ```typescript
    import { createContext, useContext } from "react";
    import { useNotifications } from "../hooks/useNotifications";
    import { useBoard } from "./BoardContext";

    type NotificationsValue = ReturnType<typeof useNotifications>;
    const NotificationsContext = createContext<NotificationsValue | null>(null);

    export function NotificationsProvider({ children }: { children: React.ReactNode }) {
      const { activeWorkspaceId } = useBoard();
      const value = useNotifications({ workspaceId: activeWorkspaceId });
      return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
    }

    export function useNotificationsContext(): NotificationsValue {
      const ctx = useContext(NotificationsContext);
      if (!ctx) throw new Error("useNotificationsContext must be used within NotificationsProvider");
      return ctx;
    }
    ```
    Mount `NotificationsProvider` in T8 inside `AppLayout` (wrapping sidebar + routed pages). Sidebar
    and InboxPage call `useNotificationsContext()` — never `useNotifications` directly.

6. Run test — verify PASS:
   `npm run test --workspace=client -- client/src/hooks/useNotifications.test.ts`
   Expected: PASS

7. Commit:
   `git add client/src/types.ts client/src/api.ts client/src/hooks/useNotifications.ts client/src/hooks/useNotifications.test.ts client/src/context/NotificationsContext.tsx`
   `git commit -m "feat(notifications): add client notifications hook, shared context, and API layer"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — SSE Client Hook section, Badge Count section, API Endpoints response shapes
client/src/hooks/useAgentChat.ts — pattern for useState + useCallback + useEffect hook structure
client/src/api.ts — existing request() wrapper, typed return shapes

## WHY THIS APPROACH
Complexity: standard
Justification: SSE + REST combined in one hook; EventSource browser API; optimistic local state updates after markAsRead/markAllAsRead; wrapped once in a shared provider (W3) so badge + page don't open duplicate connections. 5 files across client layer.

## SANDWICH CONTEXT
[CRITICAL: one shared NotificationsProvider — sidebar + InboxPage must NOT each instantiate useNotifications]
You are implementing the client notification hook + shared context + API layer for Sidebar Inbox — Notification Center.
Spec: docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
Design decision: useNotifications hook connects SSE, fetches REST, exposes markAsRead/markAllAsRead; wrapped once in NotificationsProvider
Files in scope: `client/src/types.ts`, `client/src/api.ts`, `client/src/hooks/useNotifications.ts`, `client/src/hooks/useNotifications.test.ts`, `client/src/context/NotificationsContext.tsx`
Available after: T5 (REST API + SSE endpoint exist on server)
Architecture rule: Client uses bundler resolution — no .ts extensions on imports. Same-origin EventSource sends session cookies automatically; `withCredentials: true` is harmless and fine to set, but it is NOT required (the existing BoardContext EventSource at `BoardContext.tsx:440` omits it and works).
[RESTATE: dedup the connection via NotificationsProvider — credentials are automatic for same-origin SSE]

## DELIVERABLE
[derived] Given workspaceId=1, When hook mounts, Then getNotifications API called, notifications + unreadCount set in state
[derived] Given SSE notification.created event fires, When event received, Then notifications prepended to list, unreadCount incremented
Given Alice has 3 unread, When markAllAsRead() called, Then unreadCount becomes 0, all notifications get readAt set locally
Given id=1 notification (readAt=null), When markAsRead(1) called, Then notification.readAt set in local state, unreadCount decremented

All tests PASS. Commit exists with message `feat(notifications): add client notifications hook and API layer`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Single shared `NotificationsProvider` / `useNotificationsContext`; sidebar + InboxPage consume context, not the raw hook [W3]
  - Optimistic UI: markAsRead/markAllAsRead update local state immediately (don't wait for SSE confirmation)
  - Tests written BEFORE implementation (TDD)
  - `AppNotification` (not `Notification`) and `NotificationsResponse` types exported from types.ts [I3]
  - `withCredentials: true` on EventSource is optional (harmless); same-origin cookies are sent automatically [I2]

Must-not-have:
  - Global inbox (this hook is workspace-scoped via workspaceId)
  - Notification preferences UI (out of scope)

Open question risks:
  - EventSource in jsdom test environment may need stubGlobal — ensure test mocks cover it

## STOP CONDITIONS
Done when: all tests PASS, hook usable in InboxPage (T8)
Escalate when: EventSource not available in test env → add `vi.stubGlobal("EventSource", ...)`

---

### Task 8: InboxPage + Sidebar Wiring [depends: T7]

## OBJECTIVE
Create `client/src/pages/InboxPage.tsx` with full notification list UI. Add Inbox nav item to `KANBAN_NAV` in `navItems.ts`. Add unread badge to `Sidebar.tsx`. Register `/inbox` route in `App.tsx`.

Files:
- Create: `client/src/pages/InboxPage.tsx`
- Create: `client/src/pages/InboxPage.test.tsx`
- Modify: `client/src/layout/sidebar/navItems.ts`
- Modify: `client/src/layout/sidebar/Sidebar.tsx`
- Modify: `client/src/layout/AppLayout.tsx` (mount `NotificationsProvider`)
- Modify: `client/src/App.tsx`

Steps:
1. Write failing tests:
   File: `client/src/pages/InboxPage.test.tsx`

   ```typescript
   import { describe, expect, it, vi, beforeEach } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { MemoryRouter } from "react-router";

   // vi.mock is hoisted; factory uses vi.fn() so each test can override via vi.mocked()
   // InboxPage consumes the SHARED context (W3), not the raw hook — mock the context.
   vi.mock("../context/NotificationsContext", () => ({
     useNotificationsContext: vi.fn(),
   }));

   import { useNotificationsContext } from "../context/NotificationsContext";
   import InboxPage from "./InboxPage";

   const defaultMock = {
     notifications: [
       { id: 1, type: "card_assigned", title: "Bob assigned 'Fix bug' to you", readAt: null, sourceDeleted: false, createdAt: "2026-06-29T10:00:00Z", cardId: 10 },
       { id: 2, type: "card_assigned", title: "Old notification", readAt: "2026-06-28T10:00:00Z", sourceDeleted: false, createdAt: "2026-06-28T10:00:00Z", cardId: null },
     ],
     unreadCount: 1,
     markAsRead: vi.fn(),
     markAllAsRead: vi.fn(),
     refetch: vi.fn(),
   };

   describe("InboxPage", () => {
     beforeEach(() => {
       vi.mocked(useNotificationsContext).mockReturnValue(defaultMock);
     });

     it("renders unread notification with visual distinction", () => {
       render(<MemoryRouter><InboxPage /></MemoryRouter>);
       expect(screen.getByText("Bob assigned 'Fix bug' to you")).toBeInTheDocument();
     });

     it("renders 'Mark all as read' button", () => {
       render(<MemoryRouter><InboxPage /></MemoryRouter>);
       expect(screen.getByRole("button", { name: /mark all as read/i })).toBeInTheDocument();
     });

     it("shows 'Card no longer exists' for sourceDeleted notifications", () => {
       vi.mocked(useNotificationsContext).mockReturnValue({
         notifications: [
           { id: 3, type: "card_assigned", title: "Deleted card notif", readAt: null, sourceDeleted: true, createdAt: "2026-06-29T10:00:00Z", cardId: 99 },
         ],
         unreadCount: 1,
         markAsRead: vi.fn(),
         markAllAsRead: vi.fn(),
         refetch: vi.fn(),
       });
       render(<MemoryRouter><InboxPage /></MemoryRouter>);
       expect(screen.getByText(/card no longer exists/i)).toBeInTheDocument();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- client/src/pages/InboxPage.test.tsx`
   Expected failure: `Cannot find module './InboxPage'`

3. Implement `client/src/pages/InboxPage.tsx`:
   - Read state via `const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotificationsContext();` (shared instance — W3; do NOT call `useNotifications` directly)
   - List of notifications, newest first
   - Unread: bold title + blue dot indicator (`w-2 h-2 rounded-full bg-blue-500`)
   - Read: normal weight, muted text color (`text-neutral-500`)
   - Click card-related (cardId != null, !sourceDeleted): `navigate("/board?card=" + cardId)` + `markAsRead(id)`
   - sourceDeleted: greyed out, click disabled, show "Card no longer exists" label
   - "Mark all as read" button in header (only when unreadCount > 0)
   - Empty state: centered message "Inbox kamu kosong — semua terkendali!" with `<Inbox>` lucide icon

   Load creative-brief before styling colors/spacing:
   ```
   docs/pocket/rule/creative-brief.md — load before implementing UI colors and typography
   ```

4. Modify `client/src/layout/sidebar/navItems.ts`:
   ```typescript
   import { Inbox, ... } from "lucide-react";

   // Add to NAV_ITEMS array:
   { to: "/inbox", label: "Inbox", icon: Inbox },

   // Add to KANBAN_NAV filter:
   export const KANBAN_NAV = NAV_ITEMS.filter((i) =>
     ["/board", "/dashboard", "/inbox"].includes(i.to),
   );
   ```

4b. **[W3 — required]** Modify `client/src/layout/AppLayout.tsx` — wrap the sidebar + routed content
    in `<NotificationsProvider>` so both the badge and InboxPage read one shared instance:
    ```tsx
    import { NotificationsProvider } from "../context/NotificationsContext";
    // wrap the existing layout body:
    // <NotificationsProvider> <Sidebar/> <main>{children/Outlet}</main> </NotificationsProvider>
    ```
    (Provider must sit inside whatever already supplies `BoardContext`, since it calls `useBoard()`.)

5. Modify `client/src/layout/sidebar/Sidebar.tsx`:
   - Import `useNotificationsContext` from `../../context/NotificationsContext`
   - `const { unreadCount } = useNotificationsContext();` (no direct `useNotifications`, no per-sidebar workspaceId wiring — the provider owns it)
   - In nav link rendering, if item.to === "/inbox" and unreadCount > 0, render red badge:
     ```tsx
     <span className="relative">
       {item.icon && <item.icon size={20} />}
       {item.to === "/inbox" && unreadCount > 0 && (
         <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
           {unreadCount > 9 ? "9+" : unreadCount}
         </span>
       )}
     </span>
     ```

6. Modify `client/src/App.tsx` — add `/inbox` route (lazy):
   ```typescript
   {
     path: "inbox",
     lazy: async () => ({
       Component: (await import("./pages/InboxPage")).default,
     }),
   },
   ```

7. Run tests:
   `npm run test --workspace=client`
   Expected: PASS

8. Commit:
   `git add client/src/pages/InboxPage.tsx client/src/pages/InboxPage.test.tsx client/src/layout/sidebar/navItems.ts client/src/layout/sidebar/Sidebar.tsx client/src/layout/AppLayout.tsx client/src/App.tsx`
   `git commit -m "feat(notifications): add InboxPage and sidebar Inbox nav with shared notifications context"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — Client Implementation section (InboxPage, Badge Count, SSE Client Hook), Rule: Inbox Interaction GWT
docs/pocket/rule/creative-brief.md — MUST LOAD before styling any UI component
client/src/layout/sidebar/navItems.ts — KANBAN_NAV filter pattern
client/src/layout/sidebar/Sidebar.tsx — activeNav rendering, NavLink structure, badge slot location
client/src/App.tsx — lazy() import pattern for pages

## WHY THIS APPROACH
Complexity: standard
Justification: 5 files across two layers (page + routing wiring). InboxPage has several distinct UI states (unread/read/deleted/empty) that each need testing. Badge in Sidebar requires hook access at sidebar level.

## SANDWICH CONTEXT
[CRITICAL: Load docs/pocket/rule/creative-brief.md before making ANY color, typography, or spacing decision in InboxPage.tsx]
You are implementing InboxPage UI + sidebar wiring for Sidebar Inbox — Notification Center.
Spec: docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md
Design decision: InboxPage as standalone page under /inbox route; unread badge on sidebar Inbox nav item
Files in scope: `client/src/pages/InboxPage.tsx`, `client/src/pages/InboxPage.test.tsx`, `client/src/layout/sidebar/navItems.ts`, `client/src/layout/sidebar/Sidebar.tsx`, `client/src/layout/AppLayout.tsx`, `client/src/App.tsx`
Available after: T7 (useNotifications hook exists and is tested)
Architecture rule: Client uses bundler resolution — no .ts extensions. InboxPage uses lazy() import in App.tsx (same pattern as DashboardPage). Must load creative-brief.md before any UI styling.
[RESTATE: Load docs/pocket/rule/creative-brief.md — no color/spacing/typography decision without consulting it]

## DELIVERABLE
Given Alice has 3 unread + 2 read notifications, When opens /inbox, Then unread notifications shown with bold title + blue dot, read notifications shown with muted text, badge on sidebar shows "3"
Given notification has cardId (not sourceDeleted), When clicked, Then navigate to /board?card={cardId} and markAsRead(id) called
Given notification with sourceDeleted=true, When rendered, Then shows "Card no longer exists", item is non-clickable (opacity-50 cursor-not-allowed)
Given Alice has 5 unread, When "Mark all as read" button clicked, Then markAllAsRead() called, unreadCount becomes 0, badge disappears
Given notifications list is empty, When renders, Then shows empty state with Inbox icon + "Inbox kamu kosong — semua terkendali!" text
[must-not] Given agent event notifications — these must NOT appear (out of scope, not in notification types)

All tests PASS. Commit exists with message `feat(notifications): add InboxPage and sidebar Inbox nav with unread badge`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Load docs/pocket/rule/creative-brief.md before implementing any UI styling
  - Unread visual distinction: bold + blue dot
  - sourceDeleted: opacity reduced, click disabled, "Card no longer exists" label
  - Empty state with Inbox lucide icon + Indonesian copy
  - Badge on Sidebar shows unreadCount (cap at 9+)
  - Sidebar AND InboxPage read from `useNotificationsContext()` (one shared provider mounted in AppLayout) — neither calls `useNotifications` directly [W3]
  - `/inbox` route uses lazy() import pattern
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Global inbox across workspaces (InboxPage is workspace-scoped)
  - Notification preferences UI
  - Smart grouping or digest mode
  - Badge modifications to AGENT_NAV sidebar items

Open question risks:
  - Resolved by W3: badge + page share one `NotificationsProvider` instance (one SSE connection, one fetch, one state) — no per-render network call, no split unreadCount

## STOP CONDITIONS
Done when: /inbox route renders, badge visible in sidebar, all DELIVERABLE scenarios pass
Escalate when: creative-brief.md not readable — stop and report BLOCKED

---

---

### Integration Test: Card Assignment Pipeline [depends: T3, T4]

## OBJECTIVE
Verify that when `routes/cards.ts` emits `CARD_ASSIGNED` (T4) and `notifications/service.ts` is subscribed via `domainBus` (T3), the DB INSERT fires for the assignee. Also covers `MEMBER_JOINED` → welcome + member_joined inserts to backstop T4's members path.

Files:
- Create: `server/src/routes/cards-notification.integration.test.ts`

Steps:
1. Write integration test using real `domainBus` + real `initNotificationService` + mocked `pool.query`:
   File: `server/src/routes/cards-notification.integration.test.ts`

   ```typescript
   import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

   vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));

   import { pool } from "../db/pool.js";
   import { domainBus, EVENTS } from "../events.js";
   import { initNotificationService } from "../notifications/service.js";

   const mockQuery = vi.mocked(pool.query);

   describe("Integration: EventBus → NotificationService → DB INSERT", () => {
     let cleanup: (() => void) | undefined;

     beforeEach(() => {
       mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
       cleanup = initNotificationService();
     });

     afterEach(() => {
       cleanup?.();
       vi.clearAllMocks();
     });

     it("card:assigned → INSERT for assignee; no INSERT when actor === assignee", async () => {
       domainBus.emit(EVENTS.CARD_ASSIGNED, {
         type: EVENTS.CARD_ASSIGNED,
         workspaceId: 1,
         actorId: 7,
         payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix login bug", actorDisplayName: "Bob" },
       });

       await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
       const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
       expect(sql).toContain("INSERT INTO notifications");
       expect(params).toContain(3);           // user_id = assigneeId
       expect(params).toContain("card_assigned");
     });

     it("member:joined → welcome INSERT for new member + member_joined for existing members", async () => {
       // dedup SELECT returns empty (no existing welcome)
       mockQuery
         .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
         .mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 } as never);

       domainBus.emit(EVENTS.MEMBER_JOINED, {
         type: EVENTS.MEMBER_JOINED,
         workspaceId: 1,
         actorId: 99,
         payload: {
           newMemberId: 5,
           newMemberDisplayName: "Charlie",
           workspaceName: "Team Alpha",
           existingMemberIds: [1, 2],
         },
       });

       await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
       const allInserts = mockQuery.mock.calls.filter(([sql]: [string]) =>
         sql.includes("INSERT INTO notifications"),
       );
       expect(allInserts.length).toBeGreaterThanOrEqual(1);
       const welcomeCall = allInserts.find(([, params]: [string, unknown[]]) =>
         (params as unknown[]).includes("welcome"),
       );
       expect(welcomeCall).toBeDefined();
     });
   });
   ```

2. Run test — verify FAIL before T3 and T4 implemented:
   `npm run test -- server/src/routes/cards-notification.integration.test.ts`
   Expected failure: `Cannot find module '../notifications/service.js'` (T3 not yet done)

3. After T3 and T4 complete, run test — verify PASS:
   `npm run test -- server/src/routes/cards-notification.integration.test.ts`
   Expected: PASS — real event bus wires T4 emitter to T3 service listener

4. Commit:
   `git add server/src/routes/cards-notification.integration.test.ts`
   `git commit -m "test(notifications): add integration test for event-bus → service → DB pipeline"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — Domain Event Bus section, Routing Rules
server/src/notifications/service.test.ts — unit test patterns; initNotificationService cleanup

## WHY THIS APPROACH
Complexity: lightweight
Justification: Uses real EventEmitter (no mock) — the only way to validate that T4 emitter and T3 listener are actually wired together. mocked pool avoids DB dependency.

## SANDWICH CONTEXT
[CRITICAL: do NOT mock domainBus or events.js — the whole point is to test the real EventEmitter wiring]
You are writing an integration test that bridges T4 (route emitter) and T3 (service subscriber).
Files in scope: `server/src/routes/cards-notification.integration.test.ts` only
Available after: T3 completes + T4 completes

## DELIVERABLE
Given T3 + T4 both implemented, When card:assigned emitted on real domainBus, Then initNotificationService listener fires → pool.query INSERT called for assignee
Given T3 + T4 both implemented, When member:joined emitted, Then welcome notification INSERT called for new member

All tests PASS. Commit message: `test(notifications): add integration test for event-bus → service → DB pipeline`

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Real domainBus (no mock) — validates actual EventEmitter wiring between T4 and T3
  - initNotificationService() cleanup in afterEach (removes all listeners)
  - Covers both CARD_ASSIGNED and MEMBER_JOINED paths

Must-not-have:
  - Mocking domainBus or events.js
  - Real DB connection

## STOP CONDITIONS
Done when: both tests PASS with T3+T4 implemented
Escalate when: test fails after T3+T4 done → likely payload shape mismatch between T4 emitter and T3 handler

---

### Integration Test: Service→SSE Push Wiring [depends: T3, T5]

## OBJECTIVE
Verify that `registerPush(pushNotificationToUser)` wiring (called in `router.ts` at module load after T5) causes the notification service to invoke the registered push function with the correct `userId` when a `card:assigned` notification is successfully inserted.

Files:
- Create: `server/src/notifications/service-sse.integration.test.ts`

Steps:
1. Write integration test:
   File: `server/src/notifications/service-sse.integration.test.ts`

   ```typescript
   import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

   vi.mock("../db/pool.js", () => ({
     pool: {
       query: vi.fn().mockResolvedValue({
         rows: [{ id: 1, user_id: 3, workspace_id: 1, type: "card_assigned", title: "Test" }],
         rowCount: 1,
       }),
     },
   }));

   import { domainBus, EVENTS } from "../events.js";
   import { initNotificationService, registerPush } from "./service.js";

   describe("Integration: registerPush wiring → push function called after notification insert", () => {
     let cleanup: (() => void) | undefined;
     const pushFn = vi.fn();

     beforeEach(() => {
       registerPush(pushFn);
       cleanup = initNotificationService();
     });

     afterEach(() => {
       cleanup?.();
       registerPush(() => {}); // reset to no-op to prevent bleed into other tests
       vi.clearAllMocks();
     });

     it("pushFn called with assignee userId + workspaceId after card:assigned notification inserted", async () => {
       domainBus.emit(EVENTS.CARD_ASSIGNED, {
         type: EVENTS.CARD_ASSIGNED,
         workspaceId: 1,
         actorId: 7,
         payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix bug", actorDisplayName: "Bob" },
       });

       await vi.waitFor(() => expect(pushFn).toHaveBeenCalled());
       const [userId, workspaceId] = pushFn.mock.calls[0] as [number, number, unknown];
       expect(userId).toBe(3);    // assigneeId
       expect(workspaceId).toBe(1);
     });
   });
   ```

2. Run test — verify FAIL before T3 and T5 implemented:
   `npm run test -- server/src/notifications/service-sse.integration.test.ts`
   Expected failure: `Cannot find module './service.js'`

3. After T3 and T5 complete, run test — verify PASS:
   `npm run test -- server/src/notifications/service-sse.integration.test.ts`
   Expected: PASS — registerPush wiring delivers notification to injected push function

4. Commit:
   `git add server/src/notifications/service-sse.integration.test.ts`
   `git commit -m "test(notifications): add integration test for registerPush → SSE push wiring"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-29-sidebar-inbox/sidebar-inbox.md — SSE Architecture section
server/src/notifications/service.ts — registerPush() dependency injection pattern

## WHY THIS APPROACH
Complexity: lightweight
Justification: Tests the DI contract between T3 (registerPush) and T5 (router wires pushNotificationToUser). pool mocked to return a notification row so pushFn is triggered.

## SANDWICH CONTEXT
[CRITICAL: do NOT import from sse.ts — test the registerPush injection contract only; sse.ts user-isolation is covered by T5's sse.test.ts]
You are writing an integration test that bridges T3 (service.ts registerPush) and T5 (router.ts wiring).
Files in scope: `server/src/notifications/service-sse.integration.test.ts` only
Available after: T3 completes + T5 completes

## DELIVERABLE
Given T3 + T5 both implemented, When CARD_ASSIGNED fires and pool.query returns a notification row, Then registerPush'd function called with (userId=assigneeId, workspaceId, notificationRow)

All tests PASS. Commit message: `test(notifications): add integration test for registerPush → SSE push wiring`

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - registerPush(pushFn) called BEFORE initNotificationService() in beforeEach
  - registerPush(() => {}) reset in afterEach to prevent push fn bleed
  - pool.query mock returns a notification row (INSERT RETURNING * must yield a row for pushFn to fire)

Must-not-have:
  - Importing from sse.ts (test only the DI contract)
  - Real HTTP/SSE connection

## STOP CONDITIONS
Done when: test PASS with T3+T5 implemented
Escalate when: pushFn not called after T3+T5 done → check if router.ts calls registerPush at module load

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | DB Schema Migration | prereq | lightweight | `make db-migrate` succeeds twice; notifications + workspace_settings tables exist |
| T2 | Domain Event Bus | prereq | lightweight | domainBus is EventEmitter; EVENTS.CARD_ASSIGNED === "card:assigned"; listener receives payload |
| T3 | Notification Service Core | T1, T2 | standard | actor!=assignee → INSERT called; actor==assignee → no INSERT; member joins → welcome + member_joined inserts |
| T4 | Route Event Emitters | T2 | standard | CARD_ASSIGNED emitted only on real assignee change (pre-fetch gating); MEMBER_JOINED emitted from BOTH members.ts and invites.ts |
| T5 | Notification REST API + SSE Hub | T3 | standard | GET /notifications returns list + unreadCount; SSE pushes notification.created; Last-Event-ID replays missed |
| T6 | Due Date Reminder Scheduler | T3 | lightweight | Card due today → reminder inserted; done column → skipped; second run → ON CONFLICT DO NOTHING |
| T7 | Client Hook + API Layer | T5 | standard | Hook fetches on mount; SSE notification.created increments unreadCount; markAllAsRead() zeroes count |
| T8 | InboxPage + Sidebar Wiring | T7 | standard | Unread = bold+dot; sourceDeleted = disabled+"Card no longer exists"; empty state; badge on sidebar |
| IT1 | Integration: Card Assignment Pipeline | T3, T4 | lightweight | Real domainBus: card:assigned → INSERT for assignee; member:joined → welcome + member_joined inserts |
| IT2 | Integration: Service→SSE Push Wiring | T3, T5 | lightweight | registerPush'd function called with (userId=assigneeId, workspaceId) after notification inserted |
