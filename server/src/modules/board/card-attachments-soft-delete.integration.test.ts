import { access } from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "../../db/kysely.js";
import {
	type AttachmentPair,
	type AttachmentStorage,
	setAttachmentStorageForTests,
} from "../../lib/attachment-storage.js";
import {
	app,
	attachmentRows,
	countFiles,
	waitBriefly,
	withUploadFixture,
} from "./card-attachments-upload.support.js";

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

async function expectMissing(filePath: string): Promise<void> {
	await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
}

function storagePath(root: string, providerPath: string): string {
	return path.join(root, providerPath);
}

integration("soft-deleted card attachment cleanup", () => {
	it("removes attachment rows and tolerates post-commit unlink failure", async () => {
		await withUploadFixture(2, async (fixture) => {
			const rows = await attachmentRows(fixture.cardId);
			const failingPath = rows[0]!.thumbnail_path;
			const trackerStatus = await db
				.selectFrom("tracker_vocabularies")
				.select("id")
				.where("workspace_id", "=", fixture.workspaceId)
				.where("kind", "=", "status")
				.where("slot", "=", "todo")
				.executeTakeFirstOrThrow();
			const trackerItem = await db
				.insertInto("tracker_items")
				.values({
					workspace_id: fixture.workspaceId,
					key_number: 1,
					title: "Unrelated tracker item",
					status_id: trackerStatus.id,
				})
				.returning(["id", "title", "version"])
				.executeTakeFirstOrThrow();
			const failingStorage: AttachmentStorage = {
				root: fixture.storage.root,
				writePair: (inputOrThumbnail, original) =>
					fixture.storage.writePair(inputOrThumbnail, original),
				removePair: async (pair: AttachmentPair) => {
					if (pair.thumbnailPath === failingPath) {
						throw new Error("simulated unlink failure");
					}
					await fixture.storage.removePair(pair);
				},
				removePairs: (pairs) => fixture.storage.removePairs(pairs),
			};
			setAttachmentStorageForTests(failingStorage);

			const response = await request(app).delete(
				`/api/workspaces/${fixture.workspaceId}/cards/${fixture.cardId}`,
			);
			expect(response.status).toBe(204);
			await waitBriefly();

			const card = await db
				.selectFrom("cards")
				.select(["deleted_at", "version"])
				.where("id", "=", fixture.cardId)
				.executeTakeFirstOrThrow();
			expect(card.deleted_at).not.toBeNull();
			expect(card.version).toBe(1);
			expect(await attachmentRows(fixture.cardId)).toEqual([]);
			await expectMissing(
				storagePath(fixture.storage.root, rows[1]!.thumbnail_path),
			);
			await expectMissing(
				storagePath(fixture.storage.root, rows[1]!.original_path),
			);
			expect(await countFiles(fixture.storage.root)).toBe(2);

			const trackerAfter = await db
				.selectFrom("tracker_items")
				.select(["id", "title", "version"])
				.where("id", "=", trackerItem.id)
				.executeTakeFirstOrThrow();
			expect(trackerAfter).toEqual(trackerItem);

			const events = await db
				.selectFrom("card_events")
				.select("event_type")
				.where("workspace_id", "=", fixture.workspaceId)
				.execute();
			expect(events.map((event) => event.event_type)).toEqual(["delete"]);
		});
	});
});
