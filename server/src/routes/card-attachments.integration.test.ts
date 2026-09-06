import "dotenv/config";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import request, { type Test } from "supertest";
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

import { config } from "../config.js";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import {
	type AttachmentPair,
	type AttachmentPairInput,
	type AttachmentStorage,
	LocalAttachmentStorage,
	setAttachmentStorageForTests,
} from "../lib/attachment-storage.js";
import { createRealtimeHub, setRealtimeHubForTests } from "../realtime.js";
import { api } from "../routes.js";
import {
	createAttachmentOwnershipGuard,
	setExistingCardAttachmentCapacityHookForTests,
} from "./card-attachments.js";

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

type UploadFixture = {
	workspaceId: number;
	cardId: number;
	pairs: AttachmentPair[];
	storage: AttachmentStorage;
};

function pngFixture(size = 1024, width = 1, height = 1): Buffer {
	const bytes = Buffer.alloc(Math.max(size, 33), 0x61);
	bytes.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

async function countFiles(root: string): Promise<number> {
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

async function createUploadFixture(
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

async function cleanupUploadFixture(fixture: UploadFixture): Promise<void> {
	await db
		.deleteFrom("workspaces")
		.where("id", "=", fixture.workspaceId)
		.execute();
	await fixture.storage.removePairs(fixture.pairs);
}

async function createTestStorage(): Promise<LocalAttachmentStorage> {
	const root = path.join(config.ATTACHMENTS_DIR, `t6-${randomUUID()}`);
	await mkdir(root, { recursive: true });
	return new LocalAttachmentStorage(root);
}

async function removeTestStorage(
	testStorage: AttachmentStorage,
): Promise<void> {
	await rm(testStorage.root, { recursive: true, force: true });
}

async function cardVersion(id: number): Promise<number> {
	const row = await db
		.selectFrom("cards")
		.select("version")
		.where("id", "=", id)
		.executeTakeFirstOrThrow();
	return row.version;
}

async function attachmentRows(card: number): Promise<
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

function uploadUrl(workspace: number, card: number): string {
	return `/api/workspaces/${workspace}/cards/${card}/attachments`;
}

function attachPair(
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

async function waitBriefly(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 50));
}

class MarkerStorage implements AttachmentStorage {
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

async function withUploadFixture<T>(
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
			setAttachmentStorageForTests(null);
			setRealtimeHubForTests(null);
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

		it("adds a valid pair without changing the card version", async () => {
			await withUploadFixture(1, async (fixture) => {
				const hub = createRealtimeHub({ publisher: null, subscriber: null });
				const events = hub.connectLocalClient({
					workspaceId: fixture.workspaceId,
				});
				setRealtimeHubForTests(hub);
				const beforeVersion = await cardVersion(fixture.cardId);
				const image = pngFixture(2 * 1024 * 1024);
				const response = await attachPair(
					request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
					image,
					image,
				);
				expect(response.status).toBe(201);
				expect(response.body.total).toBe(2);
				expect(response.body.acceptedCount).toBe(1);
				expect(await cardVersion(fixture.cardId)).toBe(beforeVersion);

				const card = await db
					.selectFrom("cards")
					.select("column_id")
					.where("id", "=", fixture.cardId)
					.executeTakeFirstOrThrow();
				const rows = await attachmentRows(fixture.cardId);
				expect(rows).toHaveLength(2);
				const added = rows[1]!;
				expect(
					await readFile(path.join(fixture.storage.root, added.thumbnail_path)),
				).toEqual(image);
				expect(
					await readFile(path.join(fixture.storage.root, added.original_path)),
				).toEqual(image);
				const activities = await db
					.selectFrom("card_events")
					.select(["event_type", "to_column_id", "payload"])
					.where("card_id", "=", fixture.cardId)
					.execute();
				expect(activities).toHaveLength(1);
				expect(activities[0]).toMatchObject({
					event_type: "attachment_added",
					to_column_id: card.column_id,
				});
				expect(await countFiles(fixture.storage.root)).toBe(4);
				const published = events.drain();
				expect(published).toHaveLength(1);
				expect(published[0]).toMatchObject({
					type: "attachment.added",
					cardId: fixture.cardId,
				});
				expect(events.drain()).toEqual([]);
			});
		}, 15_000);

		it("serializes concurrent capacity decisions under the card lock", async () => {
			await withUploadFixture(2, async (fixture) => {
				const hub = createRealtimeHub({ publisher: null, subscriber: null });
				setRealtimeHubForTests(hub);
				let calls = 0;
				let releaseFirst!: () => void;
				let observeFirst!: () => void;
				const firstObserved = new Promise<void>((resolve) => {
					observeFirst = resolve;
				});
				const firstRelease = new Promise<void>((resolve) => {
					releaseFirst = resolve;
				});
				setExistingCardAttachmentCapacityHookForTests(async () => {
					calls += 1;
					if (calls === 1) {
						observeFirst();
						await firstRelease;
					}
				});
				try {
					const image = pngFixture();
					const first = attachPair(
						request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
						image,
						image,
						0,
					).then((response) => response);
					await firstObserved;
					const second = attachPair(
						request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
						image,
						image,
						1,
					).then((response) => response);
					await waitBriefly();
					expect(calls).toBe(1);
					releaseFirst();
					const [firstResponse, secondResponse] = await Promise.all([
						first,
						second,
					]);
					expect([firstResponse.status, secondResponse.status].sort()).toEqual([
						201, 409,
					]);
					expect(await attachmentRows(fixture.cardId)).toHaveLength(3);
					expect(await countFiles(fixture.storage.root)).toBe(6);
				} finally {
					setExistingCardAttachmentCapacityHookForTests(null);
				}
			});
		}, 15_000);

		it("rejects a full card without any side effects", async () => {
			await withUploadFixture(3, async (fixture) => {
				const hub = createRealtimeHub({ publisher: null, subscriber: null });
				const events = hub.connectLocalClient({
					workspaceId: fixture.workspaceId,
				});
				setRealtimeHubForTests(hub);
				const beforeVersion = await cardVersion(fixture.cardId);
				const beforeFiles = await countFiles(fixture.storage.root);
				const response = await attachPair(
					request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
					pngFixture(),
					pngFixture(),
				);
				expect(response.status).toBe(409);
				expect(response.body).toEqual({ error: "Max 3 images per card" });
				expect(await attachmentRows(fixture.cardId)).toHaveLength(3);
				expect(await countFiles(fixture.storage.root)).toBe(beforeFiles);
				expect(await cardVersion(fixture.cardId)).toBe(beforeVersion);
				expect(events.drain()).toEqual([]);
			});
		}, 15_000);

		it("partially accepts a batch up to the card limit", async () => {
			await withUploadFixture(1, async (fixture) => {
				const hub = createRealtimeHub({ publisher: null, subscriber: null });
				const events = hub.connectLocalClient({
					workspaceId: fixture.workspaceId,
				});
				setRealtimeHubForTests(hub);
				const image = pngFixture();
				let upload = request(app).post(
					uploadUrl(fixture.workspaceId, fixture.cardId),
				);
				for (let index = 0; index < 4; index += 1) {
					upload = attachPair(upload, image, image, index);
				}
				const response = await upload;
				expect(response.status).toBe(201);
				expect(response.body).toMatchObject({
					acceptedCount: 2,
					rejectedCount: 2,
					total: 3,
					message: "2 of 4 images added — card limit is 3 images",
				});
				expect(await attachmentRows(fixture.cardId)).toHaveLength(3);
				const activities = await db
					.selectFrom("card_events")
					.select("event_type")
					.where("card_id", "=", fixture.cardId)
					.execute();
				expect(activities).toHaveLength(2);
				expect(
					activities.every((row) => row.event_type === "attachment_added"),
				).toBe(true);
				expect(events.drain()).toHaveLength(2);
				expect(await countFiles(fixture.storage.root)).toBe(6);
			});
		}, 15_000);

		it("validates every pair before writing storage", async () => {
			await withUploadFixture(1, async (fixture) => {
				const valid = pngFixture();
				const cases = [
					{
						value: Buffer.from("not an image"),
						message: "Only PNG and JPEG accepted",
						status: 400,
					},
					{
						value: Buffer.from("%PDF-1.7 disguised"),
						message: "Only PNG and JPEG accepted",
						status: 400,
					},
					{
						value: pngFixture(4096, 4097, 1),
						message: "Image dimensions must be 4096px or smaller",
						status: 400,
					},
					{
						value: pngFixture(10 * 1024 * 1024 + 1),
						message: "File size must be under 10MB",
						status: 413,
					},
				];
				const beforeFiles = await countFiles(fixture.storage.root);
				for (const testCase of cases) {
					for (const invalidField of ["thumbnail", "original"] as const) {
						const thumbnail =
							invalidField === "thumbnail" ? testCase.value : valid;
						const original =
							invalidField === "original" ? testCase.value : valid;
						const response = await attachPair(
							request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
							thumbnail,
							original,
						);
						expect(response.status).toBe(testCase.status);
						expect(response.body.error).toBe(testCase.message);
						expect(await attachmentRows(fixture.cardId)).toHaveLength(1);
						expect(await countFiles(fixture.storage.root)).toBe(beforeFiles);
					}
				}
			});
		}, 15_000);

		it("cleans provider writes after a route-bound insert failure", async () => {
			const fixtureStorage = await createTestStorage();
			const markerStorage = new MarkerStorage(fixtureStorage, "t6-db-failure");
			setAttachmentStorageForTests(markerStorage);
			const fixture = await createUploadFixture(0, markerStorage);
			try {
				await pool.query(
					"DROP TRIGGER IF EXISTS t6_attachment_failure ON attachments",
				);
				await pool.query(`
					CREATE OR REPLACE FUNCTION t6_attachment_failure_fn() RETURNS trigger
					LANGUAGE plpgsql AS $$ BEGIN
						IF NEW.thumbnail_path LIKE 't6-db-failure/%' THEN
							RAISE EXCEPTION 'T6 forced attachment insert failure';
						END IF;
						RETURN NEW;
					END $$;
				`);
				await pool.query(
					"CREATE TRIGGER t6_attachment_failure BEFORE INSERT ON attachments FOR EACH ROW EXECUTE FUNCTION t6_attachment_failure_fn()",
				);
				const hub = createRealtimeHub({ publisher: null, subscriber: null });
				const events = hub.connectLocalClient({
					workspaceId: fixture.workspaceId,
				});
				setRealtimeHubForTests(hub);
				const beforeVersion = await cardVersion(fixture.cardId);
				const response = await attachPair(
					request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
					pngFixture(),
					pngFixture(),
				);
				expect(response.status).toBe(500);
				expect(await attachmentRows(fixture.cardId)).toHaveLength(0);
				expect(await countFiles(fixture.storage.root)).toBe(0);
				expect(await cardVersion(fixture.cardId)).toBe(beforeVersion);
				expect(events.drain()).toEqual([]);
			} finally {
				await pool.query(
					"DROP TRIGGER IF EXISTS t6_attachment_failure ON attachments",
				);
				await pool.query("DROP FUNCTION IF EXISTS t6_attachment_failure_fn()");
				await cleanupUploadFixture(fixture);
				setAttachmentStorageForTests(storage);
				await removeTestStorage(fixtureStorage);
			}
		}, 15_000);

		it("delivers a committed attachment mutation through the real SSE hub", async () => {
			await withUploadFixture(1, async (fixture) => {
				const hub = createRealtimeHub({ publisher: null, subscriber: null });
				setRealtimeHubForTests(hub);
				const subscriberRequest = new EventEmitter() as EventEmitter & {
					params: { workspaceId: string };
					user: typeof testUser;
				};
				subscriberRequest.params = { workspaceId: String(fixture.workspaceId) };
				subscriberRequest.user = { ...testUser, id: 2 };
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
				const response = await attachPair(
					request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
					pngFixture(),
					pngFixture(),
				);
				expect(response.status).toBe(201);
				const payloads = chunks
					.filter((chunk) => chunk.startsWith("data: "))
					.map(
						(chunk) =>
							JSON.parse(chunk.slice(6).trim()) as Record<string, unknown>,
					);
				expect(payloads).toHaveLength(1);
				expect(payloads[0]).toMatchObject({
					type: "attachment.added",
					workspaceId: fixture.workspaceId,
					cardId: fixture.cardId,
				});
				expect(payloads[0]).not.toHaveProperty("thumbnail");
				subscriberRequest.emit("close");
			});
		}, 15_000);
	},
);
