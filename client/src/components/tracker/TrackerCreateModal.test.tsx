// client/src/components/tracker/TrackerCreateModal.test.tsx — jsdom.
// No jest-dom in this repo (no setupFiles): use toBeTruthy / queryBy.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listTrackerVocabularies = vi.fn();
const getWorkspaceMembers = vi.fn();
const createTrackerItem = vi.fn();

vi.mock("../../api", () => ({
	api: {
		listTrackerVocabularies: (...args: unknown[]) =>
			listTrackerVocabularies(...args),
		getWorkspaceMembers: (...args: unknown[]) => getWorkspaceMembers(...args),
		createTrackerItem: (...args: unknown[]) => createTrackerItem(...args),
	},
}));

import type { TrackerVocabulary } from "../../types";
import TrackerCreateModal from "./TrackerCreateModal";

const statuses: TrackerVocabulary[] = [
	{ id: 1, kind: "status", name: "Backlog", position: 1024, colour: "#eee" },
	{ id: 2, kind: "status", name: "Todo", position: 2048, colour: "#eee" },
	{
		id: 3,
		kind: "status",
		name: "In Progress",
		position: 3072,
		colour: "#eee",
	},
];
const priorities: TrackerVocabulary[] = [
	{ id: 10, kind: "priority", name: "High", position: 1024, colour: "#eee" },
	{ id: 11, kind: "priority", name: "Low", position: 2048, colour: "#eee" },
];

function renderModal() {
	const onClose = vi.fn();
	const onCreated = vi.fn();
	render(
		<TrackerCreateModal
			workspaceId={7}
			statuses={statuses}
			priorities={priorities}
			onClose={onClose}
			onCreated={onCreated}
		/>,
	);
	return { onClose, onCreated };
}

beforeEach(() => {
	listTrackerVocabularies.mockResolvedValue([
		{ id: 20, kind: "label", name: "Bug", position: 1024, colour: "#fdd" },
	]);
	getWorkspaceMembers.mockResolvedValue({
		members: [
			{
				userId: 5,
				username: "rina",
				displayName: "Rina Putri",
				role: "member",
			},
		],
	});
	createTrackerItem.mockResolvedValue({ id: 99, key: "CAM-1" });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("TrackerCreateModal", () => {
	it("defaults the status chip to Backlog", async () => {
		renderModal();
		expect(await screen.findByText("Backlog")).toBeTruthy();
	});

	it("picks a status from the popover and shows it on the chip", async () => {
		renderModal();
		fireEvent.click(await screen.findByText("Backlog"));
		fireEvent.click(await screen.findByRole("option", { name: /In Progress/ }));
		await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
		expect(screen.getByText("In Progress")).toBeTruthy();
	});

	it("keeps the popover open while toggling labels", async () => {
		renderModal();
		fireEvent.click(await screen.findByText("Labels"));
		fireEvent.click(await screen.findByRole("option", { name: /Bug/ }));
		expect(screen.getByRole("listbox")).toBeTruthy();
	});

	it("submits the chosen properties and closes", async () => {
		const { onClose, onCreated } = renderModal();
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "  Fix login redirect  " },
		});
		fireEvent.click(await screen.findByText("Priority"));
		fireEvent.click(await screen.findByRole("option", { name: /High/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		await waitFor(() => expect(createTrackerItem).toHaveBeenCalled());
		expect(createTrackerItem).toHaveBeenCalledWith(7, {
			title: "Fix login redirect",
			statusId: 1,
			priorityId: 10,
		});
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(onCreated).toHaveBeenCalled();
	});

	it("stays open and clears the draft when Create more is on", async () => {
		const { onClose } = renderModal();
		fireEvent.click(screen.getByRole("switch", { name: /Create more/ }));
		const title = screen.getByLabelText("Item title") as HTMLTextAreaElement;
		fireEvent.change(title, { target: { value: "Second item" } });
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		await waitFor(() => expect(createTrackerItem).toHaveBeenCalled());
		await waitFor(() => expect(title.value).toBe(""));
		expect(onClose).not.toHaveBeenCalled();
	});

	it("closes the picker on Escape before closing the modal", async () => {
		const { onClose } = renderModal();
		fireEvent.click(await screen.findByText("Backlog"));
		const search = screen.getByRole("combobox");
		fireEvent.keyDown(search, { key: "Escape" });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onClose).toHaveBeenCalled();
	});
});
