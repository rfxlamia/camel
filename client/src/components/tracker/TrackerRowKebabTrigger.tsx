import type { RefObject } from "react";
import type {
	TrackerItem,
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import { TrackerRowKebabMenu } from "./TrackerRowKebabMenu";

type OpenPicker =
	| "date"
	| "status"
	| "priority"
	| "project"
	| "phase"
	| "assignees"
	| "labels"
	| "kebab"
	| null;

export interface TrackerRowKebabTriggerProps {
	item: TrackerItem;
	kebabRef: RefObject<HTMLButtonElement>;
	openPicker: OpenPicker;
	requestPicker: (next: OpenPicker) => void;
	projects?: TrackerProject[];
	priorities: TrackerVocabulary[];
	labels?: TrackerVocabulary[];
	members?: WorkspaceMember[];
	onDateChange?: (dates: {
		startDate: string | null;
		endDate: string | null;
	}) => void;
	onProjectChange?: (projectId: number) => void;
	onPhaseChange?: (phaseId: number) => void;
	onPriorityChange?: (priorityId: number | null) => void;
	onAssigneeToggle?: (toggledId: number) => void;
	onLabelToggle?: (toggledId: number) => void;
}

export function TrackerRowKebabTrigger({
	item,
	kebabRef,
	openPicker,
	requestPicker,
	projects,
	priorities,
	labels,
	members,
	onDateChange,
	onProjectChange,
	onPhaseChange,
	onPriorityChange,
	onAssigneeToggle,
	onLabelToggle,
}: TrackerRowKebabTriggerProps) {
	const hasKebabHandlers = Boolean(
		onDateChange ||
			onProjectChange ||
			onPhaseChange ||
			onPriorityChange ||
			onAssigneeToggle ||
			onLabelToggle,
	);

	if (!hasKebabHandlers) return null;

	return (
		<span className="pointer-events-auto shrink-0">
			<button
				ref={kebabRef}
				type="button"
				aria-label="More properties"
				aria-haspopup="dialog"
				aria-expanded={openPicker === "kebab"}
				data-testid={`row-more-${item.key}`}
				onClick={() =>
					requestPicker(openPicker === "kebab" ? null : "kebab")
				}
				className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-200 lg:hidden"
			>
				<span aria-hidden>⋯</span>
			</button>
			<TrackerRowKebabMenu
				anchorRef={kebabRef}
				idPrefix={`tracker-row-menu-${item.key}`}
				item={item}
				open={openPicker === "kebab"}
				onOpenChange={(open) => requestPicker(open ? "kebab" : null)}
				projects={projects}
				priorities={priorities}
				labels={labels}
				members={members}
				{...(onDateChange ? { onDateChange } : {})}
				{...(onProjectChange ? { onProjectChange } : {})}
				{...(onPhaseChange ? { onPhaseChange } : {})}
				{...(onPriorityChange ? { onPriorityChange } : {})}
				{...(onAssigneeToggle ? { onAssigneeToggle } : {})}
				{...(onLabelToggle ? { onLabelToggle } : {})}
			/>
		</span>
	);
}
