import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import cookieParser from "cookie-parser";
import express from "express";
import { afterAll, beforeAll, vi } from "vitest";

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

import { config } from "../config.js";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";

export { db };

import { pool } from "../db/pool.js";

export { pool };

import {
	type AttachmentPair,
	LocalAttachmentStorage,
	setAttachmentStorageForTests,
} from "../lib/attachment-storage.js";

export { setAttachmentStorageForTests };

import { createRealtimeHub, setRealtimeHubForTests } from "../realtime.js";

export { createRealtimeHub, setRealtimeHubForTests };

import { api } from "../routes.js";
import {
	createAttachmentOwnershipGuard,
	setExistingCardAttachmentCapacityHookForTests,
} from "./card-attachments.js";

export { setExistingCardAttachmentCapacityHookForTests };

export const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);

export const cardOnlyGuardApp = express();
cardOnlyGuardApp.use((req, _res, next) => {
	req.user = testUser;
	next();
});
cardOnlyGuardApp.get(
	"/workspaces/:workspaceId/cards/:cardId",
	createAttachmentOwnershipGuard({ requireAttachment: false }),
	(_req, res) => res.sendStatus(204),
);

export const thumbnailBytes = Buffer.from("thumbnail-bytes");
export const originalBytes = Buffer.from("original-bytes");
export let storage: LocalAttachmentStorage;
let attachmentPair: AttachmentPair;
export let workspaceId: number;
export let cardId: number;
export let attachmentId: number;
export let otherWorkspaceId: number;
export let otherCardId: number;
export let otherAttachmentId: number;

export async function createWorkspace(name: string): Promise<number> {
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

export async function createCard(
	workspace: number,
	title: string,
): Promise<number> {
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

export const deliveryUrl = (
	workspace: number,
	card: number,
	attachment: number,
	variant: "thumbnail" | "original" = "thumbnail",
) =>
	`/api/workspaces/${workspace}/cards/${card}/attachments/${attachment}/${variant}`;

beforeAll(async () => {
	await mkdir(config.ATTACHMENTS_DIR, { recursive: true });
	storage = new LocalAttachmentStorage(config.ATTACHMENTS_DIR);
	setAttachmentStorageForTests(storage);
	setRealtimeHubForTests(
		createRealtimeHub({ publisher: null, subscriber: null }),
	);
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
	workspaceId = await createWorkspace(`Attachment delivery ${randomUUID()}`);
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
		await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
	}
	if (otherWorkspaceId !== undefined) {
		await db
			.deleteFrom("workspaces")
			.where("id", "=", otherWorkspaceId)
			.execute();
	}
	if (attachmentPair !== undefined) await storage.removePair(attachmentPair);
	setAttachmentStorageForTests(null);
	setRealtimeHubForTests(null);
	await pool.end();
});

export { testUser };
