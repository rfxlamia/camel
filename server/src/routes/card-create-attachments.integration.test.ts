import "dotenv/config";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import express from "express";
import request from "supertest";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { domainBus, EVENTS } from "../events.js";
import { setAttachmentStorageForTests } from "../lib/attachment-storage.js";
import { createErrorHandler } from "../middleware/error-handler.js";

const { mockPublishEvent, currentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	currentUser: {
		id: 1,
		username: "card-create-attachment-owner",
		displayName: "Owner",
	},
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));
vi.mock("../realtime.js", () => ({
	publishEvent: mockPublishEvent,
	clearPresence: vi.fn(),
	heartbeat: vi.fn(),
	onlineUsers: vi.fn().mockResolvedValue([]),
	sseHandler: vi.fn(),
	createRealtimeHub: vi.fn(),
	initRealtime: vi.fn(),
	workspaceEventChannel: vi.fn(),
	workspacePresenceKey: vi.fn(),
	workspacePresencePattern: vi.fn(),
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
			req.user = currentUser;
			next();
		},
	};
});

import {
	type AttachmentPairInput,
	LocalAttachmentStorage,
} from "../lib/attachment-storage.js";
import { api } from "../routes.js";

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);
const app = express();
app.use(express.json());
app.use("/api", api);
app.use(createErrorHandler());

const PNG_1X1 = Buffer.from(
	"89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc000000301010018dd8db40000000049454e44ae426082",
	"hex",
);

type Fixtures = { workspaceId: number; columnId: number };
let fixtures: Fixtures | undefined;
let storageRoot: string | undefined;

async function query<T extends object>(text: string, values: unknown[] = []) {
	return (await pool.query<T>(text, values)).rows;
}

async function setup(): Promise<Fixtures> {
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
		.values({
			workspace_id: workspace.id,
			user_id: 1,
			role: "owner",
		})
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

async function cleanup(): Promise<void> {
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

function multipartCreate(columnId: number, title: string) {
	return request(app)
		.post(`/api/workspaces/${fixtures!.workspaceId}/cards`)
		.field("metadata", JSON.stringify({ columnId, title }));
}

class FailingOnSecondPairStorage extends LocalAttachmentStorage {
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

function oversizedPng(): Buffer {
	const image = Buffer.from(PNG_1X1);
	image.writeUInt32BE(4097, 16);
	return image;
}

async function expectNoCardSideEffects(): Promise<void> {
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
	expect(mockPublishEvent).not.toHaveBeenCalled();
}

function addPair(
	req: request.Test,
	thumbnail: Buffer,
	original: Buffer,
	index: number,
) {
	req.attach("thumbnail", thumbnail, `thumbnail-${index}.png`);
	req.attach("original", original, `original-${index}.png`);
	return req;
}

integration("POST /cards — atomic staged attachment create", () => {
	beforeEach(async () => {
		mockPublishEvent.mockReset().mockResolvedValue(undefined);
		domainBus.removeAllListeners();
		fixtures = await setup();
		storageRoot = await mkdtemp(
			path.join(process.cwd(), "card-create-attachments-"),
		);
		setAttachmentStorageForTests(new LocalAttachmentStorage(storageRoot));
	});
	afterEach(async () => {
		domainBus.removeAllListeners();
		setAttachmentStorageForTests(null);
		await cleanup();
	});
	afterAll(async () => {
		await pool.end();
	});

	it("creates one or more positional pairs in the card transaction and publishes after commit", async () => {
		const response = await addPair(
			addPair(
				multipartCreate(fixtures!.columnId, "Staged images"),
				PNG_1X1,
				PNG_1X1,
				0,
			),
			PNG_1X1,
			Buffer.concat([PNG_1X1, Buffer.from("pair-two")]),
			1,
		);

		expect(response.status).toBe(201);
		expect(response.body.title).toBe("Staged images");
		expect(response.body.attachments).toHaveLength(2);
		const rows = await query<{
			id: number;
			mime_type: string;
			thumbnail_size_bytes: number;
			original_size_bytes: number;
		}>(
			"SELECT id, mime_type, thumbnail_size_bytes, original_size_bytes FROM attachments WHERE card_id = $1 ORDER BY id",
			[response.body.id],
		);
		expect(rows).toEqual([
			expect.objectContaining({
				mime_type: "image/png",
				thumbnail_size_bytes: PNG_1X1.length,
				original_size_bytes: PNG_1X1.length,
			}),
			expect.objectContaining({
				mime_type: "image/png",
				thumbnail_size_bytes: PNG_1X1.length,
				original_size_bytes: PNG_1X1.length + Buffer.from("pair-two").length,
			}),
		]);
		expect(
			await query(
				"SELECT event_type FROM card_events WHERE card_id = $1 ORDER BY id",
				[response.body.id],
			),
		).toEqual([
			{ event_type: "create" },
			{ event_type: "attachment_added" },
			{ event_type: "attachment_added" },
		]);
		expect(mockPublishEvent).toHaveBeenCalledTimes(3);
		expect(mockPublishEvent.mock.calls.map(([, event]) => event.type)).toEqual([
			"card.created",
			"attachment.added",
			"attachment.added",
		]);
	});

	it("rejects unequal pairs and more than three pairs before creating a card", async () => {
		const unequal = multipartCreate(fixtures!.columnId, "Unequal");
		unequal.attach("thumbnail", PNG_1X1, "thumbnail.png");
		const unequalResponse = await unequal;
		expect(unequalResponse.status).toBe(400);
		expect(
			await query("SELECT id FROM cards WHERE workspace_id = $1", [
				fixtures!.workspaceId,
			]),
		).toHaveLength(0);

		const overflow = multipartCreate(fixtures!.columnId, "Overflow");
		for (let index = 0; index < 4; index += 1)
			addPair(overflow, PNG_1X1, PNG_1X1, index);
		const overflowResponse = await overflow;
		expect(overflowResponse.status).toBe(413);
		expect(
			await query("SELECT id FROM cards WHERE workspace_id = $1", [
				fixtures!.workspaceId,
			]),
		).toHaveLength(0);
	});

	it("rejects malformed or oversized images before writing any pair", async () => {
		const writePair = vi.fn();
		const storage = new LocalAttachmentStorage(storageRoot!);
		setAttachmentStorageForTests({
			...storage,
			writePair,
		});

		for (const [title, image] of [
			["Invalid signature", Buffer.from("not an image")],
			["Oversized dimensions", oversizedPng()],
		]) {
			const response = await addPair(
				multipartCreate(fixtures!.columnId, title),
				image,
				PNG_1X1,
				0,
			);
			expect(response.status).toBe(400);
		}
		expect(writePair).not.toHaveBeenCalled();
		await expectNoCardSideEffects();
	});

	it("removes earlier pairs when a later provider write fails", async () => {
		setAttachmentStorageForTests(new FailingOnSecondPairStorage(storageRoot!));
		const response = await addPair(
			addPair(
				multipartCreate(fixtures!.columnId, "Provider failure"),
				PNG_1X1,
				PNG_1X1,
				0,
			),
			PNG_1X1,
			PNG_1X1,
			1,
		);
		expect(response.status).toBe(500);
		await expectNoCardSideEffects();
		expect(await readdir(storageRoot!)).toEqual([]);
	});

	it("rolls back the card and unlinks files when the route-bound attachment insert fails", async () => {
		await pool.query(`
			CREATE OR REPLACE FUNCTION card_create_attachment_test_failure()
			RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				RAISE EXCEPTION 'controlled card-create attachment failure';
			END;
			$$;
		`);
		await pool.query(`
			CREATE TRIGGER card_create_attachment_test_failure_trigger
			BEFORE INSERT ON attachments
			FOR EACH ROW EXECUTE FUNCTION card_create_attachment_test_failure();
		`);
		try {
			const response = await addPair(
				multipartCreate(fixtures!.columnId, "Database failure"),
				PNG_1X1,
				PNG_1X1,
				0,
			);
			expect(response.status).toBe(500);
			await expectNoCardSideEffects();
			expect(await readdir(storageRoot!)).toEqual([]);
		} finally {
			await pool.query(
				"DROP TRIGGER IF EXISTS card_create_attachment_test_failure_trigger ON attachments",
			);
			await pool.query(
				"DROP FUNCTION IF EXISTS card_create_attachment_test_failure()",
			);
		}
	});
});
