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
const createWorkItem = vi.fn();

vi.mock("../../api", () => ({
	api: {
		listTrackerVocabularies: (...args: unknown[]) =>
			listTrackerVocabularies(...args),
		getWorkspaceMembers: (...args: unknown[]) => getWorkspaceMembers(...args),
		listTrackerProjects: (...args: unknown[]) => listTrackerProjects(...args),
		createWorkItem: (...args: unknown[]) => createWorkItem(...args),
	},
	ApiError: class ApiError extends Error {
		status: number;
		fieldErrors?: import("../../lib/taskCreateContracts").TaskCreateFieldErrors;
		constructor(
			message: string,
			status: number,
			_code?: string,
			_retryAfterMs?: number,
			fieldErrors?: import("../../lib/taskCreateContracts").TaskCreateFieldErrors,
		) {
			super(message);
			this.status = status;
			this.fieldErrors = fieldErrors;
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

const phaseBuild: TrackerPhase = {
	id: 19,
	projectId: 3,
	name: "Build",
	subtitle: "",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const projectWeb: TrackerProject = {
	id: 3,
	name: "Web",
	startDate: null,
	endDate: null,
	position: 3072,
	version: 1,
	phases: [phaseBuild],
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

function getTitleInput() {
	return screen.getByRole("combobox", { name: "Item title" }) as HTMLTextAreaElement;
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
	listTrackerProjects.mockResolvedValue([projectA, projectB, projectWeb]);
	createWorkItem.mockResolvedValue({ id: 99, key: "CAM-1" });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("TrackerCreateModal", () => {
	it("defaults the status chip to Backlog", async () => {
		renderModal();
		expect(
			await screen.findByRole("button", { name: "Status: Backlog" }),
		).toBeTruthy();
	});

	it("picks a status from the popover and shows it on the chip", async () => {
		renderModal();
		fireEvent.click(await screen.findByRole("button", { name: "Backlog" }));
		fireEvent.click(await screen.findByRole("option", { name: /In Progress/ }));
		await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
		expect(screen.getByRole("button", { name: "In Progress" })).toBeTruthy();
	});

	it("keeps the popover open while toggling labels", async () => {
		renderModal();
		fireEvent.click(await screen.findByText("Labels"));
		fireEvent.click(await screen.findByRole("option", { name: /Bug/ }));
		expect(screen.getByRole("listbox")).toBeTruthy();
	});

	it("submits the chosen properties and closes", async () => {
		const { onClose, onCreated } = renderModal();
		fireEvent.change(getTitleInput(), {
			target: { value: "  Fix login redirect  " },
		});
		fireEvent.click(await screen.findByText("Priority"));
		fireEvent.click(await screen.findByRole("option", { name: /High/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		await waitFor(() => expect(createWorkItem).toHaveBeenCalled());
		expect(createWorkItem).toHaveBeenCalledWith(7, {
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
		const title = getTitleInput() as HTMLTextAreaElement;
		fireEvent.change(title, { target: { value: "Second item" } });
		fireEvent.click(await screen.findByText("Priority"));
		fireEvent.click(await screen.findByRole("option", { name: /High/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		await waitFor(() => expect(createWorkItem).toHaveBeenCalled());
		await waitFor(() => expect(getTitleInput().value).toBe(""));
		expect(screen.queryByText("High")).toBeNull();
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.change(getTitleInput(), { target: { value: "Third item" } });
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createWorkItem).toHaveBeenCalledTimes(2));
		expect(createWorkItem).toHaveBeenLastCalledWith(7, {
			title: "Third item",
			statusId: 1,
			priorityId: null,
		});
	});

	it("shows an error and stays open when create fails", async () => {
		createWorkItem.mockRejectedValueOnce(new Error("network"));
		renderModal();
		fireEvent.change(getTitleInput(), {
			target: { value: "Broken create" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		expect(
			await screen.findByText("Could not create the item. Try again."),
		).toBeTruthy();
		expect(getTitleInput()).toBeTruthy();
	});

	it("closes the picker after create more resets the draft", async () => {
		renderModal();
		fireEvent.click(screen.getByRole("switch", { name: /Create more/ }));
		fireEvent.change(getTitleInput(), {
			target: { value: "With open picker" },
		});
		fireEvent.click(await screen.findByText("Labels"));
		expect(screen.getByRole("listbox")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		await waitFor(() => expect(createWorkItem).toHaveBeenCalled());
		await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
	});

	it("closes the picker on a backdrop press before closing the modal", async () => {
		const { onClose } = renderModal();
		fireEvent.click(await screen.findByRole("button", { name: "Backlog" }));
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
		fireEvent.click(await screen.findByRole("button", { name: "Backlog" }));
		const search = screen.getByRole("combobox", { name: "Change status…" });
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
		fireEvent.change(getTitleInput(), {
			target: { value: "Ship the release" },
		});
		fireEvent.click(await screen.findByText("Project"));
		fireEvent.click(await screen.findByRole("option", { name: /Rilis v2/ }));
		fireEvent.click(await screen.findByText("Phase"));
		fireEvent.click(await screen.findByRole("option", { name: /Persiapan/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() =>
			expect(createWorkItem).toHaveBeenCalledWith(7, {
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
		fireEvent.change(getTitleInput(), {
			target: { value: "Unassigned task" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createWorkItem).toHaveBeenCalled());
		const [, body] = createWorkItem.mock.calls[0] as [
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
		expect(screen.getByRole("button", { name: "Persiapan" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Rilis v2" }));
		fireEvent.click(await screen.findByRole("option", { name: /Rilis v3/ }));
		expect(screen.queryByRole("button", { name: "Persiapan" })).toBeNull();
	});

	it("keeps project and phase on create more reset", async () => {
		renderModal();
		fireEvent.click(screen.getByRole("switch", { name: /Create more/ }));
		fireEvent.change(getTitleInput(), {
			target: { value: "In project" },
		});
		fireEvent.click(await screen.findByText("Project"));
		fireEvent.click(await screen.findByRole("option", { name: /Rilis v2/ }));
		fireEvent.click(await screen.findByText("Phase"));
		fireEvent.click(await screen.findByRole("option", { name: /Persiapan/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		await waitFor(() => expect(createWorkItem).toHaveBeenCalled());
		await waitFor(() => expect(getTitleInput().value).toBe(""));
		expect(screen.getByRole("button", { name: "Persiapan" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Rilis v2" })).toBeTruthy();
	});

	it("surfaces the server's 400 for an invalid project inline", async () => {
		createWorkItem.mockRejectedValueOnce(
			new ApiError("Phase does not belong to this project.", 400),
		);
		renderModal();
		fireEvent.change(getTitleInput(), {
			target: { value: "Bad assignment" },
		});
		fireEvent.click(await screen.findByText("Project"));
		fireEvent.click(await screen.findByRole("option", { name: /Rilis v2/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		expect(
			await screen.findByText("Phase does not belong to this project."),
		).toBeTruthy();
		expect(getTitleInput()).toBeTruthy();
	});

	it("hides project pickers when the workspace has no projects", async () => {
		listTrackerProjects.mockResolvedValueOnce([]);
		renderModal();
		await screen.findByRole("button", { name: "Backlog" });
		expect(screen.queryByText("Project")).toBeNull();
		expect(screen.queryByText("Phase")).toBeNull();
	});
});

describe("TrackerCreateModal tag integration", () => {
	it("Preserve Tracker Enter shortcuts", async () => {
		renderModal();
		const title = getTitleInput();
		fireEvent.change(title, { target: { value: "Shortcut title" } });

		fireEvent.keyDown(title, { key: "Enter" });
		expect(createWorkItem).not.toHaveBeenCalled();

		cleanup();
		vi.clearAllMocks();
		renderModal();
		const title2 = getTitleInput();
		fireEvent.change(title2, { target: { value: "Cmd submit" } });
		fireEvent.keyDown(title2, { key: "Enter", metaKey: true });
		await waitFor(() => expect(createWorkItem).toHaveBeenCalledTimes(1));

		cleanup();
		vi.clearAllMocks();
		renderModal();
		const title3 = getTitleInput();
		fireEvent.change(title3, { target: { value: "Ctrl submit" } });
		fireEvent.keyDown(title3, { key: "Enter", ctrlKey: true });
		await waitFor(() => expect(createWorkItem).toHaveBeenCalledTimes(1));
	});

	it("Close nested layers in order", async () => {
		const { onClose } = renderModal();
		const title = getTitleInput();
		fireEvent.change(title, { target: { value: "Layered @pri" } });
		fireEvent.keyDown(title, { key: "Enter" });
		expect(
			await screen.findByRole("listbox", { name: /Priority options/ }),
		).toBeTruthy();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(
			screen.getByRole("listbox", { name: "Task fields" }),
		).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onClose).toHaveBeenCalled();
	});

	it("Recover from a deleted locked context", async () => {
		createWorkItem.mockRejectedValueOnce(
			new ApiError("Project must belong to this workspace.", 400, undefined, undefined, {
				projectId: "project must belong to this workspace",
			}),
		);
		render(
			<TrackerCreateModal
				workspaceId={7}
				statuses={statuses}
				priorities={priorities}
				defaultProjectId={1}
				defaultPhaseId={9}
				onClose={vi.fn()}
				onCreated={vi.fn()}
			/>,
		);
		await screen.findByRole("button", { name: "Backlog" });
		const title = getTitleInput();
		fireEvent.change(title, { target: { value: "Stale lock task" } });
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));

		expect(
			await screen.findByText("Project must belong to this workspace."),
		).toBeTruthy();
		expect(getTitleInput().value).toBe("Stale lock task");
		await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
		expect(screen.getByText("Phase")).toBeTruthy();
	});

	it("Reset the Tracker draft selectively", async () => {
		renderModal();
		fireEvent.click(screen.getByRole("switch", { name: /Create more/ }));

		const title = getTitleInput();
		fireEvent.change(title, { target: { value: "Draft title" } });
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "Draft body" },
		});

		fireEvent.click(await screen.findByRole("button", { name: "Backlog" }));
		fireEvent.click(await screen.findByRole("option", { name: /In Progress/ }));

		fireEvent.click(await screen.findByText("Project"));
		fireEvent.click(await screen.findByRole("option", { name: /Web/ }));
		fireEvent.click(await screen.findByText("Phase"));
		fireEvent.click(await screen.findByRole("option", { name: /Build/ }));

		fireEvent.click(await screen.findByText("Priority"));
		fireEvent.click(await screen.findByRole("option", { name: /High/ }));
		fireEvent.click(await screen.findByText("Assignee"));
		fireEvent.click(await screen.findByRole("option", { name: /Rina Putri/ }));
		fireEvent.click(await screen.findByText("Labels"));
		fireEvent.click(await screen.findByRole("option", { name: /Bug/ }));

		fireEvent.change(title, { target: { value: "Draft title @start" } });
		fireEvent.keyDown(title, { key: "Enter" });
		fireEvent.change(title, { target: { value: "Draft title @2026-09-10" } });
		fireEvent.keyDown(title, { key: "Enter" });

		fireEvent.change(title, { target: { value: "Draft title @end" } });
		fireEvent.keyDown(title, { key: "Enter" });
		fireEvent.change(title, { target: { value: "Draft title @2026-09-20" } });
		fireEvent.keyDown(title, { key: "Enter" });

		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createWorkItem).toHaveBeenCalled());

		await waitFor(() => expect(getTitleInput().value).toBe(""));
		expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
			"",
		);
		expect(screen.getByRole("button", { name: "In Progress" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Web" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Build" })).toBeTruthy();
		expect(screen.queryByText("High")).toBeNull();
		expect(screen.queryByText(/Assignee:/)).toBeNull();
		expect(screen.queryByText(/Labels:/)).toBeNull();
		expect(screen.queryByText(/Start date:/)).toBeNull();
		expect(screen.queryByText(/End date:/)).toBeNull();
	});

	it("submits one complete synchronized Tracker payload", async () => {
		renderModal();
		const title = getTitleInput();
		fireEvent.change(title, { target: { value: "Full payload" } });
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "Details" },
		});

		fireEvent.click(await screen.findByRole("button", { name: "Backlog" }));
		fireEvent.click(await screen.findByRole("option", { name: /In Progress/ }));
		fireEvent.click(await screen.findByText("Priority"));
		fireEvent.click(await screen.findByRole("option", { name: /High/ }));
		fireEvent.click(await screen.findByText("Assignee"));
		fireEvent.click(await screen.findByRole("option", { name: /Rina Putri/ }));
		fireEvent.click(await screen.findByText("Labels"));
		fireEvent.click(await screen.findByRole("option", { name: /Bug/ }));
		fireEvent.click(await screen.findByText("Project"));
		fireEvent.click(await screen.findByRole("option", { name: /Web/ }));
		fireEvent.click(await screen.findByText("Phase"));
		fireEvent.click(await screen.findByRole("option", { name: /Build/ }));

		fireEvent.change(title, { target: { value: "Full payload @start" } });
		fireEvent.keyDown(title, { key: "Enter" });
		fireEvent.change(title, { target: { value: "Full payload @2026-09-01" } });
		fireEvent.keyDown(title, { key: "Enter" });

		fireEvent.change(title, { target: { value: "Full payload @end" } });
		fireEvent.keyDown(title, { key: "Enter" });
		fireEvent.change(title, { target: { value: "Full payload @2026-09-30" } });
		fireEvent.keyDown(title, { key: "Enter" });

		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createWorkItem).toHaveBeenCalled());
		expect(createWorkItem).toHaveBeenCalledWith(7, {
			title: "Full payload",
			description: "Details",
			statusId: 3,
			priorityId: 10,
			assigneeIds: [5],
			labelIds: [20],
			projectId: 3,
			phaseId: 19,
			startDate: "2026-09-01",
			endDate: "2026-09-30",
		});
	});

	it("preserves Tracker draft for every submit failure class", async () => {
		createWorkItem
			.mockRejectedValueOnce(
				new ApiError("Some task fields are invalid", 400, undefined, undefined, {
					title: "Title is required",
					assigneeIds: "Assignee is no longer available",
					priorityId: "Priority is no longer available",
				}),
			)
			.mockRejectedValueOnce(new Error("network"))
			.mockRejectedValueOnce(new ApiError("Server error", 500));

		renderModal();
		const title = getTitleInput();
		fireEvent.change(title, { target: { value: "Failure draft" } });
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "Still here" },
		});
		fireEvent.click(await screen.findByText("Priority"));
		fireEvent.click(await screen.findByRole("option", { name: /High/ }));

		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		expect(await screen.findByText("Some task fields are invalid")).toBeTruthy();
		expect(title.value).toBe("Failure draft");
		expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
			"Still here",
		);
		await waitFor(() =>
			expect(
				screen.getAllByRole("button", { name: /Priority:\s*High/ })[0].getAttribute(
					"data-invalid",
				),
			).toBe("true"),
		);
		await waitFor(() =>
			expect(
				document.querySelector('[data-field-error]')?.getAttribute("data-field-error"),
			).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		expect(
			await screen.findByText("Could not create the item. Try again."),
		).toBeTruthy();
		expect(title.value).toBe("Failure draft");

		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		expect(
			await screen.findByText("Could not create the item. Try again."),
		).toBeTruthy();
		expect(title.value).toBe("Failure draft");
	});

	it("blocks duplicate Tracker submission while pending", async () => {
		let resolveCreate: (value: unknown) => void = () => {};
		createWorkItem.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCreate = resolve;
				}),
		);
		renderModal();
		const title = getTitleInput();
		fireEvent.change(title, { target: { value: "Pending once" } });
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		fireEvent.keyDown(title, { key: "Enter", metaKey: true });
		expect(createWorkItem).toHaveBeenCalledTimes(1);
		resolveCreate({ id: 1, key: "CAM-2" });
		await waitFor(() => expect(createWorkItem).toHaveBeenCalledTimes(1));
	});

	it("retries a preserved Tracker draft after failure", async () => {
		createWorkItem
			.mockRejectedValueOnce(new Error("network"))
			.mockResolvedValueOnce({ id: 99, key: "CAM-3" });
		const { onClose } = renderModal();
		const title = getTitleInput();
		fireEvent.change(title, { target: { value: "Retry payload" } });
		fireEvent.click(await screen.findByText("Priority"));
		fireEvent.click(await screen.findByRole("option", { name: /High/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		expect(
			await screen.findByText("Could not create the item. Try again."),
		).toBeTruthy();
		expect(title.value).toBe("Retry payload");

		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createWorkItem).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(createWorkItem).toHaveBeenLastCalledWith(7, {
			title: "Retry payload",
			statusId: 1,
			priorityId: 10,
		});
		expect(onClose).toHaveBeenCalled();
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
		await screen.findByRole("button", { name: "Backlog" });
		expect(screen.queryByText("Project")).toBeNull();
		expect(screen.queryByText("Phase")).toBeNull();
	});

	it("submits the locked projectId and phaseId", async () => {
		renderLockedModal(9);
		fireEvent.change(getTitleInput(), {
			target: { value: "In-phase task" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() =>
			expect(createWorkItem).toHaveBeenCalledWith(7, {
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
		fireEvent.change(getTitleInput(), {
			target: { value: "No-phase task" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() =>
			expect(createWorkItem).toHaveBeenCalledWith(7, {
				title: "No-phase task",
				statusId: 1,
				priorityId: null,
				projectId: 1,
			}),
		);
		const [, body] = createWorkItem.mock.calls[0] as [
			number,
			Record<string, unknown>,
		];
		expect(body).not.toHaveProperty("phaseId");
	});

	it("keeps locked project and phase on create more reset", async () => {
		renderLockedModal(9);
		fireEvent.click(screen.getByRole("switch", { name: /Create more/ }));
		fireEvent.change(getTitleInput(), {
			target: { value: "First" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createWorkItem).toHaveBeenCalledTimes(1));

		fireEvent.change(getTitleInput(), {
			target: { value: "Second" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create item" }));
		await waitFor(() => expect(createWorkItem).toHaveBeenCalledTimes(2));
		expect(createWorkItem).toHaveBeenLastCalledWith(7, {
			title: "Second",
			statusId: 1,
			priorityId: null,
			projectId: 1,
			phaseId: 9,
		});
	});
});
