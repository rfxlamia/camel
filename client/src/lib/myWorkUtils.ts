import type { WorkItemSource } from "../types";
import type { MyWorkItem, MyWorkScope } from "../types/myWork";

export type MyWorkStatusGroup =
	| "backlog"
	| "started"
	| "completed"
	| "canceled"
	| "other";

export type MyWorkGroupMap = Record<MyWorkStatusGroup, MyWorkItem[]>;

type MyWorkStatusSource = Pick<MyWorkItem, "status" | "statusCategory">;

function categoryToGroup(
	category: string | null | undefined,
): MyWorkStatusGroup | null {
	switch (category) {
		case "backlog":
			return "backlog";
		case "started":
			return "started";
		case "completed":
			return "completed";
		case "canceled":
			return "canceled";
		default:
			return null;
	}
}

function slotToGroup(
	slot: string | null | undefined,
): MyWorkStatusGroup | null {
	switch (slot) {
		case "backlog":
		case "todo":
			return "backlog";
		case "in_progress":
			return "started";
		case "done":
			return "completed";
		case "canceled":
			return "canceled";
		default:
			return null;
	}
}

/** Normalize the server's existing category/slot vocabulary into My Work groups. */
export function normalizeMyWorkStatus(
	item: MyWorkStatusSource,
): MyWorkStatusGroup {
	const category = item.statusCategory ?? item.status.category;
	const categoryGroup = categoryToGroup(category);
	if (categoryGroup) return categoryGroup;
	if (category !== null && category !== undefined) return "other";
	return slotToGroup(item.status.slot) ?? "other";
}

export function isActiveMyWorkItem(item: MyWorkStatusSource): boolean {
	const group = normalizeMyWorkStatus(item);
	return group === "backlog" || group === "started" || group === "other";
}

/** Return a new array containing only the requested Active/All scope. */
export function filterMyWorkItems(
	items: MyWorkItem[],
	scope: MyWorkScope,
): MyWorkItem[] {
	if (scope === "all") return [...items];
	return items.filter(isActiveMyWorkItem);
}

function emptyMyWorkGroups(): MyWorkGroupMap {
	return {
		backlog: [],
		started: [],
		completed: [],
		canceled: [],
		other: [],
	};
}

/** Bucket server-provided rows by normalized status without dropping unknown rows. */
export function deriveMyWorkGroups(
	items: MyWorkItem[],
	scope: MyWorkScope = "all",
): MyWorkGroupMap {
	const groups = emptyMyWorkGroups();
	for (const item of filterMyWorkItems(items, scope)) {
		groups[normalizeMyWorkStatus(item)].push(item);
	}
	return groups;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MY_WORK_GROUP_ORDER: Record<MyWorkStatusGroup, number> = {
	backlog: 0,
	started: 1,
	completed: 2,
	canceled: 3,
	other: 4,
};

function validDateOnly(value: string): string | null {
	const match = DATE_ONLY_PATTERN.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const candidate = new Date(Date.UTC(year, month - 1, day));
	if (
		candidate.getUTCFullYear() !== year ||
		candidate.getUTCMonth() !== month - 1 ||
		candidate.getUTCDate() !== day
	) {
		return null;
	}
	return value;
}

function timezoneOrUtc(timezone: string | null | undefined): string {
	return timezone?.trim() || "UTC";
}

function localDateInTimezone(
	date: Date,
	timezone: string | null | undefined,
): string | null {
	if (Number.isNaN(date.getTime())) return null;
	try {
		const parts = new Intl.DateTimeFormat("en-CA", {
			timeZone: timezoneOrUtc(timezone),
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(date);
		const values = Object.fromEntries(
			parts
				.filter((part) => part.type !== "literal")
				.map((part) => [part.type, part.value]),
		);
		const dateOnly = `${values.year}-${values.month}-${values.day}`;
		return validDateOnly(dateOnly);
	} catch {
		// A malformed server timezone must not make a list unusable. UTC is a
		// deterministic fallback, unlike the browser's machine-local timezone.
		return localDateInTimezone(date, "UTC");
	}
}

function dueDateForComparison(item: MyWorkItem): string | null {
	const raw = item.source === "board" ? item.dueDate : item.endDate;
	if (!raw) return null;
	const dateOnly = validDateOnly(raw);
	if (dateOnly) return dateOnly;
	const parsed = new Date(raw);
	return localDateInTimezone(parsed, item.workspace.timezone);
}

/** Whether an unfinished item is due before its workspace-local current date. */
export function isMyWorkItemOverdue(
	item: MyWorkItem,
	now = new Date(),
): boolean {
	const group = normalizeMyWorkStatus(item);
	if (group === "completed" || group === "canceled") return false;

	const dueDate = dueDateForComparison(item);
	const today = localDateInTimezone(now, item.workspace.timezone);
	return dueDate !== null && today !== null && dueDate < today;
}

function compareStrings(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function timestampOrZero(value: string | null | undefined): number {
	if (!value) return 0;
	const timestamp = new Date(value).getTime();
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

function compareDueDates(a: MyWorkItem, b: MyWorkItem): number {
	const dueA = dueDateForComparison(a);
	const dueB = dueDateForComparison(b);
	if (dueA === null && dueB === null) return 0;
	if (dueA === null) return 1;
	if (dueB === null) return -1;
	return compareStrings(dueA, dueB);
}

const CANONICAL_KEY_PATTERN = /^[A-Z?]{1,2}-(\d+)$/;

function keyNumberForComparison(item: MyWorkItem): number {
	const match = CANONICAL_KEY_PATTERN.exec(item.key.trim().toUpperCase());
	if (!match) return Number.MAX_SAFE_INTEGER;
	const keyNumber = Number(match[1]);
	return Number.isSafeInteger(keyNumber) ? keyNumber : Number.MAX_SAFE_INTEGER;
}

function compareStableIdentity(a: MyWorkItem, b: MyWorkItem): number {
	if (a.workspaceId !== b.workspaceId) return a.workspaceId - b.workspaceId;
	if (a.source !== b.source) return a.source === "board" ? -1 : 1;
	const keyNumberDifference =
		keyNumberForComparison(a) - keyNumberForComparison(b);
	if (keyNumberDifference !== 0) return keyNumberDifference;
	return a.id - b.id;
}

/** Return a new, deterministic list ordered for My Work triage. */
export function orderMyWorkItems(
	items: MyWorkItem[],
	now = new Date(),
): MyWorkItem[] {
	return [...items].sort((a, b) => {
		const groupDifference =
			MY_WORK_GROUP_ORDER[normalizeMyWorkStatus(a)] -
			MY_WORK_GROUP_ORDER[normalizeMyWorkStatus(b)];
		if (groupDifference !== 0) return groupDifference;

		const overdueDifference =
			Number(isMyWorkItemOverdue(b, now)) - Number(isMyWorkItemOverdue(a, now));
		if (overdueDifference !== 0) return overdueDifference;

		const dueDateDifference = compareDueDates(a, b);
		if (dueDateDifference !== 0) return dueDateDifference;

		const updatedDifference =
			timestampOrZero(b.updatedAt) - timestampOrZero(a.updatedAt);
		if (updatedDifference !== 0) return updatedDifference;

		return compareStableIdentity(a, b);
	});
}

export type { MyWorkPage } from "./myWorkSearch";
export { MY_WORK_PAGE_SIZE, paginateMyWorkItems } from "./myWorkSearch";

export interface MyWorkViewState {
	scope: MyWorkScope;
	workspaceId: number | "";
	source: WorkItemSource | "";
	q: string;
	page: number;
}

export const DEFAULT_MY_WORK_VIEW_STATE: MyWorkViewState = {
	scope: "active",
	workspaceId: "",
	source: "",
	q: "",
	page: 1,
};

function parseWorkspaceId(value: string | null): number | "" {
	if (!value || !/^\d+$/.test(value)) return "";
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : "";
}

/** Parse URL view state using presentation-only defaults; it performs no I/O. */
export function parseMyWorkViewState(
	input: URLSearchParams | string,
): MyWorkViewState {
	const params = typeof input === "string" ? new URLSearchParams(input) : input;
	const scope: MyWorkScope = params.get("scope") === "all" ? "all" : "active";
	const workspaceId = parseWorkspaceId(
		params.get("workspaceId") ?? params.get("workspace"),
	);
	const sourceValue = params.get("source");
	const source: WorkItemSource | "" =
		sourceValue === "board" || sourceValue === "tracker" ? sourceValue : "";
	const pageValue = Number(params.get("page"));
	const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
	return {
		scope,
		workspaceId,
		source,
		q: params.get("q")?.trim() ?? "",
		page,
	};
}

/** Serialize view state with defaults omitted for compact, stable URLs. */
export function serializeMyWorkViewState(
	state: Partial<MyWorkViewState>,
): URLSearchParams {
	const params = new URLSearchParams();
	if (state.scope === "all") params.set("scope", "all");
	if (typeof state.workspaceId === "number" && state.workspaceId > 0) {
		params.set("workspaceId", String(state.workspaceId));
	}
	if (state.source === "board" || state.source === "tracker") {
		params.set("source", state.source);
	}
	const query = state.q?.trim() ?? "";
	if (query) params.set("q", query);
	if (
		state.page !== undefined &&
		Number.isSafeInteger(state.page) &&
		state.page > 1
	) {
		params.set("page", String(state.page));
	}
	return params;
}
