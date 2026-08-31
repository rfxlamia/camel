import { describe, expect, it } from "vitest";
import { diffIds } from "./diff-ids.js";

describe("diffIds", () => {
	it("detects added ids", () => {
		expect(diffIds([1], [1, 2])).toEqual({
			added: [2],
			removed: [],
		});
	});

	it("detects removed ids", () => {
		expect(diffIds([1, 2], [2])).toEqual({
			added: [],
			removed: [1],
		});
	});

	it("dedupes next list", () => {
		expect(diffIds([], [3, 3, 3])).toEqual({
			added: [3],
			removed: [],
		});
	});

	it("returns empty diff when sets match", () => {
		expect(diffIds([1, 2], [2, 1])).toEqual({
			added: [],
			removed: [],
		});
	});

	it("clearing all ids", () => {
		expect(diffIds([1, 2], [])).toEqual({
			added: [],
			removed: [1, 2],
		});
	});
});
