import type { TrackerGroupBy } from "./trackerUtils";

export const TRACKER_GROUP_BY_STORAGE_KEY = "trackerGroupByWorkspace";

const VALID: TrackerGroupBy[] = ["status", "project", "priority"];

function readMap(): Record<string, TrackerGroupBy> {
	try {
		const raw = localStorage.getItem(TRACKER_GROUP_BY_STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return {};
		}
		return parsed as Record<string, TrackerGroupBy>;
	} catch {
		return {};
	}
}

export function readTrackerGroupBy(workspaceId: number): TrackerGroupBy {
	try {
		const stored = readMap()[String(workspaceId)];
		return stored && VALID.includes(stored) ? stored : "status";
	} catch {
		return "status";
	}
}

export function writeTrackerGroupBy(
	workspaceId: number,
	groupBy: TrackerGroupBy,
): void {
	try {
		const map = readMap();
		map[String(workspaceId)] = groupBy;
		localStorage.setItem(TRACKER_GROUP_BY_STORAGE_KEY, JSON.stringify(map));
	} catch {
		// localStorage unavailable — the grouping just resets next visit.
	}
}
