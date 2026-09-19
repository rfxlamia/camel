import type { MyWorkTrackerRow } from "./my-work-response.js";
import { NOW, ORBIT, trackerRow } from "./my-work-test-support.js";

export function statusScopeRows(): MyWorkTrackerRow[] {
	return [
		trackerRow({
			id: 105,
			key_number: 1,
			status_category: "backlog",
			status_slot: "backlog",
		}),
		trackerRow({
			id: 106,
			key_number: 2,
			status_category: "started",
			status_slot: "in_progress",
		}),
		trackerRow({
			id: 107,
			key_number: 3,
			status_category: "completed",
			status_slot: "done",
		}),
		trackerRow({
			id: 108,
			key_number: 4,
			status_category: "canceled",
			status_slot: "canceled",
		}),
		trackerRow({
			id: 109,
			key_number: 5,
			status_category: "mystery",
			status_slot: null,
		}),
	];
}

export function unknownCategoryRows(): {
	started: MyWorkTrackerRow;
	unknownTerminal: MyWorkTrackerRow;
	nullTerminal: MyWorkTrackerRow;
} {
	return {
		started: trackerRow({
			id: 110,
			key_number: 10,
			status_category: "started",
			status_slot: "in_progress",
		}),
		unknownTerminal: trackerRow({
			id: 111,
			key_number: 11,
			title: "Unknown terminal category",
			status_category: "mystery",
			status_slot: "done",
		}),
		nullTerminal: trackerRow({
			id: 112,
			key_number: 12,
			title: "Null category terminal slot",
			status_category: null,
			status_slot: "done",
		}),
	};
}

export function numericKeyRows(): {
	keyTwo: MyWorkTrackerRow;
	keyTen: MyWorkTrackerRow;
} {
	return {
		keyTwo: trackerRow({
			id: 302,
			workspace_id: ORBIT.id,
			key_number: 2,
			title: "Numeric key two",
			updated_at: NOW,
		}),
		keyTen: trackerRow({
			id: 310,
			workspace_id: ORBIT.id,
			key_number: 10,
			title: "Numeric key ten",
			updated_at: NOW,
		}),
	};
}
