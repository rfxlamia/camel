import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import type { Test } from "supertest";
import { config } from "../config.js";
import { db } from "../db/kysely.js";
import {
	type AttachmentPair,
	type AttachmentPairInput,
	type AttachmentStorage,
	LocalAttachmentStorage,
	setAttachmentStorageForTests,
} from "../lib/attachment-storage.js";
import {
	app,
	createCard,
	createWorkspace,
	storage,
	testUser,
} from "./card-attachments.integration.support.js";

export { app, storage, testUser };

export type UploadFixture = {
	workspaceId: number;
	cardId: number;
	pairs: AttachmentPair[];
	storage: AttachmentStorage;
};

export function pngFixture(size = 1024, width = 1, height = 1): Buffer {
	const bytes = Buffer.alloc(Math.max(size, 33), 0x61);
	bytes.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

export const JPEG_1X1 = Buffer.from([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08,
	0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
]);

export async function countFiles(root: string): Promise<number> {
	let entries: Array<import("node:fs").Dirent>;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
		throw error;
	}
	let total = 0;
	for (const entry of entries) {
		const fullPath = path.join(root, entry.name);
		total += entry.isDirectory() ? await countFiles(fullPath) : 1;
	}
	return total;
}

export async function createUploadFixture(
	existingCount: number,
	fixtureStorage: AttachmentStorage,
): Promise<UploadFixture> {
	const fixtureWorkspaceId = await createWorkspace(
		`Existing card upload ${randomUUID()}`,
	);
	const fixtureCardId = await createCard(
		fixtureWorkspaceId,
		"Existing card upload card",
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
				card_id: fixtureCardId,
				mime_type: "image/png",
				thumbnail_path: pair.thumbnailPath,
				original_path: pair.originalPath,
				thumbnail_size_bytes: 20,
				original_size_bytes: 19,
			})
			.execute();
	}
	return {
		workspaceId: fixtureWorkspaceId,
		cardId: fixtureCardId,
		pairs,
		storage: fixtureStorage,
	};
}

export async function cleanupUploadFixture(
	fixture: UploadFixture,
): Promise<void> {
	await db
		.deleteFrom("workspaces")
		.where("id", "=", fixture.workspaceId)
		.execute();
	await fixture.storage.removePairs(fixture.pairs);
}

export async function createTestStorage(): Promise<LocalAttachmentStorage> {
	const root = path.join(config.ATTACHMENTS_DIR, `t6-${randomUUID()}`);
	await mkdir(root, { recursive: true });
	return new LocalAttachmentStorage(root);
}

export async function removeTestStorage(
	testStorage: AttachmentStorage,
): Promise<void> {
	await rm(testStorage.root, { recursive: true, force: true });
}

export async function cardVersion(id: number): Promise<number> {
	const row = await db
		.selectFrom("cards")
		.select("version")
		.where("id", "=", id)
		.executeTakeFirstOrThrow();
	return row.version;
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

export function attachMixedMimePair(
	req: Test,
	thumbnail: Buffer,
	original: Buffer,
): Test {
	return req
		.attach("thumbnail", thumbnail, {
			filename: "thumbnail.png",
			contentType: "image/png",
		})
		.attach("original", original, {
			filename: "original.jpg",
			contentType: "image/jpeg",
		});
}

export async function waitBriefly(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 50));
}

export class MarkerStorage implements AttachmentStorage {
	readonly root: string;
	private readonly paths = new Map<string, AttachmentPair>();

	constructor(
		private readonly inner: LocalAttachmentStorage,
		readonly marker: string,
	) {
		this.root = inner.root;
	}

	async writePair(
		inputOrThumbnail: AttachmentPairInput | Buffer,
		original?: Buffer,
	): Promise<AttachmentPair> {
		const actual = Buffer.isBuffer(inputOrThumbnail)
			? await this.inner.writePair(inputOrThumbnail, original)
			: await this.inner.writePair(inputOrThumbnail);
		const logical = {
			thumbnailPath: `${this.marker}/${actual.thumbnailPath}`,
			originalPath: `${this.marker}/${actual.originalPath}`,
		};
		this.paths.set(logical.thumbnailPath, actual);
		return logical;
	}

	async removePair(pair: AttachmentPair): Promise<void> {
		const actual = this.paths.get(pair.thumbnailPath);
		if (actual) {
			await this.inner.removePair(actual);
			this.paths.delete(pair.thumbnailPath);
			return;
		}
		await this.inner.removePair(pair);
	}

	async removePairs(pairs: Iterable<AttachmentPair>): Promise<void> {
		for (const pair of pairs) await this.removePair(pair);
	}
}

export async function withUploadFixture<T>(
	existingCount: number,
	callback: (fixture: UploadFixture) => Promise<T>,
): Promise<T> {
	const fixtureStorage = await createTestStorage();
	setAttachmentStorageForTests(fixtureStorage);
	const fixture = await createUploadFixture(existingCount, fixtureStorage);
	try {
		return await callback(fixture);
	} finally {
		await cleanupUploadFixture(fixture);
		setAttachmentStorageForTests(storage);
		await removeTestStorage(fixtureStorage);
	}
}
