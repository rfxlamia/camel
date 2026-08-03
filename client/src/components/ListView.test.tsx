import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ListView from "./ListView";
import type { Column, Card } from "../types";

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
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("groups cards under column headers in column order", () => {
		render(<ListView columns={columns} onOpenCard={vi.fn()} />);
		const headers = screen.getAllByRole("heading", { level: 3 });
		expect(headers[0]!.textContent).toMatch(/To Do/);
		expect(headers[1]!.textContent).toMatch(/Done/);
	});

	it("orders cards by board position within each group", () => {
		const shuffled = [{
			...columns[0]!,
			cards: [card(2, { position: 2, title: "Second" }), card(1, { position: 1, title: "First" })],
		}];
		render(<ListView columns={shuffled} onOpenCard={vi.fn()} />);
		const titles = screen.getAllByRole("button").map((el) => el.textContent);
		expect(titles.indexOf("First")).toBeLessThan(titles.indexOf("Second"));
	});

	it("shows overdue styling via data-testid for overdue not-done card", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const cols = [{ ...columns[0]!, cards: [card(1, { dueDate: "2026-08-01", doneAt: null })] }];
		render(<ListView columns={cols} onOpenCard={vi.fn()} />);
		expect(screen.getByTestId("overdue-due-date")).toBeTruthy();
	});

	it("does not mark due date overdue when doneAt is set", () => {
		vi.setSystemTime(new Date("2026-08-03"));
		render(<ListView columns={[columns[1]!]} onOpenCard={vi.fn()} />);
		expect(screen.queryByTestId("overdue-due-date")).toBeNull();
	});

	it("shows empty group headers when column has zero cards", () => {
		const empty = [{ ...columns[0]!, cards: [] }, { ...columns[1]!, cards: [] }];
		render(<ListView columns={empty} onOpenCard={vi.fn()} />);
		expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
	});

	it("shows brand empty state when zero columns", () => {
		render(<ListView columns={[]} onOpenCard={vi.fn()} />);
		expect(screen.getByText(/Nothing here yet/i)).toBeTruthy();
	});

	it("rows are not draggable — no dnd-kit sortable attributes", () => {
		render(<ListView columns={columns} onOpenCard={vi.fn()} />);
		expect(document.querySelector("[data-sortable-id]")).toBeNull();
	});
});
