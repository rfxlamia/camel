// client/src/components/tracker/TrackerRow.test.tsx — jsdom.

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackerGroup } from "../../lib/trackerUtils";
import type {
	TrackerPhase,
	TrackerProject,
	TrackerVocabulary,
	WorkItem,
	WorkspaceMember,
} from "../../types";
import TrackerRow from "./TrackerRow";
import TrackerSection from "./TrackerSection";

const { mockNavigate } = vi.hoisted(() => ({
	mockNavigate: vi.fn(),
}));

vi.mock("react-router", () => ({
	useNavigate: () => mockNavigate,
}));

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	mockNavigate.mockClear();
});

const statuses: TrackerVocabulary[] = [
	{ id: 1, kind: "status", name: "Backlog", position: 1024, colour: "#eee" },
];
const priorities: TrackerVocabulary[] = [
	{ id: 10, kind: "priority", name: "High", position: 1024, colour: "#eee" },
];
const labels: TrackerVocabulary[] = [
	{
		id: 3,
		kind: "label",
		name: "Feature",
		position: 1000,
		colour: "oklch(0.7 0.1 260)",
	},
];
const members: WorkspaceMember[] = [
	{
		userId: 7,
		username: "alice",
		displayName: "Alice",
		role: "member",
	},
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

const releaseProject: TrackerProject = {
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

function makeRowItem(overrides: Partial<WorkItem> = {}): WorkItem {
	return {
		id: 1,
		key: "CA-1",
		title: "Workspace Rename",
		description: "",
		source: "tracker",
		projectId: 1,
		phaseId: 9,
		startDate: null,
		endDate: null,
		status: statuses[0]!,
		priority: priorities[0]!,
		labels: [labels[0]!],
		assignees: [{ id: 7, displayName: "Alice", username: "alice" }],
		version: 1,
		createdAt: "2026-07-04T00:00:00Z",
		updatedAt: "2026-07-04T00:00:00Z",
		...overrides,
	};
}

const defaultItem = makeRowItem();

type PickerKind =
	| "status"
	| "date"
	| "project"
	| "phase"
	| "priority"
	| "assignees"
	| "labels"
	| "kebab";

const TRIGGER_LABELS: Record<PickerKind, string> = {
	status: "Backlog, CA-1",
	date: "Date: Set date",
	project: "Project: Rilis v2",
	phase: "Phase: Persiapan",
	priority: "Priority: High",
	assignees: "Assignees",
	labels: "Labels",
	kebab: "More properties",
};

const OPEN_QUERIES: Record<
	Exclude<PickerKind, "kebab" | "date">,
	{ role: "combobox"; name: string }
> = {
	status: { role: "combobox", name: "Change status…" },
	project: { role: "combobox", name: "Set project to…" },
	phase: { role: "combobox", name: "Set phase to…" },
	priority: { role: "combobox", name: "Change priority…" },
	assignees: { role: "combobox", name: "Assign to…" },
	labels: { role: "combobox", name: "Change or add labels…" },
};

function clickTrigger(kind: PickerKind) {
	fireEvent.click(screen.getByRole("button", { name: TRIGGER_LABELS[kind] }));
}

function expectPickerOpen(kind: PickerKind) {
	if (kind === "kebab") {
		expect(
			screen.getByRole("dialog", { name: "More properties for CA-1" }),
		).toBeTruthy();
		return;
	}
	if (kind === "date") {
		expect(screen.getByLabelText("Start date")).toBeTruthy();
		return;
	}
	const query = OPEN_QUERIES[kind];
	expect(screen.getByRole(query.role, { name: query.name })).toBeTruthy();
}

function expectPickerClosed(kind: PickerKind) {
	if (kind === "kebab") {
		expect(
			screen.queryByRole("dialog", { name: "More properties for CA-1" }),
		).toBeNull();
		return;
	}
	if (kind === "date") {
		expect(screen.queryByLabelText("Start date")).toBeNull();
		return;
	}
	const query = OPEN_QUERIES[kind];
	expect(screen.queryByRole(query.role, { name: query.name })).toBeNull();
}

function renderRow(overrides: Partial<ComponentProps<typeof TrackerRow>> = {}) {
	const onStatusChange = overrides.onStatusChange ?? vi.fn();
	const onDateChange = overrides.onDateChange ?? vi.fn();
	const onProjectChange = overrides.onProjectChange ?? vi.fn();
	const onPhaseChange = overrides.onPhaseChange ?? vi.fn();
	const onPriorityChange = overrides.onPriorityChange ?? vi.fn();
	const onAssigneeToggle = overrides.onAssigneeToggle ?? vi.fn();
	const onLabelToggle = overrides.onLabelToggle ?? vi.fn();

	const view = render(
		<TrackerRow
			item={defaultItem}
			statuses={statuses}
			priorities={priorities}
			projects={[releaseProject]}
			labels={labels}
			members={members}
			onStatusChange={onStatusChange}
			onDateChange={onDateChange}
			onProjectChange={onProjectChange}
			onPhaseChange={onPhaseChange}
			onPriorityChange={onPriorityChange}
			onAssigneeToggle={onAssigneeToggle}
			onLabelToggle={onLabelToggle}
			{...overrides}
		/>,
	);

	return {
		onStatusChange,
		onDateChange,
		onProjectChange,
		onPhaseChange,
		onPriorityChange,
		onAssigneeToggle,
		onLabelToggle,
		...view,
	};
}

describe("TrackerRow", () => {
	it("renders the kebab trigger with lg:hidden when field handlers exist", () => {
		renderRow();

		const kebab = screen.getByRole("button", { name: "More properties" });
		expect(kebab.className).toContain("lg:hidden");
		expect(kebab.getAttribute("data-testid")).toBe("row-more-CA-1");
	});

	it("renders no kebab trigger when all six field handlers are omitted", () => {
		renderRow({
			onDateChange: undefined,
			onProjectChange: undefined,
			onPhaseChange: undefined,
			onPriorityChange: undefined,
			onAssigneeToggle: undefined,
			onLabelToggle: undefined,
		});

		expect(
			screen.queryByRole("button", { name: "More properties" }),
		).toBeNull();
	});

	it("does not render project or phase editors without their callbacks", () => {
		renderRow({
			onProjectChange: undefined,
			onPhaseChange: undefined,
		});

		expect(screen.queryByTestId("row-inline-project-CA-1")).toBeNull();
		expect(screen.queryByTestId("row-inline-phase-CA-1")).toBeNull();
	});

	it("preserves omitted optional section capabilities", () => {
		const group: TrackerGroup = {
			key: "status:1",
			label: "Backlog",
			items: [defaultItem],
			status: statuses[0],
		};
		render(
			<TrackerSection
				group={group}
				statuses={statuses}
				priorities={priorities}
				collapsed={false}
				onToggle={vi.fn()}
				onStatusChange={vi.fn()}
				onDateChange={vi.fn()}
				projects={[releaseProject]}
				members={members}
				labels={labels}
				labelsLoadState="ready"
				membersLoadState="ready"
				onAssigneeToggle={vi.fn()}
				onLabelToggle={vi.fn()}
			/>,
		);

		expect(screen.queryByTestId("row-inline-project-CA-1")).toBeNull();
		expect(screen.queryByTestId("row-inline-phase-CA-1")).toBeNull();
		expect(screen.queryByTestId("row-inline-priority-CA-1")).toBeNull();
	});

	it("keeps inline editors behind the large-screen breakpoint", () => {
		renderRow();

		expect(screen.getByTestId("row-inline-priority-CA-1").className).toContain(
			"lg:block",
		);
		expect(screen.getByTestId("row-inline-project-CA-1").className).toContain(
			"lg:block",
		);
		expect(screen.getByTestId("row-inline-phase-CA-1").className).toContain(
			"lg:block",
		);
		expect(screen.getByTestId("row-inline-labels-CA-1").className).toContain(
			"lg:flex",
		);
		expect(screen.getByTestId("row-inline-assignees-CA-1").className).toContain(
			"lg:flex",
		);
	});

	it("keeps an invalid date draft open when switching to another field", () => {
		const onDateChange = vi.fn();
		renderRow({ onDateChange });

		clickTrigger("date");
		fireEvent.change(screen.getByLabelText("Start date"), {
			target: { value: "2026-08-10" },
		});
		fireEvent.change(screen.getByLabelText("End date"), {
			target: { value: "2026-08-01" },
		});
		clickTrigger("project");

		expect(
			(screen.getByLabelText("Start date") as HTMLInputElement).value,
		).toBe("2026-08-10");
		expect(
			screen.getByText("End date must be on or after start date"),
		).toBeTruthy();
		expect(
			screen.queryByRole("combobox", { name: "Set project to…" }),
		).toBeNull();
		expect(onDateChange).not.toHaveBeenCalled();
	});

	describe("single-picker mutex", () => {
		const transitions: Array<{
			source: PickerKind;
			destination: PickerKind;
			draftDateEdit?: boolean;
		}> = [
			{ source: "status", destination: "date" },
			{ source: "date", destination: "project", draftDateEdit: true },
			{ source: "project", destination: "phase" },
			{ source: "phase", destination: "priority" },
			{ source: "priority", destination: "assignees" },
			{ source: "assignees", destination: "labels" },
			{ source: "labels", destination: "kebab" },
			{ source: "kebab", destination: "status" },
		];

		it.each(transitions)("closes $source and opens $destination", async ({
			source,
			destination,
			draftDateEdit,
		}) => {
			const onDateChange = vi.fn();
			renderRow({ onDateChange });

			clickTrigger(source);
			expectPickerOpen(source);

			if (draftDateEdit) {
				fireEvent.change(screen.getByLabelText("Start date"), {
					target: { value: "2026-08-06" },
				});
			}

			clickTrigger(destination);

			if (draftDateEdit) {
				expect(onDateChange).toHaveBeenCalledTimes(1);
				expect(onDateChange).toHaveBeenCalledWith({
					startDate: "2026-08-06",
					endDate: null,
				});
			}

			await waitFor(() => {
				expectPickerClosed(source);
				expectPickerOpen(destination);
			});

			if (destination === "kebab") {
				const panel = screen.getByRole("dialog", {
					name: "More properties for CA-1",
				});
				expect(
					within(panel).getByRole("button", {
						name: "Date: Set date",
					}),
				).toBeTruthy();
			}
		});
	});

	it('renders a clickable "Set project" placeholder when projectId is null', () => {
		const onProjectChange = vi.fn();
		renderRow({
			item: makeRowItem({ projectId: null, phaseId: null }),
			onProjectChange,
		});

		const projectTrigger = screen.getByRole("button", {
			name: "Project: Set project",
		});
		expect(projectTrigger.textContent).toContain("Set project");

		fireEvent.click(projectTrigger);
		expect(
			screen.getByRole("combobox", { name: "Set project to…" }),
		).toBeTruthy();
	});

	it('renders a clickable "Set phase" placeholder when phaseId is null', () => {
		const onPhaseChange = vi.fn();
		renderRow({
			item: makeRowItem({ phaseId: null }),
			onPhaseChange,
		});

		const phaseButton = screen.getByRole("button", {
			name: "Phase: Set phase",
		});
		expect(phaseButton.textContent).toContain("Set phase");

		fireEvent.click(phaseButton);
		expect(
			screen.getByRole("combobox", { name: "Set phase to…" }),
		).toBeTruthy();
	});

	it('renders a "Set date" placeholder when both dates are unset', () => {
		renderRow({
			item: makeRowItem({ startDate: null, endDate: null }),
		});

		const dateTrigger = screen.getByRole("button", { name: "Date: Set date" });
		expect(dateTrigger.textContent).toContain("Set date");
	});

	it("keeps picker state independent across two rows", async () => {
		const onAssigneeToggleA = vi.fn();
		const onAssigneeToggleB = vi.fn();

		render(
			<>
				<TrackerRow
					item={makeRowItem({ key: "CA-1" })}
					statuses={statuses}
					priorities={priorities}
					projects={[releaseProject]}
					labels={labels}
					members={members}
					onStatusChange={vi.fn()}
					onDateChange={vi.fn()}
					onProjectChange={vi.fn()}
					onPhaseChange={vi.fn()}
					onPriorityChange={vi.fn()}
					onAssigneeToggle={onAssigneeToggleA}
					onLabelToggle={vi.fn()}
				/>
				<TrackerRow
					item={makeRowItem({
						id: 2,
						key: "CA-2",
						title: "Second item",
					})}
					statuses={statuses}
					priorities={priorities}
					projects={[releaseProject]}
					labels={labels}
					members={members}
					onStatusChange={vi.fn()}
					onDateChange={vi.fn()}
					onProjectChange={vi.fn()}
					onPhaseChange={vi.fn()}
					onPriorityChange={vi.fn()}
					onAssigneeToggle={onAssigneeToggleB}
					onLabelToggle={vi.fn()}
				/>
			</>,
		);

		const rowA = screen.getByTestId("row-inline-assignees-CA-1");
		const rowB = screen.getByTestId("row-inline-assignees-CA-2");

		fireEvent.click(within(rowA).getByRole("button", { name: "Assignees" }));
		fireEvent.click(within(rowB).getByRole("button", { name: "Assignees" }));

		const comboboxes = screen.getAllByRole("combobox", {
			name: "Assign to…",
		});
		expect(comboboxes).toHaveLength(2);

		fireEvent.click(within(rowB).getByRole("option", { name: /Alice/ }));

		expect(onAssigneeToggleB).toHaveBeenCalledWith(7);
		expect(onAssigneeToggleA).not.toHaveBeenCalled();
		expect(
			within(rowA).getByRole("combobox", { name: "Assign to…" }),
		).toBeTruthy();
	});

	it("styles an unset row-size property differently from a chosen one", () => {
		renderRow();
		const chosen = screen.getByRole("button", { name: "Project: Rilis v2" });
		expect(chosen.className).toContain("text-neutral-700");
		expect(chosen.className).not.toContain("text-neutral-500");
		cleanup();

		renderRow({ item: makeRowItem({ projectId: null, phaseId: null }) });
		const unset = screen.getByRole("button", {
			name: "Project: Set project",
		});
		expect(unset.className).toContain("text-neutral-500");
		expect(unset.className).not.toContain("text-neutral-700");
	});

	it("renders assignees/labels as icon-only clusters, not visible name text", () => {
		renderRow();

		const assigneesField = screen.getByTestId("row-inline-assignees-CA-1");
		expect(
			within(assigneesField).getByTestId("row-avatar-stack-CA-1"),
		).toBeTruthy();
		expect(within(assigneesField).queryByText("Alice")).toBeNull();
		expect(
			within(assigneesField).getByRole("button", { name: "Assignees" }),
		).toBeTruthy();

		const labelsField = screen.getByTestId("row-inline-labels-CA-1");
		expect(within(labelsField).getByTestId("row-label-dots-CA-1")).toBeTruthy();
		expect(within(labelsField).queryByText("Feature")).toBeNull();
		expect(
			within(labelsField).getByRole("button", { name: "Labels" }),
		).toBeTruthy();
	});

	describe("row-size wrapper does not clip its own popover", () => {
		const rowSizeFields: Array<{
			kind: Exclude<PickerKind, "kebab" | "date" | "status">;
			testId: string;
			openQuery: { role: "combobox"; name: string };
		}> = [
			{
				kind: "project",
				testId: "row-inline-project-CA-1",
				openQuery: OPEN_QUERIES.project,
			},
			{
				kind: "phase",
				testId: "row-inline-phase-CA-1",
				openQuery: OPEN_QUERIES.phase,
			},
			{
				kind: "labels",
				testId: "row-inline-labels-CA-1",
				openQuery: OPEN_QUERIES.labels,
			},
			{
				kind: "assignees",
				testId: "row-inline-assignees-CA-1",
				openQuery: OPEN_QUERIES.assignees,
			},
		];

		it.each(
			rowSizeFields,
		)("$kind: fixed-width wrapper has no overflow-hidden, and its popover is reachable within the row (no portal)", async ({
			kind,
			testId,
			openQuery,
		}) => {
			renderRow();

			const wrapper = screen.getByTestId(testId);
			expect(wrapper.className).not.toMatch(/\boverflow-hidden\b/);

			clickTrigger(kind);
			await waitFor(() => {
				expect(
					within(wrapper).getByRole(openQuery.role, {
						name: openQuery.name,
					}),
				).toBeTruthy();
			});
		});
	});

	it("renders the same avatar-stack/dot-cluster helpers, with per-item name tooltips, when read-only", () => {
		renderRow({ onAssigneeToggle: undefined, onLabelToggle: undefined });

		const avatarStack = screen.getByTestId("row-avatar-stack-CA-1");
		expect(avatarStack.closest("button")).toBeNull();
		expect(screen.getByTitle("Alice")).toBeTruthy();
		expect(screen.queryByRole("combobox", { name: "Assign to…" })).toBeNull();

		const labelDots = screen.getByTestId("row-label-dots-CA-1");
		expect(labelDots.closest("button")).toBeNull();
		expect(screen.getByTitle("Feature")).toBeTruthy();
		expect(
			screen.queryByRole("combobox", { name: "Change or add labels…" }),
		).toBeNull();
	});

	it("renders read-only createdAt and isolates navigation from inline triggers", () => {
		renderRow({
			item: makeRowItem(),
			onDateChange: undefined,
		});

		const createdAt = new Date("2026-07-04T00:00:00Z").toLocaleDateString(
			undefined,
			{ month: "short", day: "numeric" },
		);
		const timeEl = screen.getByText(createdAt, { selector: "time" });
		expect(timeEl.tagName).toBe("TIME");
		expect(screen.queryByRole("button", { name: /Date:/ })).toBeNull();

		cleanup();
		renderRow();

		const triggers: PickerKind[] = [
			"date",
			"project",
			"phase",
			"priority",
			"assignees",
			"labels",
			"kebab",
		];
		for (const kind of triggers) {
			clickTrigger(kind);
			if (kind === "kebab") {
				expect(
					screen.getByRole("dialog", {
						name: "More properties for CA-1",
					}),
				).toBeTruthy();
				fireEvent.click(
					within(
						screen.getByRole("dialog", {
							name: "More properties for CA-1",
						}),
					).getByRole("button", { name: "Close properties panel" }),
				);
			} else {
				expectPickerOpen(kind);
				clickTrigger(kind);
				expectPickerClosed(kind);
			}
		}

		expect(mockNavigate).not.toHaveBeenCalled();

		const pointerAutoTargets = [
			screen.getByTestId("row-inline-priority-CA-1"),
			screen.getByRole("button", { name: "Backlog, CA-1" }).closest("span"),
			screen.getByTestId("row-inline-project-CA-1"),
			screen.getByTestId("row-inline-phase-CA-1"),
			screen.getByTestId("row-inline-labels-CA-1"),
			screen.getByTestId("row-inline-assignees-CA-1"),
			screen.getByRole("button", { name: "More properties" }).parentElement,
		];
		for (const el of pointerAutoTargets) {
			expect(el?.className).toContain("pointer-events-auto");
		}

		const dateWrapper = screen
			.getByRole("button", { name: "Date: Set date" })
			.closest("span");
		expect(dateWrapper?.className).toContain("pointer-events-auto");
	});

	describe("board items", () => {
		function makeBoardItem(overrides: Partial<WorkItem> = {}): WorkItem {
			return makeRowItem({
				id: 7,
				key: "TE-9",
				source: "board",
				columnId: 3,
				columnName: "In Progress",
				dueDate: "2026-08-15",
				startDate: null,
				endDate: null,
				...overrides,
			});
		}

		it("renders a board badge with column name", () => {
			renderRow({ item: makeBoardItem() });

			const badge = screen.getByTestId("row-board-badge-TE-9");
			expect(badge.textContent).toBe("In Progress");
			expect(badge.className).toContain("bg-primary-100");
		});

		it("falls back to Board when columnName is missing", () => {
			renderRow({ item: makeBoardItem({ columnName: null }) });

			expect(screen.getByTestId("row-board-badge-TE-9").textContent).toBe(
				"Board",
			);
		});

		it("shows formatted dueDate instead of createdAt", () => {
			renderRow({ item: makeBoardItem({ dueDate: "2026-08-15" }) });

			const dueEl = screen.getByTestId("row-board-due-TE-9");
			expect(dueEl.textContent).toBe("Aug 15");
			expect(dueEl.tagName).toBe("TIME");
			expect(dueEl.getAttribute("dateTime")).toBe("2026-08-15");

			const createdAt = new Date("2026-07-04T00:00:00Z").toLocaleDateString(
				undefined,
				{ month: "short", day: "numeric" },
			);
			expect(screen.queryByText(createdAt, { selector: "time" })).toBeNull();
		});

		it("shows a placeholder when dueDate is unset", () => {
			renderRow({ item: makeBoardItem({ dueDate: null }) });

			expect(screen.getByTestId("row-board-due-TE-9").textContent).toBe("—");
		});

		it("applies overdue styling for past-due board items", () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));

			renderRow({
				item: makeBoardItem({ dueDate: "2026-08-01", doneAt: null }),
			});

			expect(screen.getByTestId("row-board-due-TE-9").className).toContain(
				"bg-error-100",
			);

			vi.useRealTimers();
		});

		it("does not render a date popover for board items", () => {
			renderRow({ item: makeBoardItem() });

			expect(screen.queryByRole("button", { name: /Date:/ })).toBeNull();
		});

		it("keeps tracker item date behavior unchanged", () => {
			renderRow({ item: makeRowItem({ source: "tracker" }) });

			expect(screen.queryByTestId("row-board-badge-CA-1")).toBeNull();
			expect(screen.getByRole("button", { name: "Date: Set date" })).toBeTruthy();
		});
	});
});
