// client/src/components/tracker/TrackerRow.test.tsx — jsdom.
import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	TrackerItem,
	TrackerPhase,
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import TrackerRow from "./TrackerRow";

vi.mock("react-router", () => ({
	useNavigate: () => vi.fn(),
}));

afterEach(() => {
	cleanup();
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

const item: TrackerItem = {
	id: 1,
	key: "CA-1",
	title: "Workspace Rename",
	description: "",
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
};

function renderRow(
	overrides: Partial<ComponentProps<typeof TrackerRow>> = {},
) {
	return render(
		<TrackerRow
			item={item}
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
			onAssigneeToggle={vi.fn()}
			onLabelToggle={vi.fn()}
			{...overrides}
		/>,
	);
}

describe("TrackerRow", () => {
	it("renders the kebab trigger with lg:hidden when field handlers exist", () => {
		renderRow();

		const kebab = screen.getByRole("button", { name: "More properties" });
		expect(kebab.className).toContain("lg:hidden");
		expect(kebab.getAttribute("data-testid")).toBe("row-more-CA-1");
	});
});
