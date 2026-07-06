import { describe, expect, it } from "vitest";
import {
	deriveBackgroundColor,
	generateRandomPastelBorder,
	generateSwatchCandidates,
	isStoredOklchColor,
} from "./columnColorUtils";

const OKLCH_RE = /^oklch\(/;

function parseL(css: string): number {
	const m = css.match(/oklch\(([\d.]+)%/);
	return m ? Number(m[1]) / 100 : Number(css.match(/oklch\(([\d.]+)/)?.[1]);
}

describe("generateSwatchCandidates", () => {
	it("returns 5 oklch border colors in pastel L band when nothing pinned", () => {
		const swatches = generateSwatchCandidates(null);
		expect(swatches).toHaveLength(5);
		for (const s of swatches) {
			expect(s).toMatch(OKLCH_RE);
			const l = parseL(s);
			expect(l).toBeGreaterThanOrEqual(0.84);
			expect(l).toBeLessThanOrEqual(0.94);
		}
	});
});

describe("pinning and gamut safety", () => {
	const PINNED = "oklch(88% 0.09 47.3)";

	it("pins the active color as first swatch", () => {
		const swatches = generateSwatchCandidates(PINNED);
		expect(swatches).toHaveLength(5);
		expect(swatches[0]).toBe(PINNED);
	});

	it("generates in-gamut pastel strings (clampChroma)", () => {
		for (let i = 0; i < 20; i++) {
			const css = generateRandomPastelBorder();
			expect(css).toMatch(OKLCH_RE);
			expect(css.length).toBeGreaterThan(10);
		}
	});

	it("derives a lighter bg tint from border color", () => {
		const bg = deriveBackgroundColor(PINNED);
		expect(bg).toMatch(OKLCH_RE);
		expect(parseL(bg)).toBeGreaterThan(parseL(PINNED));
	});
});

describe("isStoredOklchColor", () => {
	it("returns true for oklch strings and false for legacy names", () => {
		expect(isStoredOklchColor("oklch(88% 0.09 47.3)")).toBe(true);
		expect(isStoredOklchColor("powder-blue")).toBe(false);
	});
});
