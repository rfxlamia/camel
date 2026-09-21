import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthUser } from "../../auth.js";
import { db } from "../../db/kysely.js";
import {
	type AttachmentPair,
	type AttachmentStorage,
	setAttachmentStorageForTests,
} from "../../lib/attachment-storage.js";
import {
	createRealtimeHub,
	type RealtimeHubDeps,
	setRealtimeHubForTests,
} from "../../realtime.js";
import {
	invokeClientCreateCard,
	resetClientRequestBoundary,
} from "./attachments-system.client-bridge.js";
import {
	app,
	createOwnedWorkspace,
	createTestStorage,
	ensureViewerUsers,
	removeTestStorage,
	setAuthenticatedViewer,
	viewerUsers,
} from "./attachments-system.support.js";

export type CreateFixture = {
	workspaceId: number;
	columnId: number;
	storage: AttachmentStorage;
	viewerA: AuthUser;
	baseUrl: string;
	countCards: () => Promise<number>;
	listAttachments: (
		cardId: number,
	) => Promise<Array<{ id: number; mime_type: string }>>;
};

async function startAppServer(): Promise<{ server: Server; baseUrl: string }> {
	const server = createServer(app);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to bind attachment system test server");
	}
	return {
		server,
		baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
	};
}

async function stopAppServer(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

async function createWorkspaceColumn(workspaceId: number): Promise<number> {
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
	return column.id;
}

async function createCreateFixture(
	fixtureStorage: AttachmentStorage,
): Promise<Omit<CreateFixture, "baseUrl">> {
	await ensureViewerUsers();
	const workspaceId = await createOwnedWorkspace(
		viewerUsers.viewerA.id,
		`Attachment create system ${randomUUID()}`,
	);
	const columnId = await createWorkspaceColumn(workspaceId);
	return {
		workspaceId,
		columnId,
		storage: fixtureStorage,
		viewerA: viewerUsers.viewerA,
		countCards: async () => {
			const rows = await db
				.selectFrom("cards")
				.select("id")
				.where("workspace_id", "=", workspaceId)
				.execute();
			return rows.length;
		},
		listAttachments: async (cardId: number) =>
			db
				.selectFrom("attachments")
				.select(["id", "mime_type"])
				.where("card_id", "=", cardId)
				.orderBy("id")
				.execute(),
	};
}

async function cleanupCreateFixture(
	fixture: Omit<CreateFixture, "baseUrl">,
): Promise<void> {
	await db
		.deleteFrom("workspaces")
		.where("id", "=", fixture.workspaceId)
		.execute();
}

export async function withCreateFixture<T>(
	callback: (fixture: CreateFixture) => Promise<T>,
): Promise<T> {
	const fixtureStorage = await createTestStorage();
	const hub = createRealtimeHub({ publisher: null, subscriber: null });
	setAttachmentStorageForTests(fixtureStorage);
	setRealtimeHubForTests(hub);
	const baseFixture = await createCreateFixture(fixtureStorage);
	const { server, baseUrl } = await startAppServer();
	const fixture: CreateFixture = { ...baseFixture, baseUrl };
	try {
		return await callback(fixture);
	} finally {
		await resetClientRequestBoundary();
		await stopAppServer(server);
		await cleanupCreateFixture(baseFixture);
		setAttachmentStorageForTests(null);
		setRealtimeHubForTests(null);
		await removeTestStorage(fixtureStorage);
	}
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

async function createWorkspaceCard(
	workspaceId: number,
	title: string,
): Promise<number> {
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
	const cardId = await createWorkspaceCard(
		workspaceId,
		"System attachment card",
	);
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

async function cleanupSystemUploadFixture(
	fixture: SystemFixture,
): Promise<void> {
	await db
		.deleteFrom("workspaces")
		.where("id", "=", fixture.workspaceId)
		.execute();
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

export async function submitStagedClientCreate(
	fixture: CreateFixture,
	{
		title,
		thumbnail,
		original,
	}: {
		title: string;
		thumbnail: Buffer;
		original: Buffer;
	},
) {
	setAuthenticatedViewer(fixture.viewerA);
	return invokeClientCreateCard({
		baseUrl: fixture.baseUrl,
		workspaceId: fixture.workspaceId,
		columnId: fixture.columnId,
		title,
		thumbnail,
		original,
	});
}
