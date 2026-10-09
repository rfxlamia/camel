# Sidebar Inbox — Notification Center — Notification REST API + SSE Hub (Phase 2 of 3)

**Date:** 2026-06-29
**Original plan:** docs/pocket/plans/2026-06-29-sidebar-inbox/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T5, T6, T7}
**Unlocks next:** Phase 3

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T5: Notification REST API + SSE Hub [depends: T3]
T6: Due Date Reminder Scheduler [depends: T3] [parallel: T5]
T7: Client Notifications Hook + API Layer [depends: T5]

---

## Pocket Packets

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

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
