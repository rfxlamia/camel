import type { ViewportRect } from "./popoverPlacement";

/**
 * Style properties that affect where a character lands inside a textarea.
 * The mirror element must copy all of them or the measurement drifts.
 */
const MIRRORED_STYLES = [
	"boxSizing",
	"width",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"borderTopWidth",
	"borderRightWidth",
	"borderBottomWidth",
	"borderLeftWidth",
	"fontFamily",
	"fontSize",
	"fontWeight",
	"fontStyle",
	"letterSpacing",
	"lineHeight",
	"textIndent",
	"textTransform",
	"wordSpacing",
	"whiteSpace",
	"wordBreak",
	"overflowWrap",
] as const;

export interface CaretOffset {
	/** Distance from the textarea's left edge, before scroll is applied. */
	x: number;
	/** Distance from the textarea's top edge, before scroll is applied. */
	y: number;
	height: number;
}

/**
 * Measure where the caret at `index` sits inside a textarea, relative to the
 * textarea's own box, by rendering the leading text into an off-screen mirror.
 *
 * The result is scroll- and viewport-independent, so callers can cache it and
 * only re-add the live bounding rect when repositioning.
 *
 * Returns null when measurement is unavailable (jsdom, detached node,
 * zero-height layout). Callers should fall back to the field's own rect.
 */
export function getTextareaCaretOffset(
	textarea: HTMLTextAreaElement,
	index: number,
): CaretOffset | null {
	if (typeof document === "undefined") return null;

	const computed = window.getComputedStyle(textarea);
	const mirror = document.createElement("div");
	for (const property of MIRRORED_STYLES) {
		mirror.style[property] = computed[property];
	}
	mirror.style.position = "absolute";
	mirror.style.top = "0";
	mirror.style.left = "0";
	mirror.style.visibility = "hidden";
	mirror.style.pointerEvents = "none";
	mirror.style.whiteSpace = "pre-wrap";
	mirror.style.overflowWrap = "break-word";
	mirror.style.height = "auto";
	mirror.style.overflow = "hidden";

	const clamped = Math.max(0, Math.min(index, textarea.value.length));
	mirror.textContent = textarea.value.slice(0, clamped);

	const marker = document.createElement("span");
	// A zero-width space keeps the marker on the current line without adding width.
	marker.textContent = "​";
	mirror.appendChild(marker);
	document.body.appendChild(mirror);

	const markerRect = marker.getBoundingClientRect();
	const mirrorRect = mirror.getBoundingClientRect();
	document.body.removeChild(mirror);

	const lineHeight = Number.parseFloat(computed.lineHeight);
	const fontSize = Number.parseFloat(computed.fontSize);
	const height =
		markerRect.height ||
		(Number.isFinite(lineHeight) ? lineHeight : 0) ||
		(Number.isFinite(fontSize) ? fontSize * 1.5 : 0);
	if (height === 0) return null;

	return {
		x: markerRect.left - mirrorRect.left,
		y: markerRect.top - mirrorRect.top,
		height,
	};
}

/** Turn a cached {@link CaretOffset} into a viewport rect for popover placement. */
export function caretOffsetToViewportRect(
	textarea: HTMLTextAreaElement,
	offset: CaretOffset,
): ViewportRect {
	const anchorRect = textarea.getBoundingClientRect();
	const left = anchorRect.left + offset.x - textarea.scrollLeft;
	const top = anchorRect.top + offset.y - textarea.scrollTop;
	return { top, left, right: left, bottom: top + offset.height };
}

/**
 * Convenience wrapper: measure and convert in one step. Prefer the two-step
 * form when repositioning repeatedly — the offset only changes when the text
 * before the caret changes.
 */
export function getTextareaCaretRect(
	textarea: HTMLTextAreaElement,
	index: number,
): ViewportRect | null {
	const anchorRect = textarea.getBoundingClientRect();
	if (anchorRect.width === 0 && anchorRect.height === 0) return null;
	const offset = getTextareaCaretOffset(textarea, index);
	if (!offset) return null;
	return caretOffsetToViewportRect(textarea, offset);
}
