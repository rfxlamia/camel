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
const listTrackerProjects = vi.fn();
const createTrackerItem = vi.fn();

vi.mock("../../api", () => ({
	api: {
		listTrackerVocabularies: (...args: unknown[]) =>
			listTrackerVocabularies(...args),
		getWorkspaceMembers: (...args: unknown[]) => getWorkspaceMembers(...args),
		listTrackerProjects: (...args: unknown[]) => listTrackerProjects(...args),
		createTrackerItem: (...args: unknown[]) => createTrackerItem(...args),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
}));

import { ApiError } from "../../api";
import type { TrackerPhase, TrackerProject, TrackerVocabulary } from "../../types";
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

const persiapan: TrackerPhase = {
	id: 9,
	projectId: 1,
	name: "Persiapan",
	subtitle: "",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const projectA: TrackerProject = {
	id: 1,
	name: "Rilis v2",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	phases: [persiapan],
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const projectB: TrackerProject = {
	id: 2,
	name: "Rilis v3",
	startDate: null,
	endDate: null,
	position: 2048,
	version: 1,
	phases: [],
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

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
	listTrackerProjects.mockResolvedValue([projectA, projectB]);
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
		fireEvent.click(await screen.findByText("Priority"));
		fireEvent.click(await screen.findByRole("option", { name: /High/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		await waitFor(() => expect(createTrackerItem).toHaveBeenCalled());
		await waitFor(() => expect(title.value).toBe(""));
		expect(screen.getByText("High")).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.change(title, { target: { value: "Third item" } });
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createTrackerItem).toHaveBeenCalledTimes(2));
		expect(createTrackerItem).toHaveBeenLastCalledWith(7, {
			title: "Third item",
			statusId: 1,
			priorityId: 10,
		});
	});

	it("shows an error and stays open when create fails", async () => {
		createTrackerItem.mockRejectedValueOnce(new Error("network"));
		renderModal();
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "Broken create" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		expect(
			await screen.findByText("Could not create the item. Try again."),
		).toBeTruthy();
		expect(screen.getByLabelText("Item title")).toBeTruthy();
	});

	it("closes the picker after create more resets the draft", async () => {
		renderModal();
		fireEvent.click(screen.getByRole("switch", { name: /Create more/ }));
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "With open picker" },
		});
		fireEvent.click(await screen.findByText("Labels"));
		expect(screen.getByRole("listbox")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		await waitFor(() => expect(createTrackerItem).toHaveBeenCalled());
		await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
	});

	it("closes the picker on a backdrop press before closing the modal", async () => {
		const { onClose } = renderModal();
		fireEvent.click(await screen.findByText("Backlog"));
		const backdrop = screen.getByTestId("tracker-create-backdrop");
		fireEvent.mouseDown(backdrop);
		fireEvent.click(backdrop);
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.mouseDown(backdrop);
		expect(onClose).toHaveBeenCalled();
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

describe("TrackerCreateModal project assignment", () => {
	it("submits projectId and phaseId when both are chosen", async () => {
		renderModal();
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "Ship the release" },
		});
		fireEvent.click(await screen.findByText("Project"));
		fireEvent.click(await screen.findByRole("option", { name: /Rilis v2/ }));
		fireEvent.click(await screen.findByText("Phase"));
		fireEvent.click(await screen.findByRole("option", { name: /Persiapan/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() =>
			expect(createTrackerItem).toHaveBeenCalledWith(7, {
				title: "Ship the release",
				statusId: 1,
				priorityId: null,
				projectId: 1,
				phaseId: 9,
			}),
		);
	});

	it("submits without projectId or phaseId when both are left unset", async () => {
		renderModal();
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "Unassigned task" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createTrackerItem).toHaveBeenCalled());
		const [, body] = createTrackerItem.mock.calls[0] as [
			number,
			Record<string, unknown>,
		];
		expect(body).not.toHaveProperty("projectId");
		expect(body).not.toHaveProperty("phaseId");
	});

	it("clears the phase when the project changes", async () => {
		renderModal();
		fireEvent.click(await screen.findByText("Project"));
		fireEvent.click(await screen.findByRole("option", { name: /Rilis v2/ }));
		fireEvent.click(await screen.findByText("Phase"));
		fireEvent.click(await screen.findByRole("option", { name: /Persiapan/ }));
		expect(screen.getByText("Persiapan")).toBeTruthy();

		fireEvent.click(screen.getByText("Rilis v2"));
		fireEvent.click(await screen.findByRole("option", { name: /Rilis v3/ }));
		expect(screen.queryByText("Persiapan")).toBeNull();
	});

	it("clears project and phase on create more reset", async () => {
		renderModal();
		fireEvent.click(screen.getByRole("switch", { name: /Create more/ }));
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "In project" },
		});
		fireEvent.click(await screen.findByText("Project"));
		fireEvent.click(await screen.findByRole("option", { name: /Rilis v2/ }));
		fireEvent.click(await screen.findByText("Phase"));
		fireEvent.click(await screen.findByRole("option", { name: /Persiapan/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		await waitFor(() => expect(createTrackerItem).toHaveBeenCalled());
		await waitFor(() => expect(screen.queryByText("Persiapan")).toBeNull());
		expect(screen.queryByText("Rilis v2")).toBeNull();
	});

	it("surfaces the server's 400 for an invalid project inline", async () => {
		createTrackerItem.mockRejectedValueOnce(
			new ApiError("Phase does not belong to this project.", 400),
		);
		renderModal();
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "Bad assignment" },
		});
		fireEvent.click(await screen.findByText("Project"));
		fireEvent.click(await screen.findByRole("option", { name: /Rilis v2/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		expect(
			await screen.findByText("Phase does not belong to this project."),
		).toBeTruthy();
		expect(screen.getByLabelText("Item title")).toBeTruthy();
	});

	it("hides project pickers when the workspace has no projects", async () => {
		listTrackerProjects.mockResolvedValueOnce([]);
		renderModal();
		await screen.findByText("Backlog");
		expect(screen.queryByText("Project")).toBeNull();
		expect(screen.queryByText("Phase")).toBeNull();
	});
});

describe("TrackerCreateModal locked project assignment", () => {
	function renderLockedModal(phaseId: number | null = 9) {
		const onClose = vi.fn();
		const onCreated = vi.fn();
		render(
			<TrackerCreateModal
				workspaceId={7}
				statuses={statuses}
				priorities={priorities}
				defaultProjectId={1}
				defaultPhaseId={phaseId}
				onClose={onClose}
				onCreated={onCreated}
			/>,
		);
		return { onClose, onCreated };
	}

	it("hides project and phase pickers when defaultProjectId is set", async () => {
		renderLockedModal();
		await screen.findByText("Backlog");
		expect(screen.queryByText("Project")).toBeNull();
		expect(screen.queryByText("Phase")).toBeNull();
	});

	it("submits the locked projectId and phaseId", async () => {
		renderLockedModal(9);
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "In-phase task" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() =>
			expect(createTrackerItem).toHaveBeenCalledWith(7, {
				title: "In-phase task",
				statusId: 1,
				priorityId: null,
				projectId: 1,
				phaseId: 9,
			}),
		);
	});

	it("submits projectId without phaseId when locked to no phase", async () => {
		renderLockedModal(null);
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "No-phase task" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() =>
			expect(createTrackerItem).toHaveBeenCalledWith(7, {
				title: "No-phase task",
				statusId: 1,
				priorityId: null,
				projectId: 1,
			}),
		);
		const [, body] = createTrackerItem.mock.calls[0] as [
			number,
			Record<string, unknown>,
		];
		expect(body).not.toHaveProperty("phaseId");
	});

	it("keeps locked project and phase on create more reset", async () => {
		renderLockedModal(9);
		fireEvent.click(screen.getByRole("switch", { name: /Create more/ }));
		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "First" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createTrackerItem).toHaveBeenCalledTimes(1));

		fireEvent.change(screen.getByLabelText("Item title"), {
			target: { value: "Second" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createTrackerItem).toHaveBeenCalledTimes(2));
		expect(createTrackerItem).toHaveBeenLastCalledWith(7, {
			title: "Second",
			statusId: 1,
			priorityId: null,
			projectId: 1,
			phaseId: 9,
		});
	});
});
