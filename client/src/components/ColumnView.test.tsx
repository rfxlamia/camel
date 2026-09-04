// client/src/components/ColumnView.test.tsx — jsdom; no jest-dom (see TemplatePicker.test.tsx)
import {
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dnd-kit/core", () => ({
	useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));
vi.mock("@dnd-kit/sortable", () => ({
	SortableContext: ({ children }: { children: React.ReactNode }) => children,
	verticalListSortingStrategy: {},
}));
vi.mock("../context/BoardContext", () => ({
	useBoard: () => ({ activeWorkspaceId: null }),
}));
const {
	mockGetWorkspaceMembers,
	mockListTrackerVocabularies,
	mockListTrackerProjects,
} = vi.hoisted(() => ({
	mockGetWorkspaceMembers: vi.fn(),
	mockListTrackerVocabularies: vi.fn(),
	mockListTrackerProjects: vi.fn(),
}));

vi.mock("../api", () => ({
	api: {
		getWorkspaceMembers: (...args: unknown[]) =>
			mockGetWorkspaceMembers(...args),
		listTrackerVocabularies: (...args: unknown[]) =>
			mockListTrackerVocabularies(...args),
		listTrackerProjects: (...args: unknown[]) =>
			mockListTrackerProjects(...args),
	},
}));
vi.mock("./CardView", () => ({ default: () => null }));

const SWATCHES = [
	"oklch(88% 0.09 47.3)",
	"oklch(90% 0.08 120)",
	"oklch(89% 0.07 200)",
	"oklch(87% 0.09 280)",
	"oklch(91% 0.06 40)",
];

vi.mock("../lib/columnColorUtils", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../lib/columnColorUtils")>();
	return {
		...actual,
		generateSwatchCandidates: vi.fn(() => [...SWATCHES]),
		deriveBackgroundColor: vi.fn((c: string) => c),
		isStoredOklchColor: vi.fn((c: string) => c.startsWith("oklch(")),
	};
});

import { generateSwatchCandidates } from "../lib/columnColorUtils";
import type { Column, TrackerProject, TrackerVocabulary, WorkspaceMember } from "../types";
import ColumnView from "./ColumnView";
import { TaskMetadataCatalogProvider } from "./task-entry/TaskMetadataCatalogProvider";

const members: WorkspaceMember[] = [
	{ userId: 1, username: "rafi", displayName: "Rafi", role: "member" },
];
const priorities: TrackerVocabulary[] = [
	{ id: 10, kind: "priority", name: "High", position: 1, colour: "#f00" },
];
const labels: TrackerVocabulary[] = [
	{ id: 20, kind: "label", name: "Bug", position: 1, colour: "#00f" },
];
const projects: TrackerProject[] = [
	{
		id: 1,
		name: "Web",
		startDate: null,
		endDate: null,
		position: 1,
		version: 1,
		phases: [],
	},
];

function mockReadyCatalogs() {
	mockGetWorkspaceMembers.mockResolvedValue({ members });
	mockListTrackerVocabularies.mockImplementation(
		(_workspaceId: number, kind: string) => {
			if (kind === "priority") return Promise.resolve(priorities);
			if (kind === "label") return Promise.resolve(labels);
			return Promise.resolve([]);
		},
	);
	mockListTrackerProjects.mockResolvedValue(projects);
}

function findOverflowHiddenAncestor(element: Element): Element | null {
	let node: Element | null = element.parentElement;
	while (node) {
		if (node.classList.contains("overflow-hidden")) return node;
		node = node.parentElement;
	}
	return null;
}

function renderColumn(column = makeColumn()) {
	return render(
		<TaskMetadataCatalogProvider workspaceId={7}>
			<ColumnView
				column={column}
				onOpenCard={vi.fn()}
				onAddCard={vi.fn().mockResolvedValue(undefined)}
				onUpdateColumn={vi.fn().mockResolvedValue(undefined)}
			/>
		</TaskMetadataCatalogProvider>,
	);
}

function makeColumn(overrides: Partial<Column> = {}): Column {
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
		cards: [],
		...overrides,
	};
}

function openSettings(
	column: Column,
	onUpdate = vi.fn().mockResolvedValue(undefined),
) {
	render(
		<TaskMetadataCatalogProvider workspaceId={7}>
			<ColumnView
				column={column}
				onOpenCard={vi.fn()}
				onAddCard={vi.fn().mockResolvedValue(undefined)}
				onUpdateColumn={onUpdate}
			/>
		</TaskMetadataCatalogProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: /edit todo column/i }));
	return { onUpdate };
}

afterEach(cleanup);

beforeEach(() => {
	mockReadyCatalogs();
});

describe("Add card @ command popover", () => {
	it("renders the field menu outside the column overflow-hidden boundary", async () => {
		renderColumn();

		fireEvent.click(screen.getByRole("button", { name: /add card/i }));
		const textarea = await screen.findByRole("combobox", { name: "Task title" });
		fireEvent.change(textarea, { target: { value: "buat laporan " } });
		fireEvent.keyDown(textarea, { key: "@" });

		const listbox = await screen.findByRole("listbox", { name: "Task fields" });
		expect(findOverflowHiddenAncestor(listbox)).toBeNull();
		expect(screen.getByRole("option", { name: /Assignee/i })).toBeTruthy();
		expect(screen.getByRole("option", { name: /Priority/i })).toBeTruthy();
	});
});

describe("ColumnSettings color shuffle", () => {
	it("shows 5 swatches with none selected when column has no color", () => {
		openSettings(makeColumn({ color: null }));
		const swatches = screen.getAllByRole("button", {
			name: /^Color swatch \d$/i,
		});
		expect(swatches).toHaveLength(5);
		for (const btn of swatches) {
			expect(btn.getAttribute("aria-pressed")).toBe("false");
		}
	});

	it("calls generateSwatchCandidates with current selection on shuffle", () => {
		openSettings(makeColumn({ color: null }));
		fireEvent.click(screen.getByRole("button", { name: /^Color swatch 1$/i }));
		fireEvent.click(screen.getByRole("button", { name: /shuffle colors/i }));
		expect(generateSwatchCandidates).toHaveBeenLastCalledWith(SWATCHES[0]);
	});

	it("toggles selected swatch off to null", () => {
		openSettings(makeColumn({ color: null }));
		const first = screen.getByRole("button", { name: /^Color swatch 1$/i });
		fireEvent.click(first);
		fireEvent.click(first);
		for (const btn of screen.getAllByRole("button", {
			name: /^Color swatch \d$/i,
		})) {
			expect(btn.getAttribute("aria-pressed")).toBe("false");
		}
	});

	it("persists OKLCH only on Save", async () => {
		const { onUpdate } = openSettings(makeColumn({ color: null }));
		fireEvent.click(screen.getByRole("button", { name: /^Color swatch 1$/i }));
		fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
		expect(onUpdate).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ color: SWATCHES[0] }),
		);
	});
});

describe("ColumnSettings isDone tip", () => {
	it("shows a copy-only tip when clearing a Done column", () => {
		const { onUpdate } = openSettings(makeColumn({ isDone: true }));
		fireEvent.click(screen.getByRole("checkbox", { name: /mark as done/i }));

		expect(
			screen.getByText(
				/Clearing the last Done column is allowed; saving remains available/i,
			),
		).toBeTruthy();
		expect(onUpdate).not.toHaveBeenCalled();
	});
});

describe("ColumnSettings saved color and clear", () => {
	const SAVED = "oklch(88% 0.09 47.3)";

	it("highlights saved OKLCH when settings reopen", () => {
		vi.mocked(generateSwatchCandidates).mockReturnValueOnce([
			SAVED,
			...SWATCHES.slice(1),
		]);
		openSettings(makeColumn({ color: SAVED }));
		const selected = screen.getByRole("button", { name: /^Color swatch 1$/i });
		expect(selected.getAttribute("aria-pressed")).toBe("true");
	});

	it("highlights saved legacy name when settings reopen", () => {
		vi.mocked(generateSwatchCandidates).mockReturnValueOnce([
			"powder-blue",
			...SWATCHES.slice(1),
		]);
		openSettings(makeColumn({ color: "powder-blue" }));
		const selected = screen.getByRole("button", { name: /^Color swatch 1$/i });
		expect(selected.getAttribute("aria-pressed")).toBe("true");
	});

	it("pins just-picked color (not original saved) on re-shuffle", () => {
		const PICKED = "oklch(90% 0.08 120)";
		openSettings(makeColumn({ color: SAVED }));
		fireEvent.click(screen.getByRole("button", { name: /^Color swatch 2$/i }));
		fireEvent.click(screen.getByRole("button", { name: /shuffle colors/i }));
		expect(generateSwatchCandidates).toHaveBeenLastCalledWith(PICKED);
	});

	it("clears color via X button then Save persists null", async () => {
		const { onUpdate } = openSettings(makeColumn({ color: SAVED }));
		fireEvent.click(screen.getByRole("button", { name: /remove color/i }));
		fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
		expect(onUpdate).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ color: null }),
		);
	});
});
