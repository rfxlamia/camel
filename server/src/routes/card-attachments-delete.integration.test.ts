import { access } from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "../db/kysely.js";
import { createRealtimeHub, setRealtimeHubForTests } from "../realtime.js";
import {
	app,
	attachmentRows,
	cardVersion,
	countFiles,
	withUploadFixture,
} from "./card-attachments-upload.support.js";

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

async function expectMissing(filePath: string): Promise<void> {
	await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
}

function storagePath(root: string, providerPath: string): string {
	return path.join(root, providerPath);
}

function deleteUrl(workspaceId: number, cardId: number, attachmentId: number) {
	return `/api/workspaces/${workspaceId}/cards/${cardId}/attachments/${attachmentId}`;
}

async function cardColumnId(cardId: number): Promise<number> {
	const card = await db
		.selectFrom("cards")
		.select("column_id")
		.where("id", "=", cardId)
		.executeTakeFirstOrThrow();
	return card.column_id;
}

function expectMetadataOnlyPayload(payload: Record<string, unknown>): void {
	expect(Object.keys(payload).sort()).toEqual([
		"attachmentId",
		"createdAt",
		"mimeType",
	]);
}

integration("card attachment deletion", () => {
	it("deletes non-cover and cover attachments with activity, realtime, and stable version", async () => {
		await withUploadFixture(2, async (fixture) => {
			const hub = createRealtimeHub({ publisher: null, subscriber: null });
			const events = hub.connectLocalClient({
				workspaceId: fixture.workspaceId,
			});
			setRealtimeHubForTests(hub);
			const beforeVersion = await cardVersion(fixture.cardId);
			const rows = await attachmentRows(fixture.cardId);
			const [cover, nextCover] = rows;
			expect(cover).toBeDefined();
			expect(nextCover).toBeDefined();

			const removeNext = await request(app).delete(
				deleteUrl(fixture.workspaceId, fixture.cardId, nextCover!.id),
			);
			expect(removeNext.status).toBe(204);
			expect(await cardVersion(fixture.cardId)).toBe(beforeVersion);
			expect(await attachmentRows(fixture.cardId)).toEqual([cover]);
			await expectMissing(
				storagePath(fixture.storage.root, nextCover!.thumbnail_path),
			);
			await expectMissing(
				storagePath(fixture.storage.root, nextCover!.original_path),
			);

			const afterNext = await request(app).get(
				`/api/workspaces/${fixture.workspaceId}/cards/${fixture.cardId}`,
			);
			expect(afterNext.status).toBe(200);
			expect(
				afterNext.body.attachments.map(
					(attachment: { id: number }) => attachment.id,
				),
			).toEqual([cover!.id]);
			expect(events.drain()).toEqual([
				expect.objectContaining({
					type: "attachment.removed",
					workspaceId: fixture.workspaceId,
					cardId: fixture.cardId,
					payload: expect.objectContaining({ attachmentId: nextCover!.id }),
				}),
			]);

			const removeCover = await request(app).delete(
				deleteUrl(fixture.workspaceId, fixture.cardId, cover!.id),
			);
			expect(removeCover.status).toBe(204);
			expect(await cardVersion(fixture.cardId)).toBe(beforeVersion);
			expect(await attachmentRows(fixture.cardId)).toEqual([]);
			await expectMissing(
				storagePath(fixture.storage.root, cover!.thumbnail_path),
			);
			await expectMissing(
				storagePath(fixture.storage.root, cover!.original_path),
			);
			const emptyCard = await request(app).get(
				`/api/workspaces/${fixture.workspaceId}/cards/${fixture.cardId}`,
			);
			expect(emptyCard.status).toBe(200);
			expect(emptyCard.body.attachments).toEqual([]);
			expect(events.drain()).toEqual([
				expect.objectContaining({
					type: "attachment.removed",
					workspaceId: fixture.workspaceId,
					cardId: fixture.cardId,
					payload: expect.objectContaining({ attachmentId: cover!.id }),
				}),
			]);

			const activities = await db
				.selectFrom("card_events")
				.select(["event_type", "to_column_id", "payload"])
				.where("card_id", "=", fixture.cardId)
				.orderBy("id")
				.execute();
			expect(activities).toHaveLength(2);
			const columnId = await cardColumnId(fixture.cardId);
			expect(activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event_type: "attachment_removed",
						to_column_id: columnId,
						payload: expect.objectContaining({ attachmentId: nextCover!.id }),
					}),
					expect.objectContaining({
						event_type: "attachment_removed",
						to_column_id: columnId,
						payload: expect.objectContaining({ attachmentId: cover!.id }),
					}),
				]),
			);
			for (const activity of activities) {
				expectMetadataOnlyPayload(activity.payload as Record<string, unknown>);
			}
			expect(await countFiles(fixture.storage.root)).toBe(0);
		});
	}, 15_000);

	it("reassigns the cover to the next attachment when the cover is deleted", async () => {
		await withUploadFixture(2, async (fixture) => {
			const hub = createRealtimeHub({ publisher: null, subscriber: null });
			const events = hub.connectLocalClient({
				workspaceId: fixture.workspaceId,
			});
			setRealtimeHubForTests(hub);
			const beforeVersion = await cardVersion(fixture.cardId);
			const rows = await attachmentRows(fixture.cardId);
			const [cover, nextCover] = rows;
			expect(cover).toBeDefined();
			expect(nextCover).toBeDefined();

			const removeCover = await request(app).delete(
				deleteUrl(fixture.workspaceId, fixture.cardId, cover!.id),
			);
			expect(removeCover.status).toBe(204);
			expect(await cardVersion(fixture.cardId)).toBe(beforeVersion);
			expect(await attachmentRows(fixture.cardId)).toEqual([nextCover]);
			await expectMissing(
				storagePath(fixture.storage.root, cover!.thumbnail_path),
			);
			await expectMissing(
				storagePath(fixture.storage.root, cover!.original_path),
			);

			const reassignedCard = await request(app).get(
				`/api/workspaces/${fixture.workspaceId}/cards/${fixture.cardId}`,
			);
			expect(reassignedCard.status).toBe(200);
			expect(
				reassignedCard.body.attachments.map(
					(attachment: { id: number }) => attachment.id,
				),
			).toEqual([nextCover!.id]);
			expect(events.drain()).toEqual([
				expect.objectContaining({
					type: "attachment.removed",
					workspaceId: fixture.workspaceId,
					cardId: fixture.cardId,
					payload: expect.objectContaining({ attachmentId: cover!.id }),
				}),
			]);

			const removeNext = await request(app).delete(
				deleteUrl(fixture.workspaceId, fixture.cardId, nextCover!.id),
			);
			expect(removeNext.status).toBe(204);
			expect(await cardVersion(fixture.cardId)).toBe(beforeVersion);
			expect(await attachmentRows(fixture.cardId)).toEqual([]);
			await expectMissing(
				storagePath(fixture.storage.root, nextCover!.thumbnail_path),
			);
			await expectMissing(
				storagePath(fixture.storage.root, nextCover!.original_path),
			);
			const emptyCard = await request(app).get(
				`/api/workspaces/${fixture.workspaceId}/cards/${fixture.cardId}`,
			);
			expect(emptyCard.status).toBe(200);
			expect(emptyCard.body.attachments).toEqual([]);
			expect(events.drain()).toEqual([
				expect.objectContaining({
					type: "attachment.removed",
					workspaceId: fixture.workspaceId,
					cardId: fixture.cardId,
					payload: expect.objectContaining({ attachmentId: nextCover!.id }),
				}),
			]);

			const activities = await db
				.selectFrom("card_events")
				.select(["event_type", "to_column_id", "payload"])
				.where("card_id", "=", fixture.cardId)
				.orderBy("id")
				.execute();
			expect(activities).toHaveLength(2);
			const columnId = await cardColumnId(fixture.cardId);
			expect(activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event_type: "attachment_removed",
						to_column_id: columnId,
						payload: expect.objectContaining({ attachmentId: cover!.id }),
					}),
					expect.objectContaining({
						event_type: "attachment_removed",
						to_column_id: columnId,
						payload: expect.objectContaining({ attachmentId: nextCover!.id }),
					}),
				]),
			);
			for (const activity of activities) {
				expectMetadataOnlyPayload(activity.payload as Record<string, unknown>);
			}
			expect(await countFiles(fixture.storage.root)).toBe(0);
		});
	}, 15_000);
});
