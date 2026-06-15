import type { ActivityEvent, Card, Column } from "../types";

/**
 * Parses the `:cardId` route param. Returns the card id only for a plain
 * positive integer ("42"); anything else ("abc", "4.5", "-1", "") is null so
 * the panel can clear the URL silently.
 */
export function parseCardId(param: string | undefined): number | null {
	if (param === undefined || !/^\d+$/.test(param)) return null;
	const id = Number(param);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The panel derives its card from board columns (single source of truth —
 * no separate GET /cards/:id). Missing card means the panel must close.
 */
export function findCardInColumns(
	columns: Column[] | null,
	cardId: number | null,
): Card | null {
	if (!columns || cardId === null) return null;
	for (const column of columns) {
		const card = column.cards.find((c) => c.id === cardId);
		if (card) return card;
	}
	return null;
}

export interface MissingCardRedirectInput {
	cardId: number | null;
	boardLoaded: boolean;
	cardFound: boolean;
}

export interface MissingCardRedirect {
	to: string;
	replace: boolean;
	toast: null;
}

/** Silent redirect when a deep-linked card is absent after the board has loaded. */
export function getMissingCardRedirect({
	boardLoaded,
	cardFound,
}: MissingCardRedirectInput): MissingCardRedirect | null {
	if (!boardLoaded || cardFound) return null;
	return { to: "/board", replace: true, toast: null };
}

/**
 * Per-card activity line, e.g. "moved Doing → Review". A move whose source
 * column was deleted (fromColumn null) omits the null side: "moved this to
 * Review" — never a dangling arrow.
 */
export function describeCardEvent(event: ActivityEvent): string {
	switch (event.type) {
		case "create":
			return event.toColumn
				? `added this card to ${event.toColumn}`
				: "added this card";
		case "move":
			if (event.fromColumn && event.toColumn)
				return `moved ${event.fromColumn} → ${event.toColumn}`;
			if (event.toColumn) return `moved this to ${event.toColumn}`;
			if (event.fromColumn) return `moved this from ${event.fromColumn}`;
			return "moved this card";
		case "update":
			return "updated this card";
		case "delete":
			return "deleted this card";
		default:
			return "changed this card";
	}
}
