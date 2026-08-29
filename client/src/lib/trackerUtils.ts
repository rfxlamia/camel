import type { TrackerItem, TrackerProject, TrackerVocabulary } from "../types";

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

interface DateParts {
	year: number;
	month: number;
	day: number;
}

function parseDateOnly(iso: string): DateParts | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) return null;
	return {
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3]),
	};
}

function formatOneDate({ year, month, day }: DateParts, withYear = false): string {
	const mon = MONTHS[month - 1];
	return withYear ? `${day} ${mon} ${year}` : `${day} ${mon}`;
}

function compareDates(a: DateParts, b: DateParts): number {
	if (a.year !== b.year) return a.year - b.year;
	if (a.month !== b.month) return a.month - b.month;
	return a.day - b.day;
}

/** Locale- and timezone-independent date range label for tracker rows. */
export function formatDateRange(
	startDate: string | null,
	endDate: string | null,
): string | null {
	if (startDate === null && endDate === null) return null;

	if (startDate === null || endDate === null) {
		const single = startDate
			? parseDateOnly(startDate)
			: endDate
				? parseDateOnly(endDate)
				: null;
		return single ? formatOneDate(single) : null;
	}

	const start = parseDateOnly(startDate);
	const end = parseDateOnly(endDate);
	if (!start || !end) return null;

	if (compareDates(start, end) > 0) return null;

	if (
		start.year === end.year &&
		start.month === end.month &&
		start.day === end.day
	) {
		return formatOneDate(start);
	}

	if (start.year === end.year && start.month === end.month) {
		const mon = MONTHS[start.month - 1];
		return `${start.day}–${end.day} ${mon}`;
	}

	if (start.year === end.year) {
		return `${formatOneDate(start)}–${formatOneDate(end)}`;
	}

	return `${formatOneDate(start, true)}–${formatOneDate(end, true)}`;
}

/** Status sections follow vocabulary position (fractional ordering). */
export function sortStatusesByPosition(
	statuses: TrackerVocabulary[],
): TrackerVocabulary[] {
	return [...statuses].sort((a, b) => a.position - b.position);
}

/** Items within a section: oldest createdAt first. */
export function sortItemsOldestFirst(items: TrackerItem[]): TrackerItem[] {
	return [...items].sort(
		(a, b) =>
			new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
	);
}

export function groupItemsByStatus(
	items: TrackerItem[],
	statuses: TrackerVocabulary[],
): Map<number, TrackerItem[]> {
	const byStatus = new Map<number, TrackerItem[]>();
	for (const status of statuses) {
		byStatus.set(status.id, []);
	}
	for (const item of items) {
		const bucket = byStatus.get(item.status.id);
		if (bucket) bucket.push(item);
	}
	for (const [id, bucket] of byStatus) {
		byStatus.set(id, sortItemsOldestFirst(bucket));
	}
	return byStatus;
}

/** Sentinel id for the "No priority" picker option — not a real vocabulary id. */
export const NO_PRIORITY = "none";

export type TrackerGroupBy = "status" | "project" | "priority";

export const TRACKER_GROUP_BY_LABELS: Record<TrackerGroupBy, string> = {
	status: "Status",
	project: "Project",
	priority: "Priority",
};

export interface TrackerGroup {
	/** Stable identity for collapse state and React keys. */
	key: string;
	label: string;
	items: TrackerItem[];
	/** Set on status groups — drives the header glyph and the + button. */
	status?: TrackerVocabulary;
	/** Set on priority groups — drives the header glyph. */
	priority?: TrackerVocabulary;
	/** Set on project groups — locks the + button to that project. */
	projectId?: number;
}

export interface TrackerGroupContext {
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	projects: TrackerProject[];
}

export function statusGroupKey(statusId: number): string {
	return `status:${statusId}`;
}

export function projectGroupKey(projectId: number | null): string {
	return projectId == null ? "project:none" : `project:${projectId}`;
}

export function priorityGroupKey(priorityId: number | null): string {
	return priorityId == null ? "priority:none" : `priority:${priorityId}`;
}

/**
 * Items inside a project follow the WBS reading order — phase order first, then
 * the manual position within the phase. Items with no phase sit at the end.
 */
function sortItemsForProject(
	items: TrackerItem[],
	project: TrackerProject,
): TrackerItem[] {
	const phasePosition = new Map(
		project.phases.map((phase) => [phase.id, phase.position]),
	);
	const rank = (item: TrackerItem) =>
		item.phaseId != null
			? (phasePosition.get(item.phaseId) ?? Number.POSITIVE_INFINITY)
			: Number.POSITIVE_INFINITY;

	return [...items].sort((a, b) => {
		const phaseA = rank(a);
		const phaseB = rank(b);
		if (phaseA !== phaseB) return phaseA < phaseB ? -1 : 1;
		const posA = a.position ?? Number.POSITIVE_INFINITY;
		const posB = b.position ?? Number.POSITIVE_INFINITY;
		if (posA !== posB) return posA < posB ? -1 : 1;
		return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
	});
}

function groupByProject(
	items: TrackerItem[],
	projects: TrackerProject[],
): TrackerGroup[] {
	const ordered = [...projects].sort((a, b) => a.position - b.position);
	// An empty project still gets a header: a project you just created must not
	// vanish from the list it was created in.
	const groups: TrackerGroup[] = ordered.map((project) => ({
		key: projectGroupKey(project.id),
		label: project.name,
		projectId: project.id,
		items: sortItemsForProject(
			items.filter((item) => item.projectId === project.id),
			project,
		),
	}));

	const loose = items.filter(
		(item) =>
			item.projectId == null ||
			!ordered.some((project) => project.id === item.projectId),
	);
	if (loose.length > 0) {
		groups.push({
			key: projectGroupKey(null),
			label: "No project",
			items: sortItemsOldestFirst(loose),
		});
	}
	return groups;
}

function groupByPriority(
	items: TrackerItem[],
	priorities: TrackerVocabulary[],
): TrackerGroup[] {
	const ordered = sortStatusesByPosition(priorities);
	const groups: TrackerGroup[] = ordered.map((priority) => ({
		key: priorityGroupKey(priority.id),
		label: priority.name,
		priority,
		items: sortItemsOldestFirst(
			items.filter((item) => item.priority?.id === priority.id),
		),
	}));

	const loose = items.filter(
		(item) =>
			item.priority == null ||
			!ordered.some((priority) => priority.id === item.priority?.id),
	);
	if (loose.length > 0) {
		groups.push({
			key: priorityGroupKey(null),
			label: "No priority",
			items: sortItemsOldestFirst(loose),
		});
	}
	return groups;
}

/**
 * One item set, three readings. Every item lands in exactly one group for any
 * grouping, so the group counts always add back up to the item total.
 */
export function groupItems(
	items: TrackerItem[],
	groupBy: TrackerGroupBy,
	{ statuses, priorities, projects }: TrackerGroupContext,
): TrackerGroup[] {
	if (groupBy === "project") return groupByProject(items, projects);
	if (groupBy === "priority") return groupByPriority(items, priorities);

	const ordered = sortStatusesByPosition(statuses);
	const byStatus = groupItemsByStatus(items, ordered);
	const groups: TrackerGroup[] = ordered.map((status) => ({
		key: statusGroupKey(status.id),
		label: status.name,
		status,
		items: byStatus.get(status.id) ?? [],
	}));

	// groupItemsByStatus drops items whose status has no vocabulary. Catching
	// them here keeps the conservation guarantee a property of this function
	// rather than of whatever the vocabulary API happens to allow.
	const loose = items.filter(
		(item) => !ordered.some((status) => status.id === item.status.id),
	);
	if (loose.length > 0) {
		groups.push({
			key: "status:none",
			label: "No status",
			items: sortItemsOldestFirst(loose),
		});
	}
	return groups;
}

export function resolveToggle(currentIds: number[], toggledId: number): number[] {
	return currentIds.includes(toggledId)
		? currentIds.filter((id) => id !== toggledId)
		: [...currentIds, toggledId];
}
