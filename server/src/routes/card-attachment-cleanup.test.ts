import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttachmentPair, AttachmentStorage } from "../lib/attachment-storage.js";
import { removeAttachmentPairsBestEffort } from "./card-attachment-cleanup.js";

function pair(index: number): AttachmentPair {
	return {
		thumbnailPath: `${index}/thumbnail`,
		originalPath: `${index}/original`,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("removeAttachmentPairsBestEffort", () => {
	it("limits concurrent deletions and continues after a rejected batch", async () => {
		let active = 0;
		let maximumActive = 0;
		const calls: string[] = [];
		const removePair = vi.fn(async (attachmentPair: AttachmentPair) => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			calls.push(attachmentPair.thumbnailPath);
			await Promise.resolve();
			active -= 1;
			if (attachmentPair.thumbnailPath === "0/thumbnail") {
				throw new Error("forced cleanup failure");
			}
		});
		const storage = { removePair } as unknown as AttachmentStorage;
		vi.spyOn(console, "error").mockImplementation(() => {});

		await removeAttachmentPairsBestEffort(
			storage,
			Array.from({ length: 9 }, (_, index) => pair(index)),
		);

		expect(maximumActive).toBeLessThanOrEqual(8);
		expect(calls).toHaveLength(9);
		expect(calls.at(-1)).toBe("8/thumbnail");
		expect(console.error).toHaveBeenCalledWith(
			"Failed to clean up attachment files",
			expect.any(Error),
		);
	});
});
