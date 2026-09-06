// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
	countStagedSlots,
	mapStagedImagesToAttachments,
	type StagedImage,
} from "./addCardImageStaging";

describe("addCardImageStaging", () => {
	it("counts loading entries toward the staged slot cap", () => {
		const entries: StagedImage[] = [
			{ id: "1", kind: "loading", name: "a.png" },
			{ id: "2", kind: "loading", name: "b.png" },
			{
				id: "3",
				kind: "valid",
				name: "c.png",
				prepared: {
					thumbnail: new File([], "c.png"),
					original: new File([], "c.png"),
				},
				previewUrl: "blob:c",
			},
		];
		expect(countStagedSlots(entries)).toBe(3);
	});

	it("maps only valid and network-error entries to attachment payloads", () => {
		const prepared = {
			thumbnail: new File([], "ok.png"),
			original: new File([], "ok.png"),
		};
		const entries: StagedImage[] = [
			{ id: "1", kind: "loading", name: "wait.png" },
			{
				id: "2",
				kind: "invalid",
				name: "bad.png",
				file: new File([], "bad.png"),
				error: "too big",
			},
			{
				id: "3",
				kind: "valid",
				name: "ok.png",
				prepared,
				previewUrl: "blob:ok",
			},
			{
				id: "4",
				kind: "network-error",
				name: "retry.png",
				prepared,
				previewUrl: "blob:retry",
				error: "failed",
			},
		];
		expect(mapStagedImagesToAttachments(entries)).toEqual([prepared, prepared]);
	});
});
