import type {
	TrackerItem,
	TrackerPhase,
	TrackerProject,
} from "../types";
import { todayISODate } from "./boardViewUtils";

export type RollupResult =
	| { kind: "percent"; completed: number; total: number; ratio: number }
	| { kind: "no-active-work" }
	| { kind: "no-tasks" };

function isCompleted(item: TrackerItem): boolean {
	return item.status.category === "completed";
}

function isCanceled(item: TrackerItem): boolean {
	return item.status.category === "canceled";
}

export function rollup(items: TrackerItem[]): RollupResult {
	if (items.length === 0) {
		return { kind: "no-tasks" };
	}

	const active = items.filter((item) => !isCanceled(item));
	if (active.length === 0) {
		return { kind: "no-active-work" };
	}

	const completed = active.filter(isCompleted).length;
	const total = active.length;
	return {
		kind: "percent",
		completed,
		total,
		ratio: completed / total,
	};
}

export function isTaskOverdue(item: TrackerItem): boolean {
	if (item.endDate == null) return false;
	if (isCompleted(item) || isCanceled(item)) return false;
	return item.endDate < todayISODate();
}

export function phaseBounds(
	phase: TrackerPhase,
	items: TrackerItem[],
): { startDate: string | null; endDate: string | null } {
	const startDates = items
		.map((item) => item.startDate)
		.filter((d): d is string => d != null);
	const endDates = items
		.map((item) => item.endDate)
		.filter((d): d is string => d != null);

	const derivedStart =
		startDates.length > 0
			? startDates.reduce((min, d) => (d < min ? d : min))
			: null;
	const derivedEnd =
		endDates.length > 0
			? endDates.reduce((max, d) => (d > max ? d : max))
			: null;

	return {
		startDate: phase.startDate ?? derivedStart,
		endDate: phase.endDate ?? derivedEnd,
	};
}

function allTasksDoneOrCanceled(items: TrackerItem[]): boolean {
	return (
		items.length > 0 && items.every((item) => isCompleted(item) || isCanceled(item))
	);
}

export function isPhaseOverdue(phase: TrackerPhase, items: TrackerItem[]): boolean {
	if (items.some(isTaskOverdue)) return true;
	if (
		phase.endDate !== null &&
		phase.endDate < todayISODate() &&
		!allTasksDoneOrCanceled(items)
	) {
		return true;
	}
	return false;
}

export function isProjectOverdue(
	project: TrackerProject,
	items: TrackerItem[],
): boolean {
	const projectItems = items.filter((item) => item.projectId === project.id);
	if (projectItems.some(isTaskOverdue)) return true;

	for (const phase of project.phases) {
		const phaseItems = projectItems.filter((item) => item.phaseId === phase.id);
		if (isPhaseOverdue(phase, phaseItems)) return true;
	}

	return false;
}
