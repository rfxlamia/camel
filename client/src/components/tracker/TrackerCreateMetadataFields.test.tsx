// client/src/components/tracker/TrackerCreateMetadataFields.test.tsx — jsdom.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducer, useState } from "react";
import {
	createInitialTaskMetadataDraft,
	taskMetadataReducer,
	type TaskMetadataAction,
	type TaskMetadataDraft,
} from "../task-entry/taskMetadataDraft";
import {
	getTrackerTaskFieldDefinitions,
	type TrackerFieldLockContext,
} from "../task-entry/taskFieldDefinitions";
import type { TaskMetadataCatalogs } from "../task-entry/TaskMetadataCatalogProvider";
import { TaskTitleEditor } from "../task-entry/TaskTitleEditor";
import type { TrackerPhase, TrackerProject, TrackerVocabulary } from "../../types";
import { TrackerCreateMetadataFields, type TrackerCreatePickerName } from "./TrackerCreateMetadataFields";

const statuses: TrackerVocabulary[] = [
	{ id: 1, kind: "status", name: "Backlog", position: 1024, colour: "#eee" },
];
const priorities: TrackerVocabulary[] = [
	{ id: 10, kind: "priority", name: "High", position: 1024, colour: "#eee" },
	{ id: 11, kind: "priority", name: "Low", position: 2048, colour: "#eee" },
];
const labels: TrackerVocabulary[] = [
	{ id: 20, kind: "label", name: "Bug", position: 1024, colour: "#fdd" },
];
const members = [
	{
		userId: 5,
		username: "rina",
		displayName: "Rina Putri",
		role: "member" as const,
	},
];

const buildPhase: TrackerPhase = {
	id: 9,
	projectId: 1,
	name: "Build",
	subtitle: "",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

const projectAlpha: TrackerProject = {
	id: 1,
	name: "Project Alpha",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	phases: [buildPhase],
	createdAt: "2026-08-01T00:00:00Z",
	updatedAt: "2026-08-01T00:00:00Z",
};

function buildCatalogs(
	projects: TrackerProject[] = [projectAlpha],
): TaskMetadataCatalogs {
	return {
		assignee: { status: "ready", items: members },
		priority: { status: "ready", items: priorities },
		label: { status: "ready", items: labels },
		status: { status: "ready", items: statuses },
		project: { status: "ready", items: projects },
		retry: vi.fn(),
	};
}

function MetadataHarness({
	initialDraft,
	lockContext,
}: {
	initialDraft?: Partial<TaskMetadataDraft>;
	lockContext?: TrackerFieldLockContext;
}) {
	const catalogs = buildCatalogs(lockContext?.projects as TrackerProject[]);
	const fields = getTrackerTaskFieldDefinitions(catalogs, lockContext);
	const [draft, dispatch] = useReducer(
		taskMetadataReducer,
		createInitialTaskMetadataDraft(initialDraft ?? {}),
	);
	const [openPicker, setOpenPicker] = useState<TrackerCreatePickerName | null>(null);

	return (
		<>
			<TaskTitleEditor
				fields={fields}
				draft={draft}
				dispatch={(action: TaskMetadataAction) => dispatch(action)}
				placeholder="Item title"
			/>
			<TrackerCreateMetadataFields
				draft={draft}
				dispatch={(action: TaskMetadataAction) => dispatch(action)}
				openPicker={openPicker}
				onOpenPickerChange={setOpenPicker}
				statuses={statuses}
				priorities={priorities}
				labels={labels}
				members={members}
				projects={(lockContext?.projects as TrackerProject[]) ?? [projectAlpha]}
				hideProjectPickers={
					lockContext?.lockedProjectId !== undefined &&
					lockContext.lockedProjectId !== null
				}
			/>
		</>
	);
}

function getTitleTextarea() {
	return screen.getByRole("combobox", { name: "Item title" }) as HTMLTextAreaElement;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("TrackerCreateMetadataFields", () => {
	it("Reflect a command selection in the existing picker", async () => {
		render(<MetadataHarness />);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Ship it @pri" } });
		fireEvent.keyDown(textarea, { key: "Enter" });
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Priority: High" }),
			).toBeTruthy(),
		);
	});

	it("Reflect an existing picker selection in the chip list", async () => {
		render(<MetadataHarness />);
		fireEvent.click(await screen.findByText("Priority"));
		fireEvent.click(await screen.findByRole("option", { name: /High/ }));
		await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
		expect(
			screen.getByRole("button", { name: "Priority: High" }),
		).toBeTruthy();
	});

	it("Honor a valid project context lock", async () => {
		render(
			<MetadataHarness
				initialDraft={{
					projectId: 1,
					phaseId: 9,
					projects: [{ id: 1, phases: [{ id: 9, projectId: 1 }] }],
				}}
				lockContext={{
					lockedProjectId: 1,
					lockedPhaseId: 9,
					projects: [projectAlpha],
				}}
			/>,
		);
		const textarea = getTitleTextarea();
		fireEvent.change(textarea, { target: { value: "Locked " } });
		fireEvent.keyDown(textarea, { key: "@" });

		const listbox = await screen.findByRole("listbox", { name: "Task fields" });
		expect(listbox.textContent).not.toMatch(/Project/);
		expect(listbox.textContent).not.toMatch(/Phase/);
		expect(screen.queryByText("Project")).toBeNull();
		expect(screen.queryByText("Phase")).toBeNull();
	});
});
