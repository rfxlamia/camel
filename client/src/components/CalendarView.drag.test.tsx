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

function makeCard(overrides: Partial<Card> = {}): Card {
	return {
		id: 42,
		columnId: 1,
		title: "Deploy fix",
		description: "",
		position: 1024,
		version: 3,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		startedAt: null,
		doneAt: null,
		dueDate: "2026-08-15",
		assignees: [],
		...overrides,
	};
}

const cols: Column[] = [
	{
		id: 1,
		title: "Todo",
		position: 0,
		wipLimit: null,
		policy: "",
		isDone: false,
		isSignable: false,
		signableAssigneeId: null,
		color: null,
		cards: [makeCard()],
	},
];

function renderCalendarDrag(saveCard = vi.fn().mockResolvedValue("saved")) {
	return render(
		<MemoryRouter>
			<CalendarView columns={cols} onOpenCard={vi.fn()} saveCard={saveCard} />
		</MemoryRouter>,
	);
}

describe("CalendarView drag reschedule", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it("calls saveCard with dueDate and version on drop to new date", async () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn().mockResolvedValue("saved");
		renderCalendarDrag(saveCard);
		await fireDragEnd("calendar-card-42", "date-2026-08-20");
		await waitFor(() =>
			expect(saveCard).toHaveBeenCalledWith(42, {
				dueDate: "2026-08-20",
				version: 3,
			}),
		);
	});

	it("allows drop on past date", async () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn().mockResolvedValue("saved");
		renderCalendarDrag(saveCard);
		await fireDragEnd("calendar-card-42", "date-2026-08-01");
		await waitFor(() =>
			expect(saveCard).toHaveBeenCalledWith(42, {
				dueDate: "2026-08-01",
				version: 3,
			}),
		);
	});

	it("allows drop on spillover September cell in August grid", async () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn().mockResolvedValue("saved");
		renderCalendarDrag(saveCard);
		await fireDragEnd("calendar-card-42", "date-2026-09-01");
		await waitFor(() =>
			expect(saveCard).toHaveBeenCalledWith(42, {
				dueDate: "2026-09-01",
				version: 3,
			}),
		);
		expect(screen.getByText(/August 2026/i)).toBeTruthy();
	});

	it("shows inline conflict notice for 3s on version conflict", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn().mockResolvedValue("conflict");
		renderCalendarDrag(saveCard);
		await fireDragEnd("calendar-card-42", "date-2026-08-20");
		await waitFor(() =>
			expect(screen.getByText(/Updated elsewhere/i)).toBeTruthy(),
		);
		await act(async () => {
			vi.advanceTimersByTime(3000);
		});
		expect(screen.queryByText(/Updated elsewhere/i)).toBeNull();
	});

	it("does not PATCH when dropped on same date (no-op)", async () => {
		vi.setSystemTime(new Date("2026-08-03"));
		const saveCard = vi.fn();
		renderCalendarDrag(saveCard);
		await fireDragEnd("calendar-card-42", "date-2026-08-15");
		expect(saveCard).not.toHaveBeenCalled();
	});
});
