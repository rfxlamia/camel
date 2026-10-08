import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { currentUser } = vi.hoisted(() => ({
	currentUser: {
		id: 31040,
		username: "cl-card-routes",
		displayName: "CL Card Routes",
	},
}));

vi.mock("../../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = currentUser;
			next();
		},
	};
});

import { pool } from "../../db/pool.js";
import {
	LocalAttachmentStorage,
	setAttachmentStorageForTests,
} from "../../lib/attachment-storage.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { api } from "../../routes.js";

const WORKSPACE_ID = 3104;
const base = `/api/workspaces/${WORKSPACE_ID}`;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);
app.use(createErrorHandler());

let storageRoot: string | null = null;

async function cleanup() {
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM users WHERE id = $1", [currentUser.id]);
}

type Seed = { columnId: number; targetColumnId: number; statusId: number };

async function seed(): Promise<Seed> {
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, $2, $3, 'test')",
		[currentUser.id, currentUser.username, currentUser.displayName],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'CL Card Routes WS', $2, false)",
		[WORKSPACE_ID, currentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
		[WORKSPACE_ID, currentUser.id],
	);
	const cols = await pool.query<{ id: number }>(
		"INSERT INTO columns (workspace_id, title, position) VALUES ($1, 'Todo', 1024), ($1, 'Doing', 2048) RETURNING id",
		[WORKSPACE_ID],
	);
	const status = await pool.query<{ id: number }>(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, category, slot) VALUES ($1, 'status', 'Todo', 1024, 'blue', 'backlog', 'todo') RETURNING id",
		[WORKSPACE_ID],
	);
	return {
		columnId: cols.rows[0]!.id,
		targetColumnId: cols.rows[1]!.id,
		statusId: status.rows[0]!.id,
	};
}

async function insertCard(
	statusId: number,
	columnId: number | null,
	key: number,
) {
	const { rows } = await pool.query<{ id: number }>(
		`INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		[WORKSPACE_ID, columnId, `Card ${key}`, key * 1024, statusId, key],
	);
	return rows[0]!.id;
}

async function readRow(id: number) {
	const { rows } = await pool.query("SELECT * FROM cards WHERE id = $1", [id]);
	return rows[0];
}

async function attachmentCount(cardId: number) {
	const { rows } = await pool.query<{ n: number }>(
		"SELECT count(*)::int AS n FROM attachments WHERE card_id = $1",
		[cardId],
	);
	return rows[0]!.n;
}

function pngFixture(): Buffer {
	const bytes = Buffer.alloc(1024, 0x61);
	bytes.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(1, 16);
	bytes.writeUInt32BE(1, 20);
	return bytes;
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"/cards routes with column-less items (integration)",
	() => {
		let fixture: Seed;

		beforeEach(async () => {
			await cleanup();
			fixture = await seed();
			storageRoot = await mkdtemp(path.join(tmpdir(), "cl-card-routes-"));
			setAttachmentStorageForTests(new LocalAttachmentStorage(storageRoot));
		});

		afterAll(async () => {
			await cleanup();
			if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
			await pool.end();
		});

		describe("column-less item through board-only endpoints", () => {
			it("returns 404 for GET, PATCH, DELETE, move and attachment upload and leaves the row unchanged", async () => {
				const id = await insertCard(fixture.statusId, null, 50);
				const before = await readRow(id);
				expect(before.column_id).toBeNull();

				const get = await request(app).get(`${base}/cards/${id}`);
				expect(get.status).toBe(404);
				expect(get.body).toEqual({ error: "Not found" });

				const patch = await request(app)
					.patch(`${base}/cards/${id}`)
					.send({ title: "Renamed" });
				expect(patch.status).toBe(404);
				expect(patch.body).toEqual({ error: "card not found" });

				const move = await request(app)
					.post(`${base}/cards/${id}/move`)
					.send({ toColumnId: fixture.targetColumnId, index: 0 });
				expect(move.status).toBe(404);
				expect(move.body).toEqual({ error: "card not found" });

				const del = await request(app).delete(`${base}/cards/${id}`);
				expect(del.status).toBe(404);
				expect(del.body).toEqual({ error: "card not found" });

				const image = pngFixture();
				const upload = await request(app)
					.post(`${base}/cards/${id}/attachments`)
					.attach("thumbnail", image, {
						filename: "t.png",
						contentType: "image/png",
					})
					.attach("original", image, {
						filename: "o.png",
						contentType: "image/png",
					});
				expect(upload.status).toBe(404);
				expect(await attachmentCount(id)).toBe(0);

				expect(await readRow(id)).toEqual(before);
			});
		});

		describe("board cards unchanged", () => {
			it("serves GET, PATCH and move with their usual status codes and 409 on a stale version", async () => {
				const id = await insertCard(fixture.statusId, fixture.columnId, 51);

				const get = await request(app).get(`${base}/cards/${id}`);
				expect(get.status).toBe(200);
				expect(get.body.id).toBe(id);
				expect(get.body.columnId).toBe(fixture.columnId);

				const patch = await request(app)
					.patch(`${base}/cards/${id}`)
					.send({ title: "Renamed", version: get.body.version });
				expect(patch.status).toBe(200);
				expect(patch.body.title).toBe("Renamed");
				expect(patch.body.version).toBe(get.body.version + 1);

				const stalePatch = await request(app)
					.patch(`${base}/cards/${id}`)
					.send({ title: "Stale", version: get.body.version });
				expect(stalePatch.status).toBe(409);
				expect((await readRow(id)).title).toBe("Renamed");

				const staleMove = await request(app)
					.post(`${base}/cards/${id}/move`)
					.send({
						toColumnId: fixture.targetColumnId,
						index: 0,
						version: get.body.version,
					});
				expect(staleMove.status).toBe(409);
				expect((await readRow(id)).column_id).toBe(fixture.columnId);

				const move = await request(app)
					.post(`${base}/cards/${id}/move`)
					.send({ toColumnId: fixture.targetColumnId, index: 0 });
				expect(move.status).toBe(200);
				expect((await readRow(id)).column_id).toBe(fixture.targetColumnId);
			});

			it("accepts attachment upload and soft-deletes with 204, then 404s the deleted card", async () => {
				const id = await insertCard(fixture.statusId, fixture.columnId, 52);
				const image = pngFixture();
				const upload = await request(app)
					.post(`${base}/cards/${id}/attachments`)
					.attach("thumbnail", image, {
						filename: "t.png",
						contentType: "image/png",
					})
					.attach("original", image, {
						filename: "o.png",
						contentType: "image/png",
					});
				expect(upload.status).toBe(201);
				expect(await attachmentCount(id)).toBe(1);

				const staleDelete = await request(app)
					.delete(`${base}/cards/${id}`)
					.send({ version: 999 });
				expect(staleDelete.status).toBe(409);

				const del = await request(app).delete(`${base}/cards/${id}`);
				expect(del.status).toBe(204);
				const again = await request(app).delete(`${base}/cards/${id}`);
				expect(again.status).toBe(404);
				expect(again.body).toEqual({ error: "card not found" });
			});
		});
	},
);
