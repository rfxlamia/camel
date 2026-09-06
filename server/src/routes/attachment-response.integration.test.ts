import "dotenv/config";
import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { testUser } = vi.hoisted(() => ({
	testUser: {
		id: 1,
		username: "attachment-response-user",
		displayName: "Attachment Response User",
	},
}));

vi.mock("../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../auth.js")>();
	return {
		...actual,
		requireAuth: (
			req: express.Request,
			_res: express.Response,
			next: express.NextFunction,
		) => {
			req.user = testUser;
			next();
		},
	};
});

vi.mock("../realtime.js", () => ({
	publishEvent: vi.fn(),
	clearPresence: vi.fn(),
	heartbeat: vi.fn(),
	onlineUsers: vi.fn().mockResolvedValue([]),
	sseHandler: vi.fn(),
}));

import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { api } from "../routes.js";

const runIntegration = Boolean(process.env.RUN_INTEGRATION);
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);

describe.skipIf(!runIntegration)(
	"attachment response hydration (real PostgreSQL)",
	() => {
		let workspaceId: number;
		let cardId: number;
		let thisExpectedOrder: number[] = [];

		beforeAll(async () => {
			await db
				.insertInto("users")
				.values({
					id: testUser.id,
					username: `${testUser.username}-${randomUUID()}`,
					display_name: testUser.displayName,
					password_hash: "fixture-password-hash",
				})
				.onConflict((oc) => oc.column("id").doNothing())
				.execute();

			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: `Attachment response ${randomUUID()}`,
					owner_user_id: testUser.id,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;

			await db
				.insertInto("workspace_members")
				.values({
					workspace_id: workspaceId,
					user_id: testUser.id,
					role: "owner",
				})
				.onConflict((oc) => oc.doNothing())
				.execute();

			const column = await db
				.insertInto("columns")
				.values({
					workspace_id: workspaceId,
					title: "Todo",
					position: 1,
					policy: "manual",
				})
				.returning("id")
				.executeTakeFirstOrThrow();

			const status = await db
				.insertInto("tracker_vocabularies")
				.values({
					workspace_id: workspaceId,
					kind: "status",
					name: "Todo",
					position: 1,
					colour: "#888888",
					slot: "todo",
				})
				.returning("id")
				.executeTakeFirstOrThrow();

			const card = await db
				.insertInto("cards")
				.values({
					workspace_id: workspaceId,
					column_id: column.id,
					status_id: status.id,
					title: "Attachment response card",
					description: "",
					position: 1,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			cardId = card.id;

			const insertedAttachments = await db
				.insertInto("attachments")
				.values([
					{
						card_id: cardId,
						mime_type: "image/png",
						thumbnail_path: "fixture/thumbnail-new",
						original_path: "fixture/original-new",
						thumbnail_size_bytes: 10,
						original_size_bytes: 20,
						created_at: "2026-09-05T10:00:01.000Z",
					},
					{
						card_id: cardId,
						mime_type: "image/jpeg",
						thumbnail_path: "fixture/thumbnail-old",
						original_path: "fixture/original-old",
						thumbnail_size_bytes: 11,
						original_size_bytes: 21,
						created_at: "2026-09-05T10:00:00.000Z",
					},
				])
				.returning("id")
				.execute();
			thisExpectedOrder = [
				insertedAttachments[1].id,
				insertedAttachments[0].id,
			];
		});

		afterAll(async () => {
			if (workspaceId !== undefined) {
				await db
					.deleteFrom("workspaces")
					.where("id", "=", workspaceId)
					.execute();
			}
			await pool.end();
		});

		it("hydrates the same safe, ordered attachments on board and card detail", async () => {
			const board = await request(app).get(
				`/api/workspaces/${workspaceId}/board`,
			);
			const detail = await request(app).get(
				`/api/workspaces/${workspaceId}/cards/${cardId}`,
			);

			expect(board.status).toBe(200);
			expect(detail.status).toBe(200);
			const boardCard = board.body.columns[0].cards.find(
				(card: { id: number }) => card.id === cardId,
			);
			expect(boardCard).toBeDefined();
			expect(boardCard.attachments).toEqual(detail.body.attachments);
			expect(
				boardCard.attachments.map(
					(attachment: { id: number }) => attachment.id,
				),
			).toEqual(thisExpectedOrder);
			const serialized = JSON.stringify(detail.body);
			expect(serialized).not.toContain("fixture/thumbnail");
			expect(serialized).not.toContain("fixture/original");
			expect(serialized).not.toContain("thumbnail_path");
			expect(serialized).not.toContain("original_path");
		});
	},
);
