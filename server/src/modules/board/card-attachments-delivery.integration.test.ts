import request from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "../../db/kysely.js";
import {
	app,
	attachmentId,
	cardId,
	cardOnlyGuardApp,
	deliveryUrl,
	originalBytes,
	otherAttachmentId,
	otherCardId,
	otherWorkspaceId,
	testUser,
	thumbnailBytes,
	workspaceId,
} from "./card-attachments.integration.support.js";

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"authenticated card attachment delivery",
	() => {
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
			expect(download.headers["content-disposition"]).toBe(
				'attachment; filename="original.png"',
			);

			await db
				.updateTable("attachments")
				.set({ mime_type: "image/jpeg" })
				.where("id", "=", otherAttachmentId)
				.execute();
			const jpegDownload = await request(app).get(
				`${deliveryUrl(otherWorkspaceId, otherCardId, otherAttachmentId, "original")}/download`,
			);
			expect(jpegDownload.status).toBe(200);
			expect(jpegDownload.headers["content-disposition"]).toBe(
				'attachment; filename="original.jpg"',
			);
		});
	},
);
