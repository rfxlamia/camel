import { mkdtemp, readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import express from "express";
import request from "supertest";
import { expect } from "vitest";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { domainBus } from "../events.js";
import {
	type AttachmentPairInput,
	LocalAttachmentStorage,
	setAttachmentStorageForTests,
} from "../lib/attachment-storage.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

export const app = express();
app.use(express.json());
app.use("/api", api);
app.use(createErrorHandler());

export const PNG_1X1 = Buffer.from(
	"89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc000000301010018dd8db40000000049454e44ae426082",
	"hex",
);

export type Fixtures = { workspaceId: number; columnId: number };
export type TestUser = {
	id: number;
	username: string;
	displayName: string;
};

export let fixtures: Fixtures | undefined;
export let storageRoot: string | undefined;

export async function query<T extends object>(
	text: string,
	values: unknown[] = [],
) {
	return (await pool.query<T>(text, values)).rows;
}

export async function setup(currentUser: TestUser): Promise<Fixtures> {
	const suffix = Date.now();
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES (1, $1, $2, 'test') ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name",
		[`${currentUser.username}-${suffix}`, currentUser.displayName],
	);
	const workspace = await db
		.insertInto("workspaces")
		.values({ name: `Card attachments ${suffix}`, owner_user_id: 1 })
		.returning("id")
		.executeTakeFirstOrThrow();
	await db
		.insertInto("workspace_members")
		.values({ workspace_id: workspace.id, user_id: 1, role: "owner" })
		.execute();
	await seedTrackerVocabulary(db, workspace.id);
	const column = await db
		.insertInto("columns")
		.values({
			workspace_id: workspace.id,
			title: "Todo",
			position: 1024,
			policy: "manual",
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return { workspaceId: workspace.id, columnId: column.id };
}

export async function cleanup(): Promise<void> {
	if (fixtures) {
		await db
			.deleteFrom("workspaces")
			.where("id", "=", fixtures.workspaceId)
			.execute();
		fixtures = undefined;
	}
	if (storageRoot) {
		await rm(storageRoot, { recursive: true, force: true });
		storageRoot = undefined;
	}
}

export function multipartCreate(columnId: number, title: string) {
	return request(app)
		.post(`/api/workspaces/${fixtures!.workspaceId}/cards`)
		.field("metadata", JSON.stringify({ columnId, title }));
}

export class FailingOnSecondPairStorage extends LocalAttachmentStorage {
	private writes = 0;

	override async writePair(
		inputOrThumbnail: AttachmentPairInput | Buffer,
		original?: Buffer,
	) {
		this.writes += 1;
		if (this.writes === 2) throw new Error("synthetic provider failure");
		return super.writePair(inputOrThumbnail, original);
	}
}

export function oversizedPng(): Buffer {
	const image = Buffer.from(PNG_1X1);
	image.writeUInt32BE(4097, 16);
	return image;
}

export async function expectNoCardSideEffects(
	publishEventMock: unknown,
): Promise<void> {
	expect(
		await query("SELECT id FROM cards WHERE workspace_id = $1", [
			fixtures!.workspaceId,
		]),
	).toHaveLength(0);
	expect(
		await query(
			"SELECT id FROM attachments WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
			[fixtures!.workspaceId],
		),
	).toHaveLength(0);
	expect(
		await query("SELECT id FROM card_events WHERE workspace_id = $1", [
			fixtures!.workspaceId,
		]),
	).toHaveLength(0);
	expect(publishEventMock).not.toHaveBeenCalled();
}

export function addPair(
	req: request.Test,
	thumbnail: Buffer,
	original: Buffer,
	index: number,
) {
	req.attach("thumbnail", thumbnail, `thumbnail-${index}.png`);
	req.attach("original", original, `original-${index}.png`);
	return req;
}

export function setStorage(storage: LocalAttachmentStorage): void {
	setAttachmentStorageForTests(storage);
}

export function createStorageRoot(): Promise<string> {
	return mkdtemp(path.join(process.cwd(), "card-create-attachments-"));
}

export async function initializeStorageRoot(): Promise<void> {
	storageRoot = await createStorageRoot();
}

export async function initializeFixtures(currentUser: TestUser): Promise<void> {
	fixtures = await setup(currentUser);
}

export {
	db,
	domainBus,
	LocalAttachmentStorage,
	pool,
	readdir,
	rm,
	setAttachmentStorageForTests,
};
