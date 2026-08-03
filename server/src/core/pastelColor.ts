import { clampChroma, formatCss, random } from "culori";

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
