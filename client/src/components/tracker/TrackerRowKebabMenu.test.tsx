// client/src/components/tracker/TrackerRowKebabMenu.test.tsx — jsdom.

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	TrackerItem,
	TrackerPhase,
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import { TrackerRowKebabMenu } from "./TrackerRowKebabMenu";

afterEach(() => {
	cleanup();
});

const statuses: TrackerVocabulary[] = [
	{ id: 1, kind: "status", name: "Backlog", position: 1024, colour: "#eee" },
];
const priorities: TrackerVocabulary[] = [
	{ id: 10, kind: "priority", name: "High", position: 1024, colour: "#eee" },
	{ id: 11, kind: "priority", name: "Low", position: 2048, colour: "#eee" },
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

const idPrefix = "tracker-row-menu-CA-1";

function KebabHarness({
	props = {},
}: {
	props?: Partial<ComponentProps<typeof TrackerRowKebabMenu>>;
}) {
	const anchorRef = useRef<HTMLButtonElement>(null);
	const onOpenChange = props.onOpenChange ?? vi.fn();
	const handlers = {
		onDateChange: props.onDateChange ?? vi.fn(),
		onProjectChange: props.onProjectChange ?? vi.fn(),
		onPhaseChange: props.onPhaseChange ?? vi.fn(),
		onPriorityChange: props.onPriorityChange ?? vi.fn(),
		onAssigneeToggle: props.onAssigneeToggle ?? vi.fn(),
		onLabelToggle: props.onLabelToggle ?? vi.fn(),
	};
	for (const key of Object.keys(handlers) as (keyof typeof handlers)[]) {
		if (key in props && props[key] === undefined) {
			delete handlers[key];
		}
	}

	return (
		<>
			<button ref={anchorRef} type="button">
				Kebab anchor
			</button>
			<TrackerRowKebabMenu
				anchorRef={anchorRef}
				idPrefix={idPrefix}
				item={props.item ?? item}
				projects={[releaseProject]}
				priorities={priorities}
				labels={props.labels ?? labels}
				members={props.members ?? members}
				open={props.open ?? true}
				onOpenChange={onOpenChange}
				{...handlers}
			/>
		</>
	);
}

function renderKebab(
	props: Partial<ComponentProps<typeof TrackerRowKebabMenu>> = {},
) {
	const onOpenChange = props.onOpenChange ?? vi.fn();
	const view = render(<KebabHarness props={{ ...props, onOpenChange }} />);
	return { onOpenChange, ...view };
}

function getPanel() {
	return screen.getByRole("dialog", {
		name: "More properties for CA-1",
	});
}

describe("TrackerRowKebabMenu", () => {
	it("lists all 6 property triggers when open with every handler defined", () => {
		renderKebab();

		const panel = getPanel();
		const scope = within(panel);

		expect(scope.getByRole("button", { name: "Date: Set date" })).toBeTruthy();
		expect(
			scope.getByRole("button", { name: "Project: Rilis v2" }),
		).toBeTruthy();
		expect(
			scope.getByRole("button", { name: "Phase: Persiapan" }),
		).toBeTruthy();
		expect(scope.getByRole("button", { name: "Priority: High" })).toBeTruthy();
		expect(scope.getByRole("button", { name: "Assignees" })).toBeTruthy();
		expect(scope.getByRole("button", { name: "Labels" })).toBeTruthy();
	});

	it("omits phase when onPhaseChange is absent while other fields remain", () => {
		renderKebab({ onPhaseChange: undefined });

		const panel = getPanel();
		const scope = within(panel);

		expect(scope.getByRole("button", { name: "Date: Set date" })).toBeTruthy();
		expect(
			scope.getByRole("button", { name: "Project: Rilis v2" }),
		).toBeTruthy();
		expect(
			scope.queryByRole("button", { name: "Phase: Persiapan" }),
		).toBeNull();
		expect(scope.getByRole("button", { name: "Priority: High" })).toBeTruthy();
		expect(scope.getByRole("button", { name: "Assignees" })).toBeTruthy();
		expect(scope.getByRole("button", { name: "Labels" })).toBeTruthy();
	});

	describe("empty states and date-child lifecycle", () => {
		it("shows exact empty-state copy for empty labels and members arrays", () => {
			renderKebab({ labels: [], members: [] });

			const panel = getPanel();
			const scope = within(panel);

			expect(scope.getByText("No labels in this workspace")).toBeTruthy();
			expect(scope.getByText("No members in this workspace")).toBeTruthy();
		});

		it("commits date once when switching to another field after editing", () => {
			const onDateChange = vi.fn();
			renderKebab({ onDateChange });

			const panel = getPanel();
			const scope = within(panel);

			fireEvent.click(scope.getByRole("button", { name: "Date: Set date" }));
			fireEvent.change(screen.getByLabelText("Start date"), {
				target: { value: "2026-08-06" },
			});
			fireEvent.click(scope.getByRole("button", { name: "Priority: High" }));

			expect(onDateChange).toHaveBeenCalledTimes(1);
			expect(onDateChange).toHaveBeenCalledWith({
				startDate: "2026-08-06",
				endDate: null,
			});
		});

		it("keeps an invalid date draft open when switching to another field", () => {
			const onDateChange = vi.fn();
			renderKebab({ onDateChange });

			const panel = getPanel();
			const scope = within(panel);
			fireEvent.click(scope.getByRole("button", { name: "Date: Set date" }));
			fireEvent.change(screen.getByLabelText("Start date"), {
				target: { value: "2026-08-10" },
			});
			fireEvent.change(screen.getByLabelText("End date"), {
				target: { value: "2026-08-01" },
			});
			fireEvent.click(scope.getByRole("button", { name: "Priority: High" }));

			expect(
				(screen.getByLabelText("Start date") as HTMLInputElement).value,
			).toBe("2026-08-10");
			expect(
				screen.getByText("End date must be on or after start date"),
			).toBeTruthy();
			expect(
				screen.queryByRole("combobox", { name: "Change priority…" }),
			).toBeNull();
			expect(onDateChange).not.toHaveBeenCalled();
		});

		it("closes only the nested picker on Escape", () => {
			renderKebab();

			const panel = getPanel();
			fireEvent.click(
				within(panel).getByRole("button", { name: "Priority: High" }),
			);
			expect(
				screen.getByRole("combobox", { name: "Change priority…" }),
			).toBeTruthy();

			fireEvent.keyDown(
				screen.getByRole("combobox", { name: "Change priority…" }),
				{ key: "Escape" },
			);

			expect(getPanel()).toBeTruthy();
			expect(
				screen.queryByRole("combobox", { name: "Change priority…" }),
			).toBeNull();
		});

		it("makes the properties panel modal and traps focus", () => {
			renderKebab();

			const panel = getPanel();
			expect(panel.getAttribute("aria-modal")).toBe("true");

			const focusables = within(panel).getAllByRole("button");
			const first = focusables[0]!;
			const last = focusables.at(-1)!;
			expect(document.activeElement).toBe(first);

			last.focus();
			fireEvent.keyDown(panel, { key: "Tab" });
			expect(document.activeElement).toBe(first);

			first.focus();
			fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
			expect(document.activeElement).toBe(last);
		});

		it("focuses the start date when the date popover opens", () => {
			renderKebab();

			fireEvent.click(
				within(getPanel()).getByRole("button", { name: "Date: Set date" }),
			);

			expect(document.activeElement).toBe(screen.getByLabelText("Start date"));
		});

		it("keeps the panel open when clicking inside the portaled date fields", () => {
			renderKebab();

			const panel = getPanel();
			const scope = within(panel);

			fireEvent.click(scope.getByRole("button", { name: "Date: Set date" }));
			fireEvent.mouseDown(screen.getByLabelText("Start date"));

			expect(
				screen.getByRole("dialog", { name: "More properties for CA-1" }),
			).toBeTruthy();
		});

		it("commits date once when closing the panel with an open date field", () => {
			const onDateChange = vi.fn();
			const onOpenChange = vi.fn();
			renderKebab({ onDateChange, onOpenChange });

			const panel = getPanel();
			const scope = within(panel);

			fireEvent.click(scope.getByRole("button", { name: "Date: Set date" }));
			fireEvent.change(screen.getByLabelText("Start date"), {
				target: { value: "2026-08-06" },
			});
			fireEvent.click(
				scope.getByRole("button", { name: "Close properties panel" }),
			);

			expect(onDateChange).toHaveBeenCalledTimes(1);
			expect(onDateChange).toHaveBeenCalledWith({
				startDate: "2026-08-06",
				endDate: null,
			});
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});

		it("commits date once when pressing Escape with an open date field", () => {
			const onDateChange = vi.fn();
			const onOpenChange = vi.fn();
			renderKebab({ onDateChange, onOpenChange });

			const panel = getPanel();
			const scope = within(panel);

			fireEvent.click(scope.getByRole("button", { name: "Date: Set date" }));
			fireEvent.change(screen.getByLabelText("Start date"), {
				target: { value: "2026-08-06" },
			});
			fireEvent.keyDown(document, { key: "Escape" });

			expect(onDateChange).toHaveBeenCalledTimes(1);
			expect(onDateChange).toHaveBeenCalledWith({
				startDate: "2026-08-06",
				endDate: null,
			});
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});

		it("returns focus to the kebab anchor when the panel closes", () => {
			const onOpenChange = vi.fn();
			const anchorRef = { current: null as HTMLButtonElement | null };
			const { rerender } = render(
				<>
					<button
						ref={(node) => {
							anchorRef.current = node;
						}}
						type="button"
					>
						Kebab anchor
					</button>
					<TrackerRowKebabMenu
						anchorRef={anchorRef}
						idPrefix={idPrefix}
						item={item}
						projects={[releaseProject]}
						priorities={priorities}
						labels={labels}
						members={members}
						open={true}
						onOpenChange={onOpenChange}
						onDateChange={vi.fn()}
						onProjectChange={vi.fn()}
						onPhaseChange={vi.fn()}
						onPriorityChange={vi.fn()}
						onAssigneeToggle={vi.fn()}
						onLabelToggle={vi.fn()}
					/>
				</>,
			);

			const panel = getPanel();
			fireEvent.click(
				within(panel).getByRole("button", { name: "Close properties panel" }),
			);

			expect(onOpenChange).toHaveBeenCalledWith(false);

			rerender(
				<>
					<button
						ref={(node) => {
							anchorRef.current = node;
						}}
						type="button"
					>
						Kebab anchor
					</button>
					<TrackerRowKebabMenu
						anchorRef={anchorRef}
						idPrefix={idPrefix}
						item={item}
						projects={[releaseProject]}
						priorities={priorities}
						labels={labels}
						members={members}
						open={false}
						onOpenChange={onOpenChange}
						onDateChange={vi.fn()}
						onProjectChange={vi.fn()}
						onPhaseChange={vi.fn()}
						onPriorityChange={vi.fn()}
						onAssigneeToggle={vi.fn()}
						onLabelToggle={vi.fn()}
					/>
				</>,
			);

			expect(document.activeElement).toBe(anchorRef.current);
		});
	});
});
