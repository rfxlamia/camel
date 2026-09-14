import { describe, expect, it } from "vitest";
import { buildSearchPattern, escapeIlikePattern } from "./my-work-query.js";

describe("My Work search patterns", () => {
	it("escapes ILIKE metacharacters for literal matching", () => {
		expect(escapeIlikePattern("50%")).toBe("50\\%");
		expect(buildSearchPattern("50%")).toBe("%50\\%%");
	});
});
