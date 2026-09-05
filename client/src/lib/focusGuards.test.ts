import { describe, expect, it } from "vitest";
import type { FocusSession } from "../types";
import {
	deletionEventTargetsFocusedTask,
	isActiveFocusSession,
	membershipRemovalTargetsUser,
} from "./focusGuards";

function makeBoardSession(
	overrides: Partial<FocusSession> = {},
): FocusSession {
	return {
		id: 1,
		state: "running",
		accumulatedSeconds: 600,
		runningSince: "2026-09-04T10:00:00.000Z",
		version: 2,
		source: "board",
		taskId: 481,
		taskKey: "CA-42",
		returnPath: "/board/card/481",
		finishedAt: null,
		...overrides,
	};
}

function makeTrackerSession(
	overrides: Partial<FocusSession> = {},
): FocusSession {
	return {
		id: 2,
		state: "running",
		accumulatedSeconds: 300,
		runningSince: "2026-09-04T10:00:00.000Z",
		version: 1,
		source: "tracker",
		taskId: 77,
		taskKey: "CAM-77",
		returnPath: "/tracker/CAM-77",
		finishedAt: null,
		...overrides,
	};
}

describe("isActiveFocusSession", () => {
	it("returns false for null session", () => {
		expect(isActiveFocusSession(null)).toBe(false);
	});

	it("returns false for finished session", () => {
		expect(
			isActiveFocusSession(makeBoardSession({ state: "finished" })),
		).toBe(false);
	});

	it("returns true for running session", () => {
		expect(isActiveFocusSession(makeBoardSession())).toBe(true);
	});

	it("returns true for paused session", () => {
		expect(
			isActiveFocusSession(makeBoardSession({ state: "paused" })),
		).toBe(true);
	});
});

describe("deletionEventTargetsFocusedTask", () => {
	it("matches card.deleted for board session with same cardId", () => {
		const session = makeBoardSession();
		expect(
			deletionEventTargetsFocusedTask(session, {
				type: "card.deleted",
				cardId: 481,
			}),
		).toBe(true);
	});

	it("rejects card.deleted when cardId differs", () => {
		const session = makeBoardSession();
		expect(
			deletionEventTargetsFocusedTask(session, {
				type: "card.deleted",
				cardId: 482,
			}),
		).toBe(false);
	});

	it("rejects card.deleted for tracker session even with colliding id", () => {
		const session = makeTrackerSession({ taskId: 481 });
		expect(
			deletionEventTargetsFocusedTask(session, {
				type: "card.deleted",
				cardId: 481,
			}),
		).toBe(false);
	});

	it("matches tracker.deleted for tracker session with same trackerItemId", () => {
		const session = makeTrackerSession();
		expect(
			deletionEventTargetsFocusedTask(session, {
				type: "tracker.deleted",
				trackerItemId: 77,
			}),
		).toBe(true);
	});

	it("rejects tracker.deleted when trackerItemId differs", () => {
		const session = makeTrackerSession();
		expect(
			deletionEventTargetsFocusedTask(session, {
				type: "tracker.deleted",
				trackerItemId: 99,
			}),
		).toBe(false);
	});

	it("rejects tracker.deleted for board session even with colliding id", () => {
		const session = makeBoardSession();
		expect(
			deletionEventTargetsFocusedTask(session, {
				type: "tracker.deleted",
				trackerItemId: 481,
			}),
		).toBe(false);
	});

	it("rejects tracker.deleted when trackerItemId is undefined", () => {
		const session = makeTrackerSession();
		expect(
			deletionEventTargetsFocusedTask(session, {
				type: "tracker.deleted",
			}),
		).toBe(false);
	});

	it("ignores card.updated events", () => {
		const session = makeBoardSession();
		expect(
			deletionEventTargetsFocusedTask(session, {
				type: "card.updated",
				cardId: 481,
			}),
		).toBe(false);
	});

	it("ignores tracker.updated events", () => {
		const session = makeTrackerSession();
		expect(
			deletionEventTargetsFocusedTask(session, {
				type: "tracker.updated",
				trackerItemId: 77,
			}),
		).toBe(false);
	});
});

describe("membershipRemovalTargetsUser", () => {
	const event = { userId: 7, workspaceId: 3 };

	it("matches when user and workspace align", () => {
		expect(membershipRemovalTargetsUser(event, 7, 3)).toBe(true);
	});

	it("rejects different userId", () => {
		expect(membershipRemovalTargetsUser(event, 9, 3)).toBe(false);
	});

	it("rejects different workspaceId", () => {
		expect(membershipRemovalTargetsUser(event, 7, 5)).toBe(false);
	});
});
