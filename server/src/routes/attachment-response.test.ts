import { describe, expect, it } from "vitest";
import {
	type AttachmentResponseRow,
	mapAttachmentResponses,
} from "./attachment-response.js";

const context = { workspaceId: 7, cardId: 42 };

function row(overrides: Partial<AttachmentResponseRow>): AttachmentResponseRow {
	return {
		id: 10,
		card_id: context.cardId,
		mime_type: "image/png",
		thumbnail_path: "private/thumbnail-a",
		original_path: "private/original-a",
		created_at: "2026-09-05T10:00:00.000Z",
		...overrides,
	};
}

describe("mapAttachmentResponses", () => {
	it("orders by created_at and then id and exposes only safe delivery metadata", () => {
		const result = mapAttachmentResponses(
			[
				row({
					id: 12,
					created_at: "2026-09-05T10:00:01.000Z",
					thumbnail_path: "/private/root/should-not-leak",
					original_path: "/private/root/original-12",
				}),
				row({
					id: 11,
					created_at: "2026-09-05T10:00:00.000Z",
					mime_type: "image/jpeg",
				}),
				row({
					id: 9,
					created_at: "2026-09-05T10:00:00.000Z",
				}),
			],
			context,
		);

		expect(result).toEqual([
			{
				id: 9,
				thumbnailUrl: "/api/workspaces/7/cards/42/attachments/9/thumbnail",
				originalUrl: "/api/workspaces/7/cards/42/attachments/9/original",
				downloadUrl:
					"/api/workspaces/7/cards/42/attachments/9/original/download",
				mimeType: "image/png",
				createdAt: "2026-09-05T10:00:00.000Z",
			},
			{
				id: 11,
				thumbnailUrl: "/api/workspaces/7/cards/42/attachments/11/thumbnail",
				originalUrl: "/api/workspaces/7/cards/42/attachments/11/original",
				downloadUrl:
					"/api/workspaces/7/cards/42/attachments/11/original/download",
				mimeType: "image/jpeg",
				createdAt: "2026-09-05T10:00:00.000Z",
			},
			{
				id: 12,
				thumbnailUrl: "/api/workspaces/7/cards/42/attachments/12/thumbnail",
				originalUrl: "/api/workspaces/7/cards/42/attachments/12/original",
				downloadUrl:
					"/api/workspaces/7/cards/42/attachments/12/original/download",
				mimeType: "image/png",
				createdAt: "2026-09-05T10:00:01.000Z",
			},
		]);
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("private");
		expect(serialized).not.toContain("thumbnail_path");
		expect(serialized).not.toContain("original_path");
	});

	it("returns an explicit empty list", () => {
		expect(mapAttachmentResponses([], context)).toEqual([]);
	});
});
