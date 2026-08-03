import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "../types";
import CalendarView from "./CalendarView";

const navigate = vi.fn();
vi.mock("react-router", async () => {
	const actual = await vi.importActual("react-router");
	return { ...actual, useNavigate: () => navigate };
});

function makeCard(overrides: Partial<Card> = {}): Card {
	return {
		id: 1,
		columnId: 1,
		title: "Deploy fix",
		description: "",
		position: 1024,
		version: 3,
		createdAt: "2026-08-01T00:00:00.000Z",
		startedAt: null,
		doneAt: null,
		dueDate: "2026-08-15",
		assignees: [],
		...overrides,
	};
}

function todoColumn(cards: Card[]): Column {
	return {
		id: 1,
		title: "Todo",
		position: 0,
		wipLimit: null,
		policy: "",
		isDone: false,
		isSignable: false,
		signableAssigneeId: null,
		color: null,
		cards,
	};
}

const cols: Column[] = [
	todoColumn([
		makeCard({ id: 42, title: "Deploy fix", dueDate: "2026-08-15", version: 3 }),
		makeCard({ id: 10, title: "Overdue task", dueDate: "2026-08-01", doneAt: null }),
		makeCard({ id: 20, title: "Solo card", dueDate: "2026-08-20", version: 1 }),
		makeCard({ id: 21, title: "Alpha", dueDate: "2026-08-25", version: 1 }),
		makeCard({ id: 22, title: "Beta", dueDate: "2026-08-25", version: 1 }),
	]),
];

function renderCalendar(columns: Column[] = cols) {
	return render(
		<MemoryRouter>
			<CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={vi.fn()} />
		</MemoryRouter>,
	);
}

describe("CalendarView display", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it("defaults to current month with prev/next/Today navigation", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		renderCalendar();
		expect(screen.getByText(/August 2026/i)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /next/i }));
		expect(screen.getByText(/September 2026/i)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /today/i }));
		expect(screen.getByText(/August 2026/i)).toBeTruthy();
	});

	it("renders card on its due date cell", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		renderCalendar();
		const aug15 = screen.getByTestId("date-cell-2026-08-15");
		expect(aug15.textContent).toMatch(/Deploy fix/);
	});

	it("shows red overdue indicator on date cell for overdue not-done card", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		renderCalendar();
		const aug1 = screen.getByTestId("date-cell-2026-08-01");
		expect(aug1.querySelector('[data-testid="overdue-indicator"]')).toBeTruthy();
	});

	it("opens modal when multiple cards share a date", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		renderCalendar();
		fireEvent.click(screen.getByTestId("date-cell-2026-08-25"));
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByText("Alpha")).toBeTruthy();
		expect(screen.getByText("Beta")).toBeTruthy();
	});

	it("opens modal listing all 6 cards when six share a date", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const sixOnOneDay = [
			todoColumn(
				Array.from({ length: 6 }, (_, i) =>
					makeCard({
						id: 100 + i,
						title: `Task ${i + 1}`,
						dueDate: "2026-08-20",
						version: 1,
					}),
				),
			),
		];
		renderCalendar(sixOnOneDay);
		fireEvent.click(screen.getByTestId("date-cell-2026-08-20"));
		expect(screen.getByRole("dialog")).toBeTruthy();
		for (let i = 1; i <= 6; i++) {
			expect(screen.getByText(`Task ${i}`)).toBeTruthy();
		}
	});

	it("shows +N more overflow when more than two cards on a date", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const overflowCols = [
			todoColumn([
				makeCard({ id: 1, title: "One", dueDate: "2026-08-10" }),
				makeCard({ id: 2, title: "Two", dueDate: "2026-08-10" }),
				makeCard({ id: 3, title: "Three", dueDate: "2026-08-10" }),
			]),
		];
		renderCalendar(overflowCols);
		const cell = screen.getByTestId("date-cell-2026-08-10");
		expect(cell.textContent).toMatch(/\+1 more/);
	});

	it("navigates to card detail when single card on date", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		renderCalendar();
		fireEvent.click(screen.getByTestId("date-cell-2026-08-20"));
		expect(navigate).toHaveBeenCalledWith("/board/card/20");
	});

	it("does not show overdue indicator when card is done", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const doneCols: Column[] = [
			{
				...cols[0]!,
				cards: [
					makeCard({
						id: 30,
						title: "Shipped",
						dueDate: "2026-08-01",
						doneAt: "2026-08-02T00:00:00Z",
					}),
				],
			},
		];
		renderCalendar(doneCols);
		const aug1 = screen.getByTestId("date-cell-2026-08-01");
		expect(aug1.querySelector('[data-testid="overdue-indicator"]')).toBeNull();
	});
});
