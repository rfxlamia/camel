# Sidebar Inbox — Notification Center — DB Schema Migration (Phase 1 of 3)

**Date:** 2026-06-29
**Original plan:** docs/pocket/plans/2026-06-29-sidebar-inbox/execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3, T4}
**Unlocks next:** Phase 2

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

T1: DB Schema Migration [prereq]
T2: Domain Event Bus [prereq] [parallel: T1]
T3: Notification Service Core [depends: T1, T2]
T4: Route Event Emitters [depends: T2] [parallel: T3]

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

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
