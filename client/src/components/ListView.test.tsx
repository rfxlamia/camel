import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "../types";
import ListView from "./ListView";

const card = (id: number, overrides: Partial<Card> = {}): Card => ({
	id, columnId: 1, title: `Card ${id}`, description: "", position: id, version: 1,
	createdAt: "2026-08-01T00:00:00.000Z",
	startedAt: null, doneAt: null, dueDate: null, assignees: [], ...overrides,
});

const columns: Column[] = [
	{ id: 1, title: "To Do", position: 0, wipLimit: null, policy: "", isDone: false,
		isSignable: false, signableAssigneeId: null, color: null,
		cards: [card(1, { position: 1 }), card(2, { position: 2 })] },
	{ id: 2, title: "Done", position: 1, wipLimit: null, policy: "", isDone: true,
		isSignable: false, signableAssigneeId: null, color: null,
		cards: [card(3, { doneAt: "2026-08-01", dueDate: "2026-07-01" })] },
];

describe("ListView", () => {
	const renderListView = (
		props: Partial<React.ComponentProps<typeof ListView>> = {},
	) =>
		render(
			<ListView
				columns={columns}
				onOpenCard={vi.fn()}
				onColumnChange={vi.fn()}
				{...props}
			/>,
		);

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("groups cards under column headers in column order", () => {
		renderListView();
		const headers = screen.getAllByRole("heading", { level: 3 });
		expect(headers[0]!.textContent).toMatch(/To Do/);
		expect(headers[1]!.textContent).toMatch(/Done/);
	});

	it("orders cards by board position within each group", () => {
		const shuffled = [{
			...columns[0]!,
			cards: [card(2, { position: 2, title: "Second" }), card(1, { position: 1, title: "First" })],
		}];
		renderListView({ columns: shuffled });
		const titles = screen.getAllByRole("button").map((el) => el.textContent);
		expect(titles.indexOf("First")).toBeLessThan(titles.indexOf("Second"));
	});

	it("shows formatted keys in the ID column while keeping titles and long prefixes readable", () => {
		const cols = [
			{
				...columns[0]!,
				cards: [
					card(41, { key: "CA-41", title: "Keep list title", position: 1 }),
					card(987654321, {
						key: "CAMEL-TRACKER-123456789",
						title: "Long key title",
						position: 2,
					}),
				],
			},
		];
		renderListView({ columns: cols });

		expect(screen.getByText("CA-41")).toBeTruthy();
		expect(screen.getByText("Keep list title")).toBeTruthy();
		expect(screen.getByText("CAMEL-TRACKER-123456789")).toBeTruthy();
		expect(screen.getByText("Long key title")).toBeTruthy();
		expect(screen.queryByText("41", { exact: true })).toBeNull();
		expect(screen.queryByText("987654321", { exact: true })).toBeNull();
	});

	it("shows overdue styling via data-testid for overdue not-done card", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const cols = [{ ...columns[0]!, cards: [card(1, { dueDate: "2026-08-01", doneAt: null })] }];
		renderListView({ columns: cols });
		expect(screen.getByTestId("overdue-due-date")).toBeTruthy();
	});

	it("does not mark due date overdue when doneAt is set", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		renderListView({ columns: [columns[1]!] });
		expect(screen.queryByTestId("overdue-due-date")).toBeNull();
	});

	it("shows empty group headers when column has zero cards", () => {
		const empty = [{ ...columns[0]!, cards: [] }, { ...columns[1]!, cards: [] }];
		renderListView({ columns: empty });
		expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
	});

	it("shows brand empty state when zero columns", () => {
		render(
			<ListView
				columns={[]}
				onOpenCard={vi.fn()}
				onColumnChange={vi.fn()}
			/>,
		);
		expect(screen.getByText(/Nothing here yet/i)).toBeTruthy();
	});

	it("rows are not draggable — no dnd-kit sortable attributes", () => {
		renderListView();
		expect(document.querySelector("[data-sortable-id]")).toBeNull();
	});

	it("changes column from the status glyph without opening the card", () => {
		const onOpenCard = vi.fn();
		const onColumnChange = vi.fn();
		const cols: Column[] = [
			{
				...columns[0]!,
				cards: [card(1, { title: "Ship feature", position: 1 })],
			},
			{
				...columns[1]!,
				title: "In Progress",
				isDone: false,
				cards: [],
			},
		];
		render(
			<ListView
				columns={cols}
				onOpenCard={onOpenCard}
				onColumnChange={onColumnChange}
			/>,
		);
		fireEvent.click(screen.getByLabelText("To Do, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		expect(onColumnChange).toHaveBeenCalledWith(
			expect.objectContaining({ id: 1, title: "Ship feature" }),
			2,
		);
		expect(onOpenCard).not.toHaveBeenCalled();
	});

	it("expands a collapsed target group when a card moves there", () => {
		const onColumnChange = vi.fn();
		const cols: Column[] = [
			{
				...columns[0]!,
				cards: [card(1, { title: "Ship feature", position: 1 })],
			},
			{
				...columns[1]!,
				title: "In Progress",
				isDone: false,
				cards: [],
			},
		];
		render(
			<ListView
				columns={cols}
				onOpenCard={vi.fn()}
				onColumnChange={onColumnChange}
			/>,
		);
		const inProgressHeader = screen.getByRole("button", {
			name: /In Progress/i,
		});
		fireEvent.click(inProgressHeader);
		expect(inProgressHeader.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(screen.getByLabelText("To Do, Ship feature"));
		fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));

		expect(onColumnChange).toHaveBeenCalled();
		expect(inProgressHeader.getAttribute("aria-expanded")).toBe("true");
	});
});
