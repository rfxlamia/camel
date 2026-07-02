/**
 * Integration tests for the notifications router (list/read/read-all/system-alert).
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/notifications/router.test.ts
 */
import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";

vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

const { notificationsRouter } = await import("./router.js");

let userId: number;
let workspaceId: number;

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		(req as Record<string, unknown>).user = { id: userId, displayName: "Alice" };
		next();
	});
	app.use("/workspaces/:workspaceId/notifications", notificationsRouter);
	return app;
}
let app: ReturnType<typeof createApp>;

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"notifications router (real DB)",
	() => {
		beforeAll(async () => {
			const user = await db
				.insertInto("users")
				.values({ username: `notif-router-${Date.now()}`, display_name: "Alice", password_hash: "h" })
				.returning("id")
				.executeTakeFirstOrThrow();
			userId = user.id;
			const workspace = await db
				.insertInto("workspaces")
				.values({ name: "Notif Router WS", owner_user_id: userId, is_personal: false })
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;
			await db
				.insertInto("workspace_members")
				.values({ workspace_id: workspaceId, user_id: userId, role: "member" })
				.execute();
			app = createApp();
		});

		afterAll(async () => {
			await db.deleteFrom("notifications").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("workspace_members").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db.deleteFrom("users").where("id", "=", userId).execute();
		});

		beforeEach(async () => {
			await db.deleteFrom("notifications").where("workspace_id", "=", workspaceId).execute();
		});

		describe("GET /workspaces/:workspaceId/notifications", () => {
			it("returns notifications list with unreadCount", async () => {
				await db
					.insertInto("notifications")
					.values([
						{
							user_id: userId,
							workspace_id: workspaceId,
							type: "card_assigned",
							title: "Bob assigned...",
							board_id: workspaceId,
						},
						{
							user_id: userId,
							workspace_id: workspaceId,
							type: "welcome",
							title: "Welcome!",
						},
					])
					.execute();

				const res = await request(app).get(`/workspaces/${workspaceId}/notifications`);
				expect(res.status).toBe(200);
				expect(res.body.notifications).toHaveLength(2);
				expect(res.body.unreadCount).toBe(2);
				expect(res.body.notifications[0]).toMatchObject({ boardId: workspaceId });
			});
		});

		describe("PATCH /workspaces/:workspaceId/notifications/:id/read", () => {
			it("marks notification as read", async () => {
				const n = await db
					.insertInto("notifications")
					.values({ user_id: userId, workspace_id: workspaceId, type: "welcome", title: "Hi" })
					.returning("id")
					.executeTakeFirstOrThrow();

				const res = await request(app).patch(
					`/workspaces/${workspaceId}/notifications/${n.id}/read`,
				);
				expect(res.status).toBe(200);
				expect(res.body).toEqual({ ok: true });

				const row = await db
					.selectFrom("notifications")
					.select("read_at")
					.where("id", "=", n.id)
					.executeTakeFirstOrThrow();
				expect(row.read_at).not.toBeNull();
			});

			it("returns 404 for unknown notification", async () => {
				const res = await request(app).patch(
					`/workspaces/${workspaceId}/notifications/999999/read`,
				);
				expect(res.status).toBe(404);
			});
		});

		describe("POST /workspaces/:workspaceId/notifications/read-all", () => {
			it("marks all as read and returns markedCount", async () => {
				await db
					.insertInto("notifications")
					.values([
						{ user_id: userId, workspace_id: workspaceId, type: "welcome", title: "1" },
						{ user_id: userId, workspace_id: workspaceId, type: "welcome", title: "2" },
					])
					.execute();

				const res = await request(app).post(
					`/workspaces/${workspaceId}/notifications/read-all`,
				);
				expect(res.status).toBe(200);
				expect(res.body).toEqual({ ok: true, markedCount: 2 });
			});
		});

		describe("POST /workspaces/:workspaceId/notifications/system-alert", () => {
			it("returns 202 when admin posts a system alert", async () => {
				await db
					.updateTable("workspace_members")
					.set({ role: "admin" })
					.where("workspace_id", "=", workspaceId)
					.where("user_id", "=", userId)
					.execute();
				const spy = vi.spyOn(domainBus, "emit");

				const res = await request(app)
					.post(`/workspaces/${workspaceId}/notifications/system-alert`)
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
				await db
					.updateTable("workspace_members")
					.set({ role: "member" })
					.where("workspace_id", "=", workspaceId)
					.where("user_id", "=", userId)
					.execute();

				const res = await request(app)
					.post(`/workspaces/${workspaceId}/notifications/system-alert`)
					.send({ title: "Alert" });
				expect(res.status).toBe(403);
			});
		});
	},
);
