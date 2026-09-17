// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
	TRACKER_GROUP_BY_STORAGE_KEY,
	readTrackerGroupBy,
	writeTrackerGroupBy,
} from "./trackerViewPrefs";

afterEach(() => {
	localStorage.removeItem(TRACKER_GROUP_BY_STORAGE_KEY);
});

describe("trackerViewPrefs", () => {
	it("persists and reads a per-workspace grouping", () => {
		writeTrackerGroupBy(7, "priority");
		expect(readTrackerGroupBy(7)).toBe("priority");
		expect(readTrackerGroupBy(8)).toBe("status");
	});

	it("rejects a stored array so a later write can still persist", () => {
		localStorage.setItem(TRACKER_GROUP_BY_STORAGE_KEY, "[]");
		expect(readTrackerGroupBy(7)).toBe("status");

		writeTrackerGroupBy(7, "project");
		expect(readTrackerGroupBy(7)).toBe("project");
		expect(JSON.parse(localStorage.getItem(TRACKER_GROUP_BY_STORAGE_KEY)!)).toEqual(
			{ "7": "project" },
		);
	});
});
