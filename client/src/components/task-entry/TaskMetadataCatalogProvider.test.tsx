// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerProject, TrackerVocabulary, WorkspaceMember } from "../../types";
import {
	TaskMetadataCatalogProvider,
	useTaskMetadataCatalogs,
} from "./TaskMetadataCatalogProvider";
import { getBoardTaskFieldDefinitions } from "./taskFieldDefinitions";

const {
	mockGetWorkspaceMembers,
	mockListTrackerVocabularies,
	mockListTrackerProjects,
} = vi.hoisted(() => ({
	mockGetWorkspaceMembers: vi.fn(),
	mockListTrackerVocabularies: vi.fn(),
	mockListTrackerProjects: vi.fn(),
}));

vi.mock("../../api", () => ({
	api: {
		getWorkspaceMembers: (...args: unknown[]) => mockGetWorkspaceMembers(...args),
		listTrackerVocabularies: (...args: unknown[]) =>
			mockListTrackerVocabularies(...args),
		listTrackerProjects: (...args: unknown[]) => mockListTrackerProjects(...args),
	},
}));

const members: WorkspaceMember[] = [
	{ userId: 1, username: "rafi", displayName: "Rafi", role: "member" },
];
const priorities: TrackerVocabulary[] = [
	{
		id: 10,
		kind: "priority",
		name: "High",
		position: 1,
		colour: "#f00",
	},
];
const projects: TrackerProject[] = [
	{
		id: 1,
		name: "Alpha",
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

function CatalogConsumer({
	onReady,
}: {
	onReady?: (value: ReturnType<typeof useTaskMetadataCatalogs>) => void;
}) {
	const catalogs = useTaskMetadataCatalogs();
	onReady?.(catalogs);
	const fields = getBoardTaskFieldDefinitions(catalogs);
	return (
		<div>
			<ul aria-label="Task fields">
				{fields.map((field) => (
					<li key={field.id}>
						<span data-testid={`field-${field.id}`}>{field.label}</span>
						<span data-testid={`state-${field.id}`}>{field.catalogState}</span>
						{field.errorMessage ? (
							<span data-testid={`error-${field.id}`}>{field.errorMessage}</span>
						) : null}
						{field.onRetry ? (
							<button type="button" onClick={field.onRetry}>
								Retry {field.label}
							</button>
						) : null}
						{field.allowsCreate ? (
							<span data-testid={`create-${field.id}`}>can-create</span>
						) : null}
					</li>
				))}
			</ul>
			<button type="button">Create</button>
		</div>
	);
}

function renderProvider(
	workspaceId = 7,
	extra?: { onReady?: (value: ReturnType<typeof useTaskMetadataCatalogs>) => void },
) {
	return render(
		<TaskMetadataCatalogProvider workspaceId={workspaceId}>
			<CatalogConsumer onReady={extra?.onReady} />
		</TaskMetadataCatalogProvider>,
	);
}

function mockReadyCatalogs() {
	mockGetWorkspaceMembers.mockResolvedValue({ members });
	mockListTrackerVocabularies.mockImplementation(
		(_workspaceId: number, kind: string) => {
			if (kind === "priority") return Promise.resolve(priorities);
			if (kind === "label") return Promise.resolve([]);
			if (kind === "status") return Promise.resolve([]);
			return Promise.resolve([]);
		},
	);
	mockListTrackerProjects.mockResolvedValue(projects);
}

describe("TaskMetadataCatalogProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReadyCatalogs();
	});

	afterEach(() => cleanup());

	it("Continue when one catalog fails", async () => {
		mockGetWorkspaceMembers.mockRejectedValue(new Error("Assignee catalog failed"));

		renderProvider();

		await waitFor(() => {
			expect(screen.getByTestId("state-priorityId").textContent).toBe("ready");
		});
		expect(screen.getByTestId("state-assigneeIds").textContent).toBe("failed");
		expect(screen.getByTestId("error-assigneeIds").textContent).toMatch(
			/assignee/i,
		);
		expect(screen.getByRole("button", { name: "Retry Assignee" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();

		mockGetWorkspaceMembers.mockResolvedValue({ members });
		fireEvent.click(screen.getByRole("button", { name: "Retry Assignee" }));

		await waitFor(() => {
			expect(screen.getByTestId("state-assigneeIds").textContent).toBe("ready");
		});

		expect(mockGetWorkspaceMembers).toHaveBeenCalledTimes(2);
		expect(mockListTrackerVocabularies).toHaveBeenCalledTimes(3);
	});

	it("Distinguish loading, empty, and failed catalogs", async () => {
		let resolveAssignee: (value: { members: WorkspaceMember[] }) => void = () => {};
		const assigneePending = new Promise<{ members: WorkspaceMember[] }>((resolve) => {
			resolveAssignee = resolve;
		});
		mockGetWorkspaceMembers.mockReturnValue(assigneePending);
		mockListTrackerVocabularies.mockImplementation(
			(_workspaceId: number, kind: string) => {
				if (kind === "priority") return Promise.resolve([]);
				if (kind === "label") return Promise.reject(new Error("Labels failed"));
				return Promise.resolve([]);
			},
		);

		renderProvider();

		expect(screen.getByTestId("state-assigneeIds").textContent).toBe("loading");
		expect(screen.getByTestId("state-priorityId").textContent).toBe("loading");
		expect(screen.getByTestId("state-labelIds").textContent).toBe("loading");

		await waitFor(() => {
			expect(screen.getByTestId("state-priorityId").textContent).toBe("empty");
		});
		expect(screen.getByTestId("state-labelIds").textContent).toBe("failed");
		expect(screen.queryByTestId("create-priorityId")).toBeNull();
		expect(screen.queryByTestId("create-labelIds")).toBeNull();

		resolveAssignee({ members });
		await waitFor(() => {
			expect(screen.getByTestId("state-assigneeIds").textContent).toBe("ready");
		});
	});

	it("deduplicates workspace catalog requests", async () => {
		function CatalogConsumerProbe({ testId }: { testId: string }) {
			const catalogs = useTaskMetadataCatalogs();
			const fields = getBoardTaskFieldDefinitions(catalogs);
			return <span data-testid={testId}>{fields.length}</span>;
		}

		const { rerender } = render(
			<TaskMetadataCatalogProvider workspaceId={7}>
				<CatalogConsumerProbe testId="consumer-a" />
				<CatalogConsumerProbe testId="consumer-b" />
			</TaskMetadataCatalogProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("consumer-a").textContent).toBe("6");
			expect(screen.getByTestId("consumer-b").textContent).toBe("6");
		});

		expect(mockGetWorkspaceMembers).toHaveBeenCalledTimes(1);
		expect(mockListTrackerProjects).toHaveBeenCalledTimes(1);
		expect(
			mockListTrackerVocabularies.mock.calls.filter(([, kind]) => kind === "priority"),
		).toHaveLength(1);
		expect(
			mockListTrackerVocabularies.mock.calls.filter(([, kind]) => kind === "label"),
		).toHaveLength(1);
		expect(
			mockListTrackerVocabularies.mock.calls.filter(([, kind]) => kind === "status"),
		).toHaveLength(1);

		rerender(
			<TaskMetadataCatalogProvider workspaceId={9}>
				<CatalogConsumerProbe testId="consumer-a" />
				<CatalogConsumerProbe testId="consumer-b" />
			</TaskMetadataCatalogProvider>,
		);

		await waitFor(() => {
			expect(mockGetWorkspaceMembers).toHaveBeenCalledTimes(2);
		});
		expect(mockGetWorkspaceMembers).toHaveBeenNthCalledWith(1, 7);
		expect(mockGetWorkspaceMembers).toHaveBeenNthCalledWith(2, 9);
		expect(mockListTrackerProjects).toHaveBeenCalledTimes(2);
		expect(mockListTrackerProjects).toHaveBeenNthCalledWith(1, 7);
		expect(mockListTrackerProjects).toHaveBeenNthCalledWith(2, 9);
	});

	it("ignores stale workspace catalog responses after workspace switch", async () => {
		const ws7Members: WorkspaceMember[] = [
			{ userId: 1, username: "ws7", displayName: "Workspace 7", role: "member" },
		];
		const ws9Members: WorkspaceMember[] = [
			{ userId: 2, username: "ws9", displayName: "Workspace 9", role: "member" },
		];
		let resolveWs7Members: (value: { members: WorkspaceMember[] }) => void = () => {};
		const ws7MembersPending = new Promise<{ members: WorkspaceMember[] }>((resolve) => {
			resolveWs7Members = resolve;
		});

		mockGetWorkspaceMembers.mockImplementation((workspaceId: number) => {
			if (workspaceId === 7) return ws7MembersPending;
			return Promise.resolve({ members: ws9Members });
		});

		function AssigneeProbe() {
			const catalogs = useTaskMetadataCatalogs();
			const assignee = catalogs.assignee;
			if (assignee.status !== "ready") {
				return <span data-testid="assignee-status">{assignee.status}</span>;
			}
			return (
				<span data-testid="assignee-ids">
					{assignee.items.map((member) => member.userId).join(",")}
				</span>
			);
		}

		const { rerender } = render(
			<TaskMetadataCatalogProvider workspaceId={7}>
				<AssigneeProbe />
			</TaskMetadataCatalogProvider>,
		);

		rerender(
			<TaskMetadataCatalogProvider workspaceId={9}>
				<AssigneeProbe />
			</TaskMetadataCatalogProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("assignee-ids").textContent).toBe("2");
		});

		resolveWs7Members({ members: ws7Members });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(screen.getByTestId("assignee-ids").textContent).toBe("2");
	});
});
