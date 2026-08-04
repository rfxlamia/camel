import { clampChroma, formatCss, parse, random } from "culori";
import { COLOR_PREVIEWS, type ColumnColor } from "./columnColors";

/** Border lightness — matches legacy shade-200 OKLCH band (~L 84–94% in index.css). */
export const PASTEL_BORDER_L = 0.89;
/** Border chroma — matches legacy shade-200 OKLCH band (~C 0.027–0.096 in index.css). */
export const PASTEL_BORDER_C = 0.07;

/** Background lightness — matches legacy shade-50 OKLCH band (~L 96–98% in index.css). */
export const PASTEL_BG_L = 0.97;
/** Background chroma — matches legacy shade-50 OKLCH band (~C 0.007–0.027 in index.css). */
export const PASTEL_BG_C = 0.015;

export function generateRandomPastelBorder(): string {
	const color = random("oklch", {
		l: PASTEL_BORDER_L,
		c: PASTEL_BORDER_C,
		h: [0, 360],
	});
	const inGamut = clampChroma(color, "oklch");
	return formatCss(inGamut);
}

export function generateSwatchCandidates(pinned: string | null): string[] {
	if (pinned) {
		return [pinned, ...Array.from({ length: 4 }, () => generateRandomPastelBorder())];
	}
	return Array.from({ length: 5 }, () => generateRandomPastelBorder());
}

export function deriveBackgroundColor(borderCss: string): string {
	const parsed = parse(borderCss);
	if (!parsed || parsed.mode !== "oklch" || parsed.h === undefined) {
		return formatCss({ mode: "oklch", l: PASTEL_BG_L, c: PASTEL_BG_C, h: 0 });
	}
	return formatCss({
		mode: "oklch",
		l: PASTEL_BG_L,
		c: PASTEL_BG_C,
		h: parsed.h,
	});
}

export function isStoredOklchColor(value: string): boolean {
	return value.startsWith("oklch(");
}

export function columnColorPreviewStyle(
	color: string | null,
): { backgroundColor: string } {
	if (!color) {
		return { backgroundColor: "var(--color-primary-400)" };
	}
	if (isStoredOklchColor(color)) {
		return { backgroundColor: color };
	}
	if (color in COLOR_PREVIEWS) {
		return { backgroundColor: COLOR_PREVIEWS[color as ColumnColor] };
	}
	return { backgroundColor: color };
}
