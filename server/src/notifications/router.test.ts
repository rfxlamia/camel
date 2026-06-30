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
import { requireAuth } from "../auth.js";
import { notificationsRouter } from "./router.js";

const mockQuery = vi.mocked(pool.query);
const app = express();
app.use(express.json());
app.use(requireAuth);
app.use("/workspaces/:workspaceId/notifications", notificationsRouter);

describe("GET /workspaces/:workspaceId/notifications", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns notifications list with unreadCount", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [
					{
						id: 1,
						type: "card_assigned",
						title: "Bob assigned...",
						read_at: null,
						source_deleted: false,
						created_at: new Date().toISOString(),
						card_id: 10,
						board_id: 1,
						actor_id: 7,
					},
				],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({ rows: [{ count: "2" }], rowCount: 1 } as never);

		const res = await request(app).get("/workspaces/1/notifications");
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty("notifications");
		expect(res.body).toHaveProperty("unreadCount", 2);
		expect(res.body.notifications[0]).toMatchObject({ boardId: 1 });
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
		mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }], rowCount: 1 } as never);
		const spy = vi.spyOn(domainBus, "emit");

		const res = await request(app)
			.post("/workspaces/1/notifications/system-alert")
			.send({ title: "Maintenance tonight", body: "Server restart at midnight" });

		expect(res.status).toBe(202);
		expect(spy).toHaveBeenCalledWith(
			EVENTS.SYSTEM_ALERT,
			expect.objectContaining({
				payload: expect.objectContaining({ title: "Maintenance tonight" }),
			}),
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
