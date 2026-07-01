import { describe, expect, it } from "vitest";
import { checkCompleteness } from "./completeness.js";

describe("checkCompleteness", () => {
	it("returns ready:true when all required fields are present", () => {
		const result = checkCompleteness({
			title: "Login button broken",
			description: "Users cannot sign in from the home page.",
			expected: "Clicking login opens the auth modal.",
			actual: "Nothing happens when the button is clicked.",
			repro: "Open home page, click Login.",
			type: "Bug",
		});

		expect(result.ready).toBe(true);
		expect(result.missingFields).toEqual([]);
		expect(result.question).toBeUndefined();
	});

	it("returns ready:true for Feature with title and description only", () => {
		const result = checkCompleteness({
			title: "Add dark mode",
			description: "Users want a dark theme toggle in settings.",
			expected: null,
			actual: null,
			repro: null,
			type: "Feature",
		});

		expect(result.ready).toBe(true);
		expect(result.missingFields).toEqual([]);
	});

	it("returns ready:false with question when Bug is missing expected/actual", () => {
		const result = checkCompleteness({
			title: "Checkout fails",
			description: "Payment step errors out.",
			expected: null,
			actual: null,
			repro: null,
			type: "Bug",
		});

		expect(result.ready).toBe(false);
		expect(result.missingFields).toContain("expected");
		expect(result.missingFields).toContain("actual");
		expect(result.question).toBeTruthy();
	});

	it("returns ready:false with title in missingFields when title is empty", () => {
		const result = checkCompleteness({
			title: "",
			description: "Something is wrong with the dashboard.",
			expected: null,
			actual: null,
			repro: null,
			type: "Feature",
		});

		expect(result.ready).toBe(false);
		expect(result.missingFields).toContain("title");
	});
});
