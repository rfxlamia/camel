// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MyWorkItem } from "../../types/myWork";
import MyWorkRow from "./MyWorkRow";

function makeItem(source: "board" | "tracker"): MyWorkItem {
	const key = source === "board" ? "AT-17" : "OR-4";
	const item: MyWorkItem = {
		id: source === "board" ? 17 : 4,
		key,
		title: `A title that stays readable for the ${source} item`,
		description: "",
		source,
		status: {
			id: source === "board" ? 17 : 4,
			kind: "status",
			name: "In progress",
			position: 1,
			colour: "#4e759d",
			category: "started",
			slot: "in_progress",
		},
		priority: null,
		labels: [],
		assignees: [],
		version: 1,
		createdAt: "2026-09-11T00:00:00.000Z",
		updatedAt: "2026-09-11T00:00:00.000Z",
		workspace: {
			id: 7,
			name: "A workspace with a deliberately long display name",
			timezone: "UTC",
		},
		workspaceId: 7,
		workspaceName: "A workspace with a deliberately long display name",
		identity: { workspaceId: 7, source, key },
		statusCategory: "started",
		canMarkDone: true,
		markDoneReason: null,
		...(source === "board"
			? {
					columnName: "A board column with long metadata",
					dueDate: "2099-01-02",
				}
			: { endDate: "2099-01-04" }),
	};
	return item;
}

afterEach(() => cleanup());

describe("MyWorkRow", () => {
	it.each([
		["board", "AT-17", "Board", "A board column with long metadata", "Jan 2"],
		["tracker", "OR-4", "Tracker", "In progress", "Jan 4"],
	] as const)("keeps %s identity, metadata, due date, and action usable in compact layout", (source, key, sourceLabel, context, dueLabel) => {
		const onSelect = vi.fn();
		render(
			<ul>
				<MyWorkRow item={makeItem(source)} compact onSelect={onSelect} />
			</ul>,
		);

		const row = screen.getByTestId(`my-work-row-7-${source}-${key}`);
		expect(row.className).toContain("border-neutral-200");
		const action = within(row).getByRole("button", {
			name: new RegExp(`Open ${key}`),
		});
		expect(action.className).toContain("min-w-0");
		expect(within(row).getByText(key)).toBeTruthy();
		expect(within(row).getByText(/A title that stays readable/)).toBeTruthy();
		expect(within(row).getAllByText("In progress").length).toBeGreaterThan(0);
		expect(
			within(row).getByText(
				"A workspace with a deliberately long display name",
			),
		).toBeTruthy();
		expect(within(row).getByText(sourceLabel)).toBeTruthy();
		expect(within(row).getAllByText(context).length).toBeGreaterThan(0);
		expect(within(row).getByText(dueLabel)).toBeTruthy();

		fireEvent.click(action);
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key }));
	});
});
