// client/src/components/BoardCardTaxonomyFields.test.tsx — jsdom unit tests.

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerPhase, TrackerProject, TrackerVocabulary } from "../types";
import BoardCardTaxonomyFields from "./BoardCardTaxonomyFields";

const listTrackerVocabularies = vi.fn();
const listTrackerProjects = vi.fn();

vi.mock("../api", () => ({
	api: {
		listTrackerVocabularies: (...args: unknown[]) =>
			listTrackerVocabularies(...args),
		listTrackerProjects: (...args: unknown[]) => listTrackerProjects(...args),
	},
}));

const priorities: TrackerVocabulary[] = [
	{
		id: 10,
		kind: "priority",
		name: "High",
		position: 1024,
		colour: "#f00",
	},
	{
		id: 11,
		kind: "priority",
		name: "Low",
		position: 2048,
		colour: "#00f",
	},
];

const labels: TrackerVocabulary[] = [
	{
		id: 3,
		kind: "label",
		name: "Bug",
		position: 1024,
		colour: "#f00",
	},
	{
		id: 4,
		kind: "label",
		name: "Feature",
		position: 2048,
		colour: "#0f0",
	},
];

const q1Phase: TrackerPhase = {
	id: 9,
	projectId: 1,
	name: "Q1",
	subtitle: "",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const projects: TrackerProject[] = [
	{
		id: 1,
		name: "Alpha",
		startDate: null,
		endDate: null,
		position: 1024,
		version: 1,
		phases: [q1Phase],
	},
	{
		id: 2,
		name: "Beta",
		startDate: null,
		endDate: null,
		position: 2048,
		version: 1,
		phases: [],
	},
];

function renderFields(
	overrides: Partial<ComponentProps<typeof BoardCardTaxonomyFields>> = {},
) {
	const onPriorityChange = overrides.onPriorityChange ?? vi.fn();
	const onLabelIdsChange = overrides.onLabelIdsChange ?? vi.fn();
	const onProjectChange = overrides.onProjectChange ?? vi.fn();
	const onPhaseChange = overrides.onPhaseChange ?? vi.fn();

	const view = render(
		<BoardCardTaxonomyFields
			workspaceId={1}
			priorityId={null}
			labelIds={[]}
			projectId={null}
			phaseId={null}
			onPriorityChange={onPriorityChange}
			onLabelIdsChange={onLabelIdsChange}
			onProjectChange={onProjectChange}
			onPhaseChange={onPhaseChange}
			{...overrides}
		/>,
	);

	return {
		onPriorityChange,
		onLabelIdsChange,
		onProjectChange,
		onPhaseChange,
		...view,
	};
}

beforeEach(() => {
	listTrackerVocabularies.mockReset();
	listTrackerProjects.mockReset();
	listTrackerVocabularies.mockImplementation((_ws: number, kind: string) => {
		if (kind === "priority") return Promise.resolve(priorities);
		if (kind === "label") return Promise.resolve(labels);
		return Promise.resolve([]);
	});
	listTrackerProjects.mockResolvedValue(projects);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("BoardCardTaxonomyFields", () => {
	it("renders all four pickers from workspace option lists", async () => {
		renderFields({ projectId: 1, phaseId: null });
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /priority/i }),
			).toBeTruthy();
		});
		expect(screen.getByRole("button", { name: /alpha/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /phase/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /add label/i })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /status/i })).toBeNull();
	});

	it("sends priority, label, project, and phase ids on selection — never statusId", async () => {
		const { onPriorityChange, onLabelIdsChange, onProjectChange, onPhaseChange } =
			renderFields({
				projectId: 1,
				phaseId: null,
			});

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /priority/i }),
			).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: /priority/i }));
		fireEvent.click(screen.getByRole("option", { name: "High" }));
		expect(onPriorityChange).toHaveBeenCalledWith(10);
		expect(onPriorityChange).not.toHaveBeenCalledWith(
			expect.objectContaining({ statusId: expect.anything() }),
		);

		fireEvent.click(screen.getByRole("button", { name: /add label/i }));
		fireEvent.click(screen.getByRole("option", { name: "Bug" }));
		expect(onLabelIdsChange).toHaveBeenCalledWith([3]);

		fireEvent.click(screen.getByRole("button", { name: /alpha/i }));
		fireEvent.click(screen.getByRole("option", { name: "Beta" }));
		expect(onProjectChange).toHaveBeenCalledWith(2, null);

		fireEvent.click(screen.getByRole("button", { name: /phase/i }));
		fireEvent.click(screen.getByRole("option", { name: "Q1" }));
		expect(onPhaseChange).toHaveBeenCalledWith(9);
		expect(onPriorityChange).not.toHaveBeenCalledWith(
			expect.objectContaining({ statusId: expect.anything() }),
		);
	});

	it("clears project to null and phase with it", async () => {
		const { onProjectChange } = renderFields({
			projectId: 1,
			phaseId: 9,
		});

		await waitFor(() =>
			expect(screen.getByRole("button", { name: /alpha/i })).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: /alpha/i }));
		fireEvent.click(screen.getByRole("option", { name: "No project" }));
		expect(onProjectChange).toHaveBeenCalledWith(null, null);
	});

	it("clears phase to null", async () => {
		const { onPhaseChange } = renderFields({
			projectId: 1,
			phaseId: 9,
		});

		await waitFor(() =>
			expect(screen.getByRole("button", { name: /q1/i })).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: /q1/i }));
		fireEvent.click(screen.getByRole("option", { name: "No phase" }));
		expect(onPhaseChange).toHaveBeenCalledWith(null);
	});

	it("clears priority to null and labels to an empty array", async () => {
		const { onPriorityChange, onLabelIdsChange } = renderFields({
			priorityId: 10,
			priority: priorities[0],
			labelIds: [3],
			labels: [labels[0]!],
		});

		await waitFor(() =>
			expect(screen.getByRole("button", { name: /high/i })).toBeTruthy(),
		);

		fireEvent.click(screen.getByRole("button", { name: /high/i }));
		fireEvent.click(screen.getByRole("option", { name: "No priority" }));
		expect(onPriorityChange).toHaveBeenCalledWith(null);

		fireEvent.click(screen.getByRole("button", { name: /add label/i }));
		fireEvent.click(screen.getByRole("option", { name: "Bug" }));
		expect(onLabelIdsChange).toHaveBeenCalledWith([]);
	});

	it("retains priority selection while vocabulary lists are loading", () => {
		listTrackerVocabularies.mockImplementation(() => new Promise(() => {}));
		renderFields({
			priorityId: 10,
			priority: priorities[0],
		});
		expect(screen.getByRole("button", { name: /high/i })).toBeTruthy();
	});

	it("retains selections when vocabulary fetch fails", async () => {
		listTrackerVocabularies.mockRejectedValue(new Error("network"));
		renderFields({
			priorityId: 10,
			priority: priorities[0],
			labelIds: [3],
			labels: [labels[0]!],
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /high/i })).toBeTruthy(),
		);
		expect(screen.getByText("Bug")).toBeTruthy();
	});

	it("retains selections when vocabulary lists are empty", async () => {
		listTrackerVocabularies.mockResolvedValue([]);
		renderFields({
			priorityId: 10,
			priority: priorities[0],
			labelIds: [3],
			labels: [labels[0]!],
			projectId: 1,
			phaseId: 9,
			projectName: "Alpha",
			phaseName: "Q1",
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /high/i })).toBeTruthy(),
		);
		expect(screen.getByText("Bug")).toBeTruthy();
		expect(screen.getByRole("button", { name: /alpha/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /q1/i })).toBeTruthy();
	});

	it("retains project and phase when project list is empty or fails", async () => {
		listTrackerProjects.mockRejectedValue(new Error("network"));
		renderFields({
			projectId: 1,
			phaseId: 9,
			projectName: "Alpha",
			phaseName: "Q1",
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /alpha/i })).toBeTruthy(),
		);
		expect(screen.getByRole("button", { name: /q1/i })).toBeTruthy();
	});

	it("does not render a status picker", async () => {
		renderFields();
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /priority/i }),
			).toBeTruthy(),
		);
		expect(screen.queryByRole("button", { name: /^status$/i })).toBeNull();
		expect(screen.queryByRole("combobox", { name: /change status/i })).toBeNull();
	});
});
