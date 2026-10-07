/**
 * Resolves a display title from an event payload: `cardTitle` when it is a
 * string, otherwise `title` when it is a string, otherwise null.
 */
export function resolveEventTitle(payload: unknown): string | null {
	if (payload === null || typeof payload !== "object") return null;
	const { cardTitle, title } = payload as {
		cardTitle?: unknown;
		title?: unknown;
	};
	if (typeof cardTitle === "string") return cardTitle;
	if (typeof title === "string") return title;
	return null;
}
