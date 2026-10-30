import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Column } from "../../types";

vi.mock("../../api", () => ({
	api: {
		getWorkspaceMembers: vi.fn().mockResolvedValue({ members: [] }),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
}));

vi.mock("../../shared/WorkspaceContext", () => ({
	useWorkspace: () => ({ activeWorkspaceId: 7 }),
}));

import ColumnSettings from "./ColumnSettings";

const column: Column = {
	id: 12,
	title: "In progress",
	policy: "",
	isDone: false,
	isSignable: false,
	signableAssigneeId: null,
	wipLimit: null,
	color: null,
	cards: [],
} as unknown as Column;

const onUpdateColumn = vi.fn().mockResolvedValue(undefined);
const onDeleteColumn = vi.fn().mockResolvedValue(undefined);
const onClose = vi.fn().mockResolvedValue(undefined);

function renderSettings() {
	render(
		<ColumnSettings
			column={column}
			onUpdateColumn={onUpdateColumn}
			onDeleteColumn={onDeleteColumn}
			onClose={onClose}
		/>,
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ColumnSettings delete flow", () => {
	it("deletes the column after confirmation", async () => {
		renderSettings();

		fireEvent.click(screen.getByRole("button", { name: "Delete column" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Confirm delete column" }),
		);

		await waitFor(() => {
			expect(onDeleteColumn).toHaveBeenCalledWith(12);
		});
	});

	it("keeps the column when cancel is chosen", async () => {
		renderSettings();

		fireEvent.click(screen.getByRole("button", { name: "Delete column" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

		expect(onDeleteColumn).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("still saves other settings without touching delete", async () => {
		renderSettings();

		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => {
			expect(onUpdateColumn).toHaveBeenCalled();
		});
		expect(onDeleteColumn).not.toHaveBeenCalled();
	});
});
