import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../types";
import { describeEvent } from "./ActivityPage";

function makeEvent(patch: Partial<ActivityEvent>): ActivityEvent {
	return {
		id: 1,
		type: "move",
		cardId: 5,
		cardTitle: "Screenshot card",
		fromColumn: null,
		toColumn: null,
		actor: { username: "sinta", displayName: "Sinta" },
		createdAt: "2026-06-11T00:00:00.000Z",
		...patch,
	};
}

describe("describeEvent attachment activity", () => {
	it("describes attachment_added with card title and no image markup", () => {
		const event = makeEvent({
			type: "attachment_added",
			payload: {
				attachmentId: 9,
				mimeType: "image/png",
				createdAt: "2026-09-05T10:00:00.000Z",
			},
		});
		const description = describeEvent(event);
		expect(description).toBe("added an image to “Screenshot card”");
		expect(description).not.toMatch(/<img|thumbnail|\.png/i);
	});

	it("describes attachment_removed with card title and no image markup", () => {
		const event = makeEvent({
			type: "attachment_removed",
			payload: {
				attachmentId: 9,
				mimeType: "image/png",
				createdAt: "2026-09-05T10:00:00.000Z",
			},
		});
		const description = describeEvent(event);
		expect(description).toBe("removed an image from “Screenshot card”");
		expect(description).not.toMatch(/<img|thumbnail|\.png/i);
	});

	it("falls back to a card label when cardTitle is missing", () => {
		const event = makeEvent({
			type: "attachment_added",
			cardTitle: null,
			payload: {
				attachmentId: 9,
				mimeType: "image/jpeg",
				createdAt: "2026-09-05T10:00:00.000Z",
			},
		});
		expect(describeEvent(event)).toBe("added an image to a card");
	});
});
