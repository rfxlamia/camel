// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerProject, TrackerVocabulary, WorkspaceMember } from "../types";
import { TaskMetadataCatalogProvider } from "./task-entry/TaskMetadataCatalogProvider";
import AddCard from "./AddCard";
import type { Column } from "../types";

const {
	mockGetWorkspaceMembers,
	mockListTrackerVocabularies,
	mockListTrackerProjects,
} = vi.hoisted(() => ({
	mockGetWorkspaceMembers: vi.fn(),
	mockListTrackerVocabularies: vi.fn(),
	mockListTrackerProjects: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api")>();
	return {
		...actual,
		api: {
			getWorkspaceMembers: (...args: unknown[]) =>
				mockGetWorkspaceMembers(...args),
			listTrackerVocabularies: (...args: unknown[]) =>
				mockListTrackerVocabularies(...args),
			listTrackerProjects: (...args: unknown[]) =>
				mockListTrackerProjects(...args),
		},
	};
});

const members: WorkspaceMember[] = [
	{ userId: 1, username: "rafi", displayName: "Rafi", role: "member" },
	{ userId: 2, username: "maya", displayName: "Maya", role: "member" },
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
		phases: [
			{
				id: 9,
				name: "Build",
				projectId: 1,
				position: 1,
				version: 1,
				subtitle: "",
				startDate: null,
				endDate: null,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		],
	},
];

function makeColumn(overrides: Partial<Column> = {}): Column {
	return {
		id: 42,
		title: "To do",
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

function renderAddCard(
	onAddCard = vi.fn().mockResolvedValue(undefined),
	column = makeColumn(),
) {
	return render(
		<TaskMetadataCatalogProvider workspaceId={7}>
			<AddCard column={column} onAddCard={onAddCard} />
		</TaskMetadataCatalogProvider>,
	);
}

function openAddCard() {
	fireEvent.click(screen.getByRole("button", { name: /add card/i }));
}

function getTitleTextarea() {
	return screen.getByRole("combobox", { name: "Task title" }) as HTMLTextAreaElement;
}

async function pickFieldValue(fieldLabel: string, valueLabel: string) {
	const textarea = getTitleTextarea();
	const currentTitle = textarea.value.replace(/\s+$/, "");
	fireEvent.change(textarea, { target: { value: `${currentTitle} ` } });
	fireEvent.keyDown(textarea, { key: "@" });
	await waitFor(() =>
		expect(screen.getByRole("listbox", { name: "Task fields" })).toBeTruthy(),
	);

	const fieldOptions = screen.getAllByRole("option");
	const fieldIndex = fieldOptions.findIndex((option) =>
		option.textContent?.includes(fieldLabel),
	);
	expect(fieldIndex).toBeGreaterThanOrEqual(0);
	for (let i = 0; i < fieldIndex; i++) {
		fireEvent.keyDown(textarea, { key: "ArrowDown" });
	}
	fireEvent.keyDown(textarea, { key: "Enter" });

	await waitFor(() =>
		expect(
			screen.getByRole("listbox", { name: `${fieldLabel} options` }),
		).toBeTruthy(),
	);

	const valueOptions = screen.getAllByRole("option");
	const valueIndex = valueOptions.findIndex((option) =>
		option.textContent?.includes(valueLabel),
	);
	expect(valueIndex).toBeGreaterThanOrEqual(0);
	for (let i = 0; i < valueIndex; i++) {
		fireEvent.keyDown(textarea, { key: "ArrowDown" });
	}
	fireEvent.keyDown(textarea, { key: "Enter" });
}

describe("AddCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReadyCatalogs();
	});

	afterEach(() => cleanup());

	it("Preserve the originating Board column", async () => {
		const onAddCard = vi.fn().mockResolvedValue(undefined);
		renderAddCard(onAddCard);

		openAddCard();
		await waitFor(() => expect(getTitleTextarea()).toBeTruthy());

		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Fix login " } });
		fireEvent.keyDown(textarea, { key: "@" });
		await waitFor(() =>
			expect(screen.getByRole("listbox", { name: "Task fields" })).toBeTruthy(),
		);

		expect(screen.queryByRole("option", { name: "Status" })).toBeNull();
		expect(screen.queryByRole("option", { name: "Column" })).toBeNull();

		fireEvent.change(textarea, { target: { value: "Ship it" } });
		fireEvent.click(screen.getByRole("button", { name: /add to board/i }));

		await waitFor(() => expect(onAddCard).toHaveBeenCalledTimes(1));
		expect(onAddCard).toHaveBeenCalledWith(
			expect.objectContaining({ columnId: 42, title: "Ship it" }),
		);
	});

	it("Submit Board with Enter outside a popover", async () => {
		const onAddCard = vi.fn().mockResolvedValue(undefined);
		renderAddCard(onAddCard);

		openAddCard();
		await waitFor(() => expect(getTitleTextarea()).toBeTruthy());

		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Ready to ship" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => expect(onAddCard).toHaveBeenCalledTimes(1));
		expect(onAddCard).toHaveBeenCalledWith(
			expect.objectContaining({ columnId: 42, title: "Ready to ship" }),
		);
	});

	it("Preserve the draft on any submit failure", async () => {
		const onAddCard = vi
			.fn()
			.mockRejectedValue(new Error("create failed"));
		renderAddCard(onAddCard);

		openAddCard();
		await waitFor(() => expect(getTitleTextarea()).toBeTruthy());

		await pickFieldValue("Assignee", "Rafi");
		await pickFieldValue("Priority", "High");

		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Keep me" } });
		fireEvent.click(screen.getByRole("button", { name: /add to board/i }));

		await waitFor(() => expect(onAddCard).toHaveBeenCalledTimes(1));
		expect(screen.getByRole("combobox", { name: "Task title" })).toBeTruthy();
		expect(textarea.value).toBe("Keep me");
		expect(screen.getByText(/Assignee:\s*Rafi/)).toBeTruthy();
		expect(screen.getByText(/Priority:\s*High/)).toBeTruthy();
	});

	it("Prevent an in-flight duplicate submit", async () => {
		let resolveCreate: (() => void) | undefined;
		const onAddCard = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveCreate = resolve;
				}),
		);
		renderAddCard(onAddCard);

		openAddCard();
		await waitFor(() => expect(getTitleTextarea()).toBeTruthy());

		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "One shot" } });
		fireEvent.click(screen.getByRole("button", { name: /add to board/i }));
		fireEvent.click(screen.getByRole("button", { name: /add to board/i }));
		fireEvent.keyDown(textarea, { key: "Enter" });

		expect(onAddCard).toHaveBeenCalledTimes(1);
		resolveCreate?.();
		await waitFor(() =>
			expect(
				screen.queryByRole("combobox", { name: "Task title" }),
			).toBeNull(),
		);
	});

	it("Retry after a failed request", async () => {
		const onAddCard = vi
			.fn()
			.mockRejectedValueOnce(new Error("temporary"))
			.mockResolvedValueOnce(undefined);
		renderAddCard(onAddCard);

		openAddCard();
		await waitFor(() => expect(getTitleTextarea()).toBeTruthy());

		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Retry me" } });
		fireEvent.click(screen.getByRole("button", { name: /add to board/i }));
		await waitFor(() => expect(onAddCard).toHaveBeenCalledTimes(1));
		expect(textarea.value).toBe("Retry me");

		fireEvent.click(screen.getByRole("button", { name: /add to board/i }));
		await waitFor(() => expect(onAddCard).toHaveBeenCalledTimes(2));
		expect(
			screen.queryByRole("combobox", { name: "Task title" }),
		).toBeNull();
	});

	it("assembles the full Board metadata callback payload", async () => {
		const onAddCard = vi.fn().mockResolvedValue(undefined);
		renderAddCard(onAddCard);

		openAddCard();
		await waitFor(() => expect(getTitleTextarea()).toBeTruthy());

		await pickFieldValue("Assignee", "Rafi");
		await pickFieldValue("Priority", "High");
		await pickFieldValue("Labels", "Bug");
		await pickFieldValue("Project", "Web");
		await pickFieldValue("Phase", "Build");

		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Fix login" } });
		fireEvent.click(screen.getByRole("button", { name: /add to board/i }));

		await waitFor(() => expect(onAddCard).toHaveBeenCalledTimes(1));
		expect(onAddCard).toHaveBeenCalledWith({
			columnId: 42,
			title: "Fix login",
			assigneeIds: [1],
			priorityId: 10,
			labelIds: [20],
			projectId: 1,
			phaseId: 9,
		});
		expect(onAddCard.mock.calls[0]?.[0]).not.toHaveProperty("statusId");
	});
});
