import { myWorkStatusGroup } from "./my-work-response-serialization.js";
import type {
	MyWorkCursor,
	MyWorkSerializedItem,
	MyWorkStatusGroup,
} from "./my-work-types.js";

function safeIso(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function itemDueDate(item: MyWorkSerializedItem): string | null {
	const value = item.source === "board" ? item.dueDate : item.endDate;
	return typeof value === "string" && value.length > 0
		? value.slice(0, 10)
		: null;
}

function itemStatusGroup(item: MyWorkSerializedItem): MyWorkStatusGroup {
	if (item.statusCategory) return item.statusCategory;
	const status = item.status;
	return myWorkStatusGroup(
		typeof status.category === "string" ? status.category : null,
		typeof status.slot === "string" ? status.slot : null,
	);
}

function localDateForTimezone(now: Date, timezone: string | null): string {
	const resolvedTimezone = timezone || "UTC";
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: resolvedTimezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(now);
		const year = parts.find((part) => part.type === "year")?.value ?? "1970";
		const month = parts.find((part) => part.type === "month")?.value ?? "01";
		const day = parts.find((part) => part.type === "day")?.value ?? "01";
		return `${year}-${month}-${day}`;
	} catch {
		return now.toISOString().slice(0, 10);
	}
}

export function isMyWorkItemOverdue(
	item: MyWorkSerializedItem,
	now = new Date(),
): boolean {
	const dueDate = itemDueDate(item);
	if (!dueDate) return false;
	const group = itemStatusGroup(item);
	if (group === "completed" || group === "canceled") return false;
	return dueDate < localDateForTimezone(now, item.workspace.timezone);
}

export const isOverdue = isMyWorkItemOverdue;

function groupRank(group: MyWorkStatusGroup): number {
	switch (group) {
		case "backlog":
			return 0;
		case "started":
			return 1;
		case "completed":
			return 2;
		case "canceled":
			return 3;
		case "other":
			return 4;
	}
}

function cursorForItem(item: MyWorkSerializedItem, now: Date): MyWorkCursor {
	return {
		group: groupRank(itemStatusGroup(item)),
		overdue: isMyWorkItemOverdue(item, now),
		dueDate: itemDueDate(item),
		updatedAt: safeIso(item.updatedAt),
		workspaceId: item.workspaceId,
		source: item.source,
		key: item.key,
		id: item.id,
	};
}

function compareNullableDates(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a < b ? -1 : 1;
}

/** Newer updates are first; every following field makes the order total. */
export function compareMyWorkCursors(a: MyWorkCursor, b: MyWorkCursor): number {
	if (a.group !== b.group) return a.group - b.group;
	if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
	const due = compareNullableDates(a.dueDate, b.dueDate);
	if (due !== 0) return due;
	if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
	if (a.workspaceId !== b.workspaceId) return a.workspaceId - b.workspaceId;
	if (a.source !== b.source) return a.source === "board" ? -1 : 1;
	if (a.key !== b.key) return a.key < b.key ? -1 : 1;
	return a.id - b.id;
}

export function sortMyWorkItems(
	items: readonly MyWorkSerializedItem[],
	now = new Date(),
): MyWorkSerializedItem[] {
	return [...items].sort((a, b) =>
		compareMyWorkCursors(cursorForItem(a, now), cursorForItem(b, now)),
	);
}

export const orderMyWorkItems = sortMyWorkItems;

export function encodeMyWorkCursor(cursor: MyWorkCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMyWorkCursor(value: string): MyWorkCursor | null {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		);
		if (!parsed || typeof parsed !== "object") return null;
		const candidate = parsed as Record<string, unknown>;
		if (
			typeof candidate.group !== "number" ||
			typeof candidate.overdue !== "boolean" ||
			(candidate.dueDate !== null && typeof candidate.dueDate !== "string") ||
			typeof candidate.updatedAt !== "string" ||
			typeof candidate.workspaceId !== "number" ||
			(candidate.source !== "board" && candidate.source !== "tracker") ||
			typeof candidate.key !== "string" ||
			typeof candidate.id !== "number"
		) {
			return null;
		}
		return {
			group: candidate.group,
			overdue: candidate.overdue,
			dueDate: candidate.dueDate,
			updatedAt: candidate.updatedAt,
			workspaceId: candidate.workspaceId,
			source: candidate.source,
			key: candidate.key,
			id: candidate.id,
		};
	} catch {
		return null;
	}
}

export const encodeCursor = encodeMyWorkCursor;
export const decodeCursor = decodeMyWorkCursor;

export function paginateMyWorkItems(
	items: readonly MyWorkSerializedItem[],
	options: {
		limit?: number;
		cursor?: string | null;
		now?: Date;
		/** True when a bounded source query returned a sentinel row. */
		hasMore?: boolean;
	} = {},
): { items: MyWorkSerializedItem[]; nextCursor: string | null } {
	const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 50)));
	const now = options.now ?? new Date();
	const ordered = sortMyWorkItems(items, now);
	let start = 0;
	if (options.cursor) {
		const cursor = decodeMyWorkCursor(options.cursor);
		if (cursor) {
			start = ordered.findIndex(
				(item) => compareMyWorkCursors(cursorForItem(item, now), cursor) > 0,
			);
			if (start === -1) start = ordered.length;
		}
	}
	const page = ordered.slice(start, start + limit);
	const hasMore = options.hasMore === true || start + limit < ordered.length;
	return {
		items: page,
		nextCursor:
			hasMore && page.length > 0
				? encodeMyWorkCursor(cursorForItem(page[page.length - 1]!, now))
				: null,
	};
}

export const paginateMyWork = paginateMyWorkItems;
