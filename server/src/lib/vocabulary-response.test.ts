import { describe, expect, it } from "vitest";
import { serializeVocabulary } from "./vocabulary-response.js";

describe("serializeVocabulary", () => {
	it("keeps the base vocabulary response and emits slot only when supplied", () => {
		expect(
			serializeVocabulary({
				id: 7,
				kind: "status",
				name: "In Progress",
				position: 2,
				colour: "oklch(0.7 0.1 150)",
			}),
		).toEqual({
			id: 7,
			kind: "status",
			name: "In Progress",
			position: 2,
			colour: "oklch(0.7 0.1 150)",
		});
		expect(
			serializeVocabulary({
				id: 7,
				kind: "status",
				name: "In Progress",
				position: 2,
				colour: "oklch(0.7 0.1 150)",
				slot: "in_progress",
			}),
		).toHaveProperty("slot", "in_progress");
	});

	it("preserves tracker vocabulary category and createdAt compatibility", () => {
		expect(
			serializeVocabulary({
				id: 3,
				kind: "status",
				name: "Done",
				position: 3,
				colour: "green",
				category: "completed",
				created_at: "2026-08-29T00:00:00.000Z",
			}),
		).toEqual({
			id: 3,
			kind: "status",
			name: "Done",
			position: 3,
			colour: "green",
			category: "completed",
			createdAt: "2026-08-29T00:00:00.000Z",
		});
	});
});
