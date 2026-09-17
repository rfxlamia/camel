import { describe, expect, it, vi, afterEach } from "vitest";
import {
	assigneeInitials,
	formatDueDate,
	isCardDone,
	isDueOverdue,
	todayISODate,
} from "./boardViewUtils";
import type { Card } from "../types";

function card(partial: Partial<Card> = {}): Card {
	return {
		id: 1,
		columnId: 1,
		title: "T",
		description: "",
		position: 0,
		version: 1,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		startedAt: null,
		doneAt: null,
		dueDate: null,
		assignees: [],
		...partial,
	};
}

describe("boardViewUtils", () => {
	afterEach(() => vi.useRealTimers());

	it("isCardDone uses doneAt only", () => {
		expect(isCardDone(card({ doneAt: "2026-08-01T00:00:00Z" }))).toBe(true);
		expect(isCardDone(card({ doneAt: null }))).toBe(false);
	});

	it("isDueOverdue is false when done even if past due", () => {
		vi.setSystemTime(new Date("2026-08-03T12:00:00"));
		expect(
			isDueOverdue(
				card({ dueDate: "2026-08-01", doneAt: "2026-08-02T00:00:00Z" }),
			),
		).toBe(false);
	});

	it("isDueOverdue is true when not done and past due", () => {
		vi.setSystemTime(new Date("2026-08-03T12:00:00"));
		expect(isDueOverdue(card({ dueDate: "2026-08-01", doneAt: null }))).toBe(
			true,
		);
	});

	it("todayISODate returns local YYYY-MM-DD", () => {
		vi.setSystemTime(new Date("2026-08-03T12:00:00"));
		expect(todayISODate()).toBe("2026-08-03");
	});

	it("formatDueDate renders month and day without timezone shift", () => {
		expect(formatDueDate("2026-06-21")).toBe("Jun 21");
	});

	it("assigneeInitials derives avatar initials", () => {
		expect(assigneeInitials("Jane Doe")).toBe("JD");
		expect(assigneeInitials("cher")).toBe("CH");
	});
});
