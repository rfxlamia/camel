import { readFile } from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "../../db/kysely.js";
import { createRealtimeHub, setRealtimeHubForTests } from "../../realtime.js";
import { setExistingCardAttachmentCapacityHookForTests } from "./card-attachments.js";
import {
	app,
	attachMixedMimePair,
	attachmentRows,
	attachPair,
	cardVersion,
	countFiles,
	JPEG_1X1,
	pngFixture,
	uploadUrl,
	waitBriefly,
	withUploadFixture,
} from "./card-attachments-upload.support.js";

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"existing card attachment uploads",
	() => {
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
				expect(response.body.attachments).toEqual([
					{
						id: added.id,
						thumbnailUrl: `/api/workspaces/${fixture.workspaceId}/cards/${fixture.cardId}/attachments/${added.id}/thumbnail`,
						originalUrl: `/api/workspaces/${fixture.workspaceId}/cards/${fixture.cardId}/attachments/${added.id}/original`,
						downloadUrl: `/api/workspaces/${fixture.workspaceId}/cards/${fixture.cardId}/attachments/${added.id}/original/download`,
						mimeType: "image/png",
						createdAt: expect.any(String),
					},
				]);
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
				expect(Object.keys(activities[0]!.payload).sort()).toEqual([
					"attachmentId",
					"createdAt",
					"mimeType",
				]);
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

		it("rejects mixed MIME pairs before writing storage", async () => {
			await withUploadFixture(1, async (fixture) => {
				const hub = createRealtimeHub({ publisher: null, subscriber: null });
				const events = hub.connectLocalClient({
					workspaceId: fixture.workspaceId,
				});
				setRealtimeHubForTests(hub);
				const beforeFiles = await countFiles(fixture.storage.root);
				const response = await attachMixedMimePair(
					request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
					pngFixture(),
					JPEG_1X1,
				);
				expect(response.status).toBe(400);
				expect(response.body.error).toBe("Only PNG and JPEG accepted");
				expect(await attachmentRows(fixture.cardId)).toHaveLength(1);
				expect(await countFiles(fixture.storage.root)).toBe(beforeFiles);
				expect(
					await db
						.selectFrom("card_events")
						.select("id")
						.where("card_id", "=", fixture.cardId)
						.execute(),
				).toHaveLength(0);
				expect(events.drain()).toEqual([]);
			});
		}, 15_000);

		it("rejects attachment access for agent-board cards", async () => {
			await withUploadFixture(0, async (fixture) => {
				const sourceCard = await db
					.selectFrom("cards")
					.select("status_id")
					.where("id", "=", fixture.cardId)
					.executeTakeFirstOrThrow();
				const board = await db
					.insertInto("agent_boards")
					.values({
						workspace_id: fixture.workspaceId,
						user_id: 1,
						original_intent: "agent attachment guard",
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				const column = await db
					.insertInto("columns")
					.values({
						workspace_id: fixture.workspaceId,
						board_id: board.id,
						title: "Agent column",
						position: 2048,
						policy: "manual",
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				const agentCard = await db
					.insertInto("cards")
					.values({
						workspace_id: fixture.workspaceId,
						column_id: column.id,
						status_id: sourceCard.status_id,
						title: "Agent card",
						description: "",
						position: 2048,
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				const pair = await fixture.storage.writePair(
					pngFixture(),
					pngFixture(),
				);
				const attachment = await db
					.insertInto("attachments")
					.values({
						card_id: agentCard.id,
						mime_type: "image/png",
						thumbnail_path: pair.thumbnailPath,
						original_path: pair.originalPath,
						thumbnail_size_bytes: 1024,
						original_size_bytes: 1024,
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				const baseUrl = `/api/workspaces/${fixture.workspaceId}/cards/${agentCard.id}/attachments/${attachment.id}`;

				try {
					const post = await attachPair(
						request(app).post(uploadUrl(fixture.workspaceId, agentCard.id)),
						pngFixture(),
						pngFixture(),
					);
					expect(post.status).toBe(404);

					const get = await request(app).get(`${baseUrl}/thumbnail`);
					expect(get.status).toBe(404);

					const remove = await request(app).delete(baseUrl);
					expect(remove.status).toBe(404);
					expect(await attachmentRows(agentCard.id)).toHaveLength(1);
				} finally {
					await fixture.storage.removePair(pair);
					await db
						.deleteFrom("agent_boards")
						.where("id", "=", board.id)
						.execute();
				}
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
	},
);
