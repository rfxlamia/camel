import {
	act,
	cleanup,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "../types";
import CalendarView from "./CalendarView";
import UnscheduledTray from "./UnscheduledTray";

const { fireDragEnd, captureOnDragEnd } = vi.hoisted(() => {
	let onDragEnd: ((event: DragEndEvent) => void) | undefined;
	return {
		captureOnDragEnd: (handler: (event: DragEndEvent) => void) => {
			onDragEnd = handler;
		},
		fireDragEnd: async (activeId: string, overId: string | null) => {
			await act(async () => {
				const result = onDragEnd?.({
					active: {
						id: activeId,
						data: { current: {} },
						rect: { current: { initial: null, translated: null } },
					},
					over: overId
						? {
								id: overId,
								data: { current: {} },
								rect: {
									width: 0,
									height: 0,
									top: 0,
									left: 0,
									right: 0,
									bottom: 0,
								},
							}
						: null,
					delta: { x: 0, y: 0 },
					collisions: null,
					activatorEvent: null,
				} as unknown as DragEndEvent);
				await Promise.resolve(result);
			});
		},
	};
});

vi.mock("@dnd-kit/core", () => ({
	DndContext: ({
		children,
		onDragEnd,
	}: {
		children: ReactNode;
		onDragEnd: (event: DragEndEvent) => void;
	}) => {
		captureOnDragEnd(onDragEnd);
		return <div data-testid="dnd-context">{children}</div>;
	},
	useDraggable: ({ id }: { id: string }) => ({
		attributes: { "data-draggable-id": id },
		listeners: {},
		setNodeRef: vi.fn(),
		transform: null,
		isDragging: false,
	}),
	useDroppable: () => ({
		setNodeRef: vi.fn(),
		isOver: false,
	}),
	DragOverlay: () => null,
	PointerSensor: vi.fn(),
	useSensor: vi.fn(),
	useSensors: vi.fn(() => []),
}));
vi.mock("@dnd-kit/sortable", () => ({
	SortableContext: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("react-router", async () => {
	const actual = await vi.importActual("react-router");
	return { ...actual, useNavigate: () => vi.fn() };
});

const makeCard = (overrides: Partial<Card> = {}): Card => ({
	id: 1,
	columnId: 1,
	title: "Untitled",
	description: "",
	position: 0,
	version: 1,
	createdAt: "2026-08-01T00:00:00.000Z",
	startedAt: null,
	doneAt: null,
	dueDate: null,
	assignees: [],
	...overrides,
});

const todoColumn = (cards: Card[]): Column => ({
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
});

describe("UnscheduledTray display", () => {
	afterEach(cleanup);

	it("shows cards with due_date=null and doneAt=null", () => {
		const columns = [todoColumn([makeCard({ id: 1, title: "No date" })])];
		render(
			<UnscheduledTray columns={columns} saveCard={vi.fn()} onConflict={vi.fn()} />,
		);
		expect(screen.getByText("No date")).toBeTruthy();
	});

	it("excludes Done cards with no due date", () => {
		const columns = [todoColumn([makeCard({ doneAt: "2026-08-01T00:00:00Z" })])];
		render(
			<UnscheduledTray columns={columns} saveCard={vi.fn()} onConflict={vi.fn()} />,
		);
		expect(screen.queryByText("Untitled")).toBeNull();
	});

	it("shows empty tray message when no unscheduled cards", () => {
		const columns = [todoColumn([makeCard({ dueDate: "2026-08-15" })])];
		render(
			<UnscheduledTray columns={columns} saveCard={vi.fn()} onConflict={vi.fn()} />,
		);
		expect(screen.getByText(/no unscheduled/i)).toBeTruthy();
	});
});

describe("Unscheduled tray drag via CalendarView", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it("schedules card when dragged from tray to date", async () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn().mockResolvedValue("saved");
		const columns = [todoColumn([makeCard({ id: 1, title: "No date", version: 1 })])];
		render(
			<MemoryRouter>
				<CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
			</MemoryRouter>,
		);
		await fireDragEnd("tray-card-1", "date-2026-08-25");
		await waitFor(() =>
			expect(saveCard).toHaveBeenCalledWith(1, { dueDate: "2026-08-25", version: 1 }),
		);
	});

	it("clears due date when dragged from date to tray", async () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn().mockResolvedValue("saved");
		const columns = [todoColumn([
			makeCard({ id: 2, title: "Scheduled", dueDate: "2026-08-20", version: 5 }),
		])];
		render(
			<MemoryRouter>
				<CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
			</MemoryRouter>,
		);
		await fireDragEnd("calendar-card-2", "unscheduled-tray");
		await waitFor(() =>
			expect(saveCard).toHaveBeenCalledWith(2, { dueDate: null, version: 5 }),
		);
	});

	it("Done card dragged to tray clears due date and disappears from tray", async () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn().mockResolvedValue("saved");
		const doneCard = makeCard({
			id: 99,
			title: "Shipped",
			dueDate: "2026-08-15",
			doneAt: "2026-08-02T00:00:00Z",
			version: 2,
		});
		const columns = [todoColumn([doneCard])];
		const { rerender } = render(
			<MemoryRouter>
				<CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
			</MemoryRouter>,
		);
		await fireDragEnd("calendar-card-99", "unscheduled-tray");
		expect(saveCard).toHaveBeenCalledWith(99, { dueDate: null, version: 2 });
		rerender(
			<MemoryRouter>
				<CalendarView
					columns={[todoColumn([{ ...doneCard, dueDate: null }])]}
					onOpenCard={vi.fn()}
					saveCard={saveCard}
				/>
			</MemoryRouter>,
		);
		expect(screen.queryByText("Shipped")).toBeNull();
	});

	it("honors version conflict with inline notice", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn().mockResolvedValue("conflict");
		const columns = [todoColumn([makeCard({ id: 1, title: "No date", version: 2 })])];
		render(
			<MemoryRouter>
				<CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
			</MemoryRouter>,
		);
		await fireDragEnd("tray-card-1", "date-2026-08-25");
		await waitFor(() => expect(screen.getByText(/Updated elsewhere/i)).toBeTruthy());
	});

	it("no-op when tray card dropped back on tray", async () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn();
		const columns = [todoColumn([makeCard({ id: 1, title: "No date" })])];
		render(
			<MemoryRouter>
				<CalendarView columns={columns} onOpenCard={vi.fn()} saveCard={saveCard} />
			</MemoryRouter>,
		);
		await fireDragEnd("tray-card-1", "unscheduled-tray");
		expect(saveCard).not.toHaveBeenCalled();
	});
});
