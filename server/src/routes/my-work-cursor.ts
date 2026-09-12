import { parseKeyFromUrl } from "../core/tracker-key.js";
import type { MyWorkCursor } from "./my-work-types.js";

export function myWorkKeyNumber(key: string): number | null {
	const parsed = parseKeyFromUrl(key.trim().toUpperCase());
	return parsed && Number.isSafeInteger(parsed.keyNumber)
		? parsed.keyNumber
		: null;
}

/**
 * Cursor keys are canonical workspace keys, but accept the explicit numeric
 * field for cursors produced by newer clients and older encoded cursors that
 * only carried the key string.
 */
export function myWorkCursorKeyNumber(cursor: MyWorkCursor): number | null {
	const fromKey = myWorkKeyNumber(cursor.key);
	if (fromKey !== null) return fromKey;
	return Number.isSafeInteger(cursor.keyNumber) ? cursor.keyNumber! : null;
}
