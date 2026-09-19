import type { MyWorkItem } from "../../shared/myWorkTypes";
import { type MyWorkStatusGroup, normalizeMyWorkStatus } from "./myWorkStatus";

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
