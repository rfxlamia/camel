import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import type { Test } from "supertest";
import { vi } from "vitest";
import type { AuthUser } from "../auth.js";
import { config } from "../config.js";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import {
	type AttachmentPair,
	type AttachmentStorage,
	LocalAttachmentStorage,
	setAttachmentStorageForTests,
} from "../lib/attachment-storage.js";
import {
	createRealtimeHub,
	setRealtimeHubForTests,
	type RealtimeHubDeps,
} from "../realtime.js";
import { api } from "../routes.js";

const { authenticatedViewer, viewerUsers } = vi.hoisted(() => {
	const viewerA: AuthUser = {
		id: 0,
		username: "attachments-system-viewer-a",
		displayName: "Viewer A",
		email: null,
		emailVerified: false,
		needsUsername: false,
	};
	const viewerB: AuthUser = {
		id: 0,
		username: "attachments-system-viewer-b",
		displayName: "Viewer B",
		email: null,
		emailVerified: false,
		needsUsername: false,
	};
	return {
		authenticatedViewer: { current: viewerA },
		viewerUsers: { viewerA, viewerB },
	};
});

vi.mock("../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../auth.js")>();
	return {
		...actual,
		requireAuth: (
			req: express.Request,
			_res: express.Response,
			next: express.NextFunction,
		) => {
			req.user = authenticatedViewer.current;
			next();
		},
	};
});

export const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);

export function pngFixture(size = 1024, width = 1, height = 1): Buffer {
	const bytes = Buffer.alloc(Math.max(size, 33), 0x61);
	bytes.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

export function uploadUrl(workspace: number, card: number): string {
	return `/api/workspaces/${workspace}/cards/${card}/attachments`;
}

export function attachPair(
	req: Test,
	thumbnail: Buffer,
	original: Buffer,
	index = 0,
): Test {
	return req
		.attach("thumbnail", thumbnail, {
			filename: `thumbnail-${index}.png`,
			contentType: "image/png",
		})
		.attach("original", original, {
			filename: `original-${index}.png`,
			contentType: "image/png",
		});
}

export async function attachmentRows(card: number): Promise<
	Array<{
		id: number;
		thumbnail_path: string;
		original_path: string;
	}>
> {
	return db
		.selectFrom("attachments")
		.select(["id", "thumbnail_path", "original_path"])
		.where("card_id", "=", card)
		.orderBy("id")
		.execute();
}

async function createTestStorage(): Promise<LocalAttachmentStorage> {
	const root = path.join(config.ATTACHMENTS_DIR, `t15-${randomUUID()}`);
	await mkdir(root, { recursive: true });
	return new LocalAttachmentStorage(root);
}

async function removeTestStorage(testStorage: AttachmentStorage): Promise<void> {
	await rm(testStorage.root, { recursive: true, force: true });
}

export type SystemFixture = {
	workspaceId: number;
	cardId: number;
	pairs: AttachmentPair[];
	storage: AttachmentStorage;
	hub: ReturnType<typeof createRealtimeHub>;
	viewerA: AuthUser;
	viewerB: AuthUser;
};

export function setAuthenticatedViewer(viewer: AuthUser): void {
	authenticatedViewer.current = viewer;
}

export function connectViewerSse(
	hub: ReturnType<typeof createRealtimeHub>,
	{
		workspaceId,
		user,
	}: {
		workspaceId: number;
		user: AuthUser;
	},
) {
	const subscriberRequest = new EventEmitter() as EventEmitter & {
		params: { workspaceId: string };
		user: AuthUser;
	};
	subscriberRequest.params = { workspaceId: String(workspaceId) };
	subscriberRequest.user = user;
	const chunks: string[] = [];
	const subscriberResponse = {
		writeHead: vi.fn(),
		write: (chunk: string) => {
			chunks.push(chunk);
			return true;
		},
		end: vi.fn(),
	};
	hub.sseHandler(subscriberRequest as never, subscriberResponse as never);
	return {
		chunks,
		close: () => subscriberRequest.emit("close"),
	};
}

export function parseSseDataEvents(
	chunks: string[],
): Array<Record<string, unknown>> {
	return chunks
		.filter((chunk) => chunk.startsWith("data: "))
		.map((chunk) => JSON.parse(chunk.slice(6).trim()) as Record<string, unknown>);
}

async function ensureViewerUsers(): Promise<void> {
	const suffix = randomUUID();
	for (const spec of [
		{ key: "viewerA" as const, label: "Viewer A" },
		{ key: "viewerB" as const, label: "Viewer B" },
	]) {
		const row = await db
			.insertInto("users")
			.values({
				username: `attachments-system-${spec.key}-${suffix}`,
				display_name: spec.label,
				password_hash: "fixture-password-hash",
			})
			.returning(["id", "username", "display_name"])
			.executeTakeFirstOrThrow();
		viewerUsers[spec.key] = {
			id: row.id,
			username: row.username,
			displayName: row.display_name,
			email: null,
			emailVerified: false,
			needsUsername: false,
		};
	}
	authenticatedViewer.current = viewerUsers.viewerA;
}

async function createOwnedWorkspace(
	ownerId: number,
	name: string,
): Promise<number> {
	const workspace = await db
		.insertInto("workspaces")
		.values({ name, owner_user_id: ownerId })
		.returning("id")
		.executeTakeFirstOrThrow();
	await db
		.insertInto("workspace_members")
		.values({ workspace_id: workspace.id, user_id: ownerId, role: "owner" })
		.execute();
	await seedTrackerVocabulary(db, workspace.id);
	return workspace.id;
}

async function createWorkspaceCard(workspaceId: number, title: string): Promise<number> {
	const status = await db
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.where("slot", "=", "todo")
		.executeTakeFirstOrThrow();
	const column = await db
		.insertInto("columns")
		.values({
			workspace_id: workspaceId,
			title: "Todo",
			position: 1024,
			policy: "manual",
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	const card = await db
		.insertInto("cards")
		.values({
			workspace_id: workspaceId,
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

export async function createSystemFixture(
	existingCount: number,
	fixtureStorage: AttachmentStorage,
	hub: ReturnType<typeof createRealtimeHub>,
): Promise<SystemFixture> {
	await ensureViewerUsers();
	const workspaceId = await createOwnedWorkspace(
		viewerUsers.viewerA.id,
		`Attachment system ${randomUUID()}`,
	);
	await db
		.insertInto("workspace_members")
		.values({
			workspace_id: workspaceId,
			user_id: viewerUsers.viewerB.id,
			role: "member",
		})
		.execute();
	const cardId = await createWorkspaceCard(workspaceId, "System attachment card");
	const pairs: AttachmentPair[] = [];
	for (let index = 0; index < existingCount; index += 1) {
		const pair = await fixtureStorage.writePair(
			Buffer.from(`existing-thumbnail-${index}`),
			Buffer.from(`existing-original-${index}`),
		);
		pairs.push(pair);
		await db
			.insertInto("attachments")
			.values({
				card_id: cardId,
				mime_type: "image/png",
				thumbnail_path: pair.thumbnailPath,
				original_path: pair.originalPath,
				thumbnail_size_bytes: 20,
				original_size_bytes: 19,
			})
			.execute();
	}
	return {
		workspaceId,
		cardId,
		pairs,
		storage: fixtureStorage,
		hub,
		viewerA: viewerUsers.viewerA,
		viewerB: viewerUsers.viewerB,
	};
}

async function cleanupSystemUploadFixture(fixture: SystemFixture): Promise<void> {
	await db.deleteFrom("workspaces").where("id", "=", fixture.workspaceId).execute();
	await fixture.storage.removePairs(fixture.pairs);
}

export async function withSystemFixture<T>(
	existingCount: number,
	callback: (fixture: SystemFixture) => Promise<T>,
	deps: RealtimeHubDeps = { publisher: null, subscriber: null },
): Promise<T> {
	const fixtureStorage = await createTestStorage();
	const hub = createRealtimeHub(deps);
	setAttachmentStorageForTests(fixtureStorage);
	setRealtimeHubForTests(hub);
	const fixture = await createSystemFixture(existingCount, fixtureStorage, hub);
	try {
		return await callback(fixture);
	} finally {
		await cleanupSystemUploadFixture(fixture);
		setAttachmentStorageForTests(null);
		setRealtimeHubForTests(null);
		await removeTestStorage(fixtureStorage);
	}
}
