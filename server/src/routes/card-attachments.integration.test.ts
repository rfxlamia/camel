import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { testUser } = vi.hoisted(() => ({
	testUser: {
		id: 1,
		username: "card-attachments-user",
		displayName: "Card Attachments User",
		email: null,
		emailVerified: false,
		needsUsername: false,
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

import { config } from "../config.js";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import {
	type AttachmentPair,
	LocalAttachmentStorage,
} from "../lib/attachment-storage.js";
import { api } from "../routes.js";
import { createAttachmentOwnershipGuard } from "./card-attachments.js";

const runIntegration = Boolean(process.env.RUN_INTEGRATION);
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);

const cardOnlyGuardApp = express();
cardOnlyGuardApp.use((req, _res, next) => {
	req.user = testUser;
	next();
});
cardOnlyGuardApp.get(
	"/workspaces/:workspaceId/cards/:cardId",
	createAttachmentOwnershipGuard({ requireAttachment: false }),
	(_req, res) => res.sendStatus(204),
);

const thumbnailBytes = Buffer.from("thumbnail-bytes");
const originalBytes = Buffer.from("original-bytes");
let storage: LocalAttachmentStorage;
let attachmentPair: AttachmentPair;
let workspaceId: number;
let cardId: number;
let attachmentId: number;
let otherWorkspaceId: number;
let otherCardId: number;
let otherAttachmentId: number;

async function createWorkspace(name: string): Promise<number> {
	const workspace = await db
		.insertInto("workspaces")
		.values({ name, owner_user_id: 1 })
		.returning("id")
		.executeTakeFirstOrThrow();
	await db
		.insertInto("workspace_members")
		.values({ workspace_id: workspace.id, user_id: 1, role: "owner" })
		.execute();
	await seedTrackerVocabulary(db, workspace.id);
	return workspace.id;
}

async function createCard(workspace: number, title: string): Promise<number> {
	const status = await db
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", workspace)
		.where("kind", "=", "status")
		.where("slot", "=", "todo")
		.executeTakeFirstOrThrow();
	const column = await db
		.insertInto("columns")
		.values({
			workspace_id: workspace,
			title: "Todo",
			position: 1024,
			policy: "manual",
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	const card = await db
		.insertInto("cards")
		.values({
			workspace_id: workspace,
			column_id: column.id,
			status_id: status.id,
			title,
			description: "",
			position: 1024,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return card.id;
}

const deliveryUrl = (
	workspace: number,
	card: number,
	attachment: number,
	variant: "thumbnail" | "original" = "thumbnail",
) =>
	`/api/workspaces/${workspace}/cards/${card}/attachments/${attachment}/${variant}`;

describe.skipIf(!runIntegration)(
	"authenticated card attachment delivery",
	() => {
		beforeAll(async () => {
			await mkdir(config.ATTACHMENTS_DIR, { recursive: true });
			storage = new LocalAttachmentStorage(config.ATTACHMENTS_DIR);
			attachmentPair = await storage.writePair(thumbnailBytes, originalBytes);

			await db
				.insertInto("users")
				.values({
					id: 1,
					username: `card-attachments-${randomUUID()}`,
					display_name: "Card Attachments User",
					password_hash: "fixture-password-hash",
				})
				.onConflict((oc) => oc.column("id").doNothing())
				.execute();
			workspaceId = await createWorkspace(
				`Attachment delivery ${randomUUID()}`,
			);
			cardId = await createCard(workspaceId, "Private attachment card");
			const attachment = await db
				.insertInto("attachments")
				.values({
					card_id: cardId,
					mime_type: "image/png",
					thumbnail_path: attachmentPair.thumbnailPath,
					original_path: attachmentPair.originalPath,
					thumbnail_size_bytes: thumbnailBytes.length,
					original_size_bytes: originalBytes.length,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			attachmentId = attachment.id;

			otherWorkspaceId = await createWorkspace(
				`Other attachment delivery ${randomUUID()}`,
			);
			otherCardId = await createCard(otherWorkspaceId, "Other workspace card");
			const otherAttachment = await db
				.insertInto("attachments")
				.values({
					card_id: otherCardId,
					mime_type: "image/png",
					thumbnail_path: attachmentPair.thumbnailPath,
					original_path: attachmentPair.originalPath,
					thumbnail_size_bytes: thumbnailBytes.length,
					original_size_bytes: originalBytes.length,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			otherAttachmentId = otherAttachment.id;
		});

		afterAll(async () => {
			if (workspaceId !== undefined) {
				await db
					.deleteFrom("workspaces")
					.where("id", "=", workspaceId)
					.execute();
			}
			if (otherWorkspaceId !== undefined) {
				await db
					.deleteFrom("workspaces")
					.where("id", "=", otherWorkspaceId)
					.execute();
			}
			if (attachmentPair !== undefined)
				await storage.removePair(attachmentPair);
			await pool.end();
		});

		it("supports card-only authorization without an attachment id", async () => {
			testUser.id = 1;
			const authorized = await request(cardOnlyGuardApp).get(
				`/workspaces/${workspaceId}/cards/${cardId}`,
			);
			expect(authorized.status).toBe(204);

			const wrongCardWorkspace = await request(cardOnlyGuardApp).get(
				`/workspaces/${workspaceId}/cards/${otherCardId}`,
			);
			expect(wrongCardWorkspace.status).toBe(404);

			testUser.id = 2;
			const nonMember = await request(cardOnlyGuardApp).get(
				`/workspaces/${workspaceId}/cards/${cardId}`,
			);
			expect(nonMember.status).toBe(404);
		});

		it("serves bytes only when the member, card, and attachment share the workspace", async () => {
			testUser.id = 1;
			const authorized = await request(app).get(
				deliveryUrl(workspaceId, cardId, attachmentId),
			);
			expect(authorized.status).toBe(200);
			expect(authorized.body).toEqual(thumbnailBytes);

			const original = await request(app).get(
				deliveryUrl(workspaceId, cardId, attachmentId, "original"),
			);
			expect(original.status).toBe(200);
			expect(original.body).toEqual(originalBytes);

			testUser.id = 2;
			const nonMember = await request(app).get(
				deliveryUrl(workspaceId, cardId, attachmentId),
			);
			expect([403, 404]).toContain(nonMember.status);

			testUser.id = 1;
			const crossWorkspace = await request(app).get(
				deliveryUrl(workspaceId, otherCardId, otherAttachmentId),
			);
			expect([403, 404]).toContain(crossWorkspace.status);
		});

		it("uses private caching and returns 304 for a matching ETag", async () => {
			testUser.id = 1;
			const first = await request(app).get(
				deliveryUrl(workspaceId, cardId, attachmentId, "original"),
			);
			expect(first.status).toBe(200);
			expect(first.headers["cache-control"]).toBe("private, max-age=300");
			expect(first.headers.etag).toBeTruthy();

			const revalidated = await request(app)
				.get(deliveryUrl(workspaceId, cardId, attachmentId, "original"))
				.set("If-None-Match", first.headers.etag);
			expect(revalidated.status).toBe(304);
			expect(revalidated.body).toEqual({});
		});

		it("keeps inline originals separate from forced downloads", async () => {
			testUser.id = 1;
			const inline = await request(app).get(
				deliveryUrl(workspaceId, cardId, attachmentId, "original"),
			);
			expect(inline.status).toBe(200);
			expect(inline.headers["content-disposition"]).toBe("inline");
			expect(inline.headers["cache-control"]).toBe("private, max-age=300");

			const download = await request(app).get(
				`${deliveryUrl(workspaceId, cardId, attachmentId, "original")}/download`,
			);
			expect(download.status).toBe(200);
			expect(download.headers["content-disposition"]).toMatch(
				/^attachment; filename="[a-zA-Z0-9._-]+"$/,
			);
		});
	},
);
