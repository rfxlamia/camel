// client/src/components/ColumnView.test.tsx — jsdom; no jest-dom (see TemplatePicker.test.tsx)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../api", () => ({
	api: { getWorkspaceMembers: vi.fn().mockResolvedValue({ members: [] }) },
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
	const actual = await importOriginal<typeof import("../lib/columnColorUtils")>();
	return {
		...actual,
		generateSwatchCandidates: vi.fn(() => [...SWATCHES]),
		deriveBackgroundColor: vi.fn((c: string) => c),
		isStoredOklchColor: vi.fn((c: string) => c.startsWith("oklch(")),
	};
});

import { generateSwatchCandidates } from "../lib/columnColorUtils";
import ColumnView from "./ColumnView";
import type { Column } from "../types";

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

function openSettings(column: Column, onUpdate = vi.fn().mockResolvedValue(undefined)) {
	render(
		<ColumnView
			column={column}
			onOpenCard={vi.fn()}
			onAddCard={vi.fn().mockResolvedValue(undefined)}
			onUpdateColumn={onUpdate}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: /edit todo column/i }));
	return { onUpdate };
}

afterEach(cleanup);

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
