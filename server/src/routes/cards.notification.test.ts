/**
 * Integration tests for domain event emission from the cards routes
 * (CARD_ASSIGNED, CARD_DELETED, CARD_DUE_DATE_CHANGED).
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/routes/cards.notification.test.ts
 */
import "dotenv/config";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";

vi.mock("../realtime.js", () => ({
	publishEvent: vi.fn(),
	clearPresence: vi.fn(),
}));
vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: (_req: unknown, _res: unknown, next: () => void) =>
		next(),
}));

const { cardsRouter } = await import("./cards.js");

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as Record<string, unknown>).user = { id: userId, displayName: "Bob" };
	(req as Record<string, unknown>).workspace = {
		workspaceId,
		role: "owner",
	};
	next();
});
app.use("/workspaces/:workspaceId", cardsRouter);

let workspaceId: number;
let userId: number;
let assigneeId: number;
let columnId: number;
let signableColumnId: number;
let backlogStatusId: number;

async function statusIdForSlot(slot: string) {
	const row = await db
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.where("slot", "=", slot)
		.executeTakeFirstOrThrow();
	return row.id;
}

async function insertCard(title: string, targetColumnId: number, version = 1) {
	const row = await db
		.insertInto("cards")
		.values({
			title,
			column_id: targetColumnId,
			position: 1000,
			version,
			workspace_id: workspaceId,
			status_id:
				targetColumnId === signableColumnId
					? await statusIdForSlot("done")
					: backlogStatusId,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return row.id;
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"cards routes — domain event emission (real DB)",
	() => {
		beforeAll(async () => {
			const user = await db
				.insertInto("users")
				.values({
					username: `cards-notif-${Date.now()}`,
					display_name: "Bob",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			userId = user.id;

			const assignee = await db
				.insertInto("users")
				.values({
					username: `cards-notif-assignee-${Date.now()}`,
					display_name: "Alice",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			assigneeId = assignee.id;

			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: "Cards Notif WS",
					owner_user_id: userId,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;
			await seedTrackerVocabulary(db, workspaceId);
			backlogStatusId = await statusIdForSlot("backlog");

			await db
				.insertInto("workspace_members")
				.values([
					{ workspace_id: workspaceId, user_id: userId, role: "owner" },
					{ workspace_id: workspaceId, user_id: assigneeId, role: "member" },
				])
				.execute();

			const column = await db
				.insertInto("columns")
				.values({ title: "Backlog", position: 1000, workspace_id: workspaceId })
				.returning("id")
				.executeTakeFirstOrThrow();
			columnId = column.id;

			const signableColumn = await db
				.insertInto("columns")
				.values({
					title: "Done",
					position: 2000,
					workspace_id: workspaceId,
					is_signable: true,
					signable_assignee_id: assigneeId,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			signableColumnId = signableColumn.id;
		});

		afterEach(async () => {
			domainBus.removeAllListeners();
			await db.deleteFrom("cards").where("workspace_id", "=", workspaceId).execute();
		});

		it("emits CARD_ASSIGNED when card is PATCHed with a new assignee", async () => {
			const cardId = await insertCard("Fix bug", columnId);

			const received: unknown[] = [];
			domainBus.once(EVENTS.CARD_ASSIGNED, (e) => received.push(e));

			const res = await request(app)
				.patch(`/workspaces/${workspaceId}/cards/${cardId}`)
				.send({ assigneeIds: [assigneeId], version: 1 });

			expect(res.status).toBe(200);
			expect(received).toHaveLength(1);
			expect(
				(received[0] as { payload: { assigneeId: number } }).payload.assigneeId,
			).toBe(assigneeId);
			expect(
				(received[0] as { payload: { actorDisplayName: string } }).payload
					.actorDisplayName,
			).toBe("Bob");
		});

		it("does NOT emit CARD_ASSIGNED when assignee is unchanged", async () => {
			const cardId = await insertCard("Fix bug", columnId);

			await request(app)
				.patch(`/workspaces/${workspaceId}/cards/${cardId}`)
				.send({ assigneeIds: [assigneeId], version: 1 });

			const received: unknown[] = [];
			domainBus.on(EVENTS.CARD_ASSIGNED, (e) => received.push(e));

			const res = await request(app)
				.patch(`/workspaces/${workspaceId}/cards/${cardId}`)
				.send({ assigneeIds: [assigneeId], version: 2 });

			expect(res.status).toBe(200);
			expect(received).toHaveLength(0);
		});

		it("emits CARD_ASSIGNED when card is created with an auto-signable assignee", async () => {
			const received: unknown[] = [];
			domainBus.once(EVENTS.CARD_ASSIGNED, (e) => received.push(e));

			const res = await request(app)
				.post(`/workspaces/${workspaceId}/cards`)
				.send({ columnId: signableColumnId, title: "Fix bug" });

			expect(res.status).toBe(201);
			expect(received).toHaveLength(1);
			expect(
				(received[0] as { payload: { assigneeId: number } }).payload.assigneeId,
			).toBe(assigneeId);
		});

		it("emits CARD_DELETED when card is soft-deleted", async () => {
			const cardId = await insertCard("Fix bug", columnId);

			const received: unknown[] = [];
			domainBus.once(EVENTS.CARD_DELETED, (e) => received.push(e));

			const res = await request(app).delete(
				`/workspaces/${workspaceId}/cards/${cardId}`,
			);

			expect(res.status).toBe(204);
			expect(received).toHaveLength(1);
			expect(
				(received[0] as { payload: { cardId: number } }).payload.cardId,
			).toBe(cardId);
		});

		it("emits CARD_DUE_DATE_CHANGED when due_date is PATCHed on assigned card", async () => {
			const cardId = await insertCard("Fix bug", columnId);
			await request(app)
				.patch(`/workspaces/${workspaceId}/cards/${cardId}`)
				.send({ assigneeIds: [assigneeId], version: 1 });

			const received: unknown[] = [];
			domainBus.once(EVENTS.CARD_DUE_DATE_CHANGED, (e) => received.push(e));

			const res = await request(app)
				.patch(`/workspaces/${workspaceId}/cards/${cardId}`)
				.send({ dueDate: "2026-07-01", version: 2 });

			expect(res.status).toBe(200);
			expect(received).toHaveLength(1);
			expect(
				(received[0] as { payload: { newDueDate: string } }).payload.newDueDate,
			).toBe("2026-07-01");
		});
	},
);
