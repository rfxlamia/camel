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

function makeItem(
	source: "board" | "tracker",
	overrides: Partial<MyWorkItem> = {},
): MyWorkItem {
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
		...overrides,
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
		const keyElement = within(row).getByText(key);
		const titleElement = within(row).getByText(/A title that stays readable/);
		const doneAction = within(row).getByRole("button", {
			name: "Mark done",
		});
		expect(action.className).toContain("min-w-0");
		expect(action.className).toContain("active:bg-primary-100/55");
		expect(action.className).not.toContain("active:scale");
		expect(titleElement.compareDocumentPosition(keyElement)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(
			screen.queryByTestId(`my-work-status-7-${source}-${key}`),
		).toBeNull();
		expect(doneAction.className).toContain("motion-safe:active:scale-[0.97]");
		if (source === "tracker") {
			expect(within(row).getAllByText("In progress").length).toBeGreaterThan(0);
		}
		expect(
			within(row).getByText(
				"A workspace with a deliberately long display name",
			),
		).toBeTruthy();
		const sourceEl = within(row).getByText(sourceLabel);
		expect(sourceEl).toBeTruthy();
		expect(sourceEl.className).not.toContain("bg-primary-100");
		expect(sourceEl.className).not.toContain("rounded-md");
		expect(sourceEl.className).not.toContain("px-1.5");
		expect(within(row).queryByText("A", { exact: true })).toBeNull();
		expect(within(row).getAllByText("·")).toHaveLength(2);
		expect(within(row).getAllByText(context).length).toBeGreaterThan(0);
		expect(within(row).getByText(dueLabel)).toBeTruthy();

		fireEvent.click(action);
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key }));
	});

	it("omits due chrome when the board item has no due date", () => {
		render(
			<ul>
				<MyWorkRow item={makeItem("board", { dueDate: null })} />
			</ul>,
		);

		const row = screen.getByTestId("my-work-row-7-board-AT-17");
		expect(within(row).queryByText("No due date")).toBeNull();
		expect(within(row).queryByLabelText(/^Due /)).toBeNull();
		expect(row.querySelector(".lucide-calendar-days")).toBeNull();
		expect(within(row).getByText("Open")).toBeTruthy();
	});

	it("collapses the action gutter when the item is already terminal", () => {
		render(
			<ul>
				<MyWorkRow
					item={makeItem("board", {
						canMarkDone: false,
						markDoneReason: "terminal",
						statusCategory: "completed",
						status: {
							id: 17,
							kind: "status",
							name: "Done",
							position: 1,
							colour: "#49814c",
							category: "completed",
							slot: "done",
						},
					})}
				/>
			</ul>,
		);

		const row = screen.getByTestId("my-work-row-7-board-AT-17");
		const gutter = row.querySelector("[data-testid='my-work-done-gutter']");
		expect(
			within(row).queryByRole("button", { name: /mark done/i }),
		).toBeNull();
		expect(gutter).toBeTruthy();
		expect(gutter?.className).toContain("[&:not(:has(*))]:hidden");
		expect(gutter?.childElementCount).toBe(0);
	});

	it("keeps a custom status badge when it differs from the group label", () => {
		const item = makeItem("board");
		item.status = { ...item.status, name: "Requested" };
		render(
			<ul>
				<MyWorkRow item={item} compact />
			</ul>,
		);

		const status = screen.getByTestId("my-work-status-7-board-AT-17");
		expect(status.textContent).toBe("Requested");
		expect(status.className).not.toContain("uppercase");
	});
});
