import { describe, expect, it } from "vitest";
import { COLUMN_STYLES } from "./columnColors";
import { resolveColumnAppearance } from "./columnStyleResolver";

const OKLCH_BORDER = "oklch(88% 0.09 47.3)";

describe("resolveColumnAppearance", () => {
	it("returns legacy Tailwind classes for named palette colors", () => {
		const result = resolveColumnAppearance("powder-blue", false);
		expect(result).toEqual({
			kind: "legacy",
			className: COLUMN_STYLES["powder-blue"],
		});
	});

	it("returns inline borderColor and derived backgroundColor for OKLCH strings", () => {
		const result = resolveColumnAppearance(OKLCH_BORDER, false);
		expect(result.kind).toBe("inline");
		if (result.kind === "inline") {
			expect(result.style.borderColor).toBe(OKLCH_BORDER);
			expect(result.style.backgroundColor).toMatch(/^oklch\(/);
		}
	});

	it("returns default neutral classes for null color", () => {
		const result = resolveColumnAppearance(null, false);
		expect(result).toEqual({
			kind: "default",
			className: "border-neutral-200 bg-neutral-100",
		});
	});

	it("returns default neutral classes for invalid color strings", () => {
		const result = resolveColumnAppearance("not-a-color", false);
		expect(result).toEqual({
			kind: "default",
			className: "border-neutral-200 bg-neutral-100",
		});
	});

	it("returns WIP error classes when over limit, overriding any color", () => {
		expect(resolveColumnAppearance("powder-blue", true)).toEqual({
			kind: "wip",
			className: "border-error-300 bg-error-100/40",
		});
		expect(resolveColumnAppearance(OKLCH_BORDER, true)).toEqual({
			kind: "wip",
			className: "border-error-300 bg-error-100/40",
		});
		expect(resolveColumnAppearance(null, true)).toEqual({
			kind: "wip",
			className: "border-error-300 bg-error-100/40",
		});
	});
});
