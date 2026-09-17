import type { RefObject } from "react";
import { createPortal } from "react-dom";
import type {
	TrackerItem,
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import { TrackerRowKebabMenuFields } from "./TrackerRowKebabMenuFields";
import type { TrackerAuxiliaryLoadState } from "./trackerAuxiliaryState";
import { useTrackerRowKebabMenuChrome } from "./trackerRowKebabMenuChrome";

export interface TrackerRowKebabMenuProps {
	anchorRef: RefObject<HTMLElement>;
	idPrefix: string;
	item: TrackerItem;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projects?: TrackerProject[];
	priorities: TrackerVocabulary[];
	labels?: TrackerVocabulary[];
	members?: WorkspaceMember[];
	labelsLoadState?: TrackerAuxiliaryLoadState;
	membersLoadState?: TrackerAuxiliaryLoadState;
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

export function TrackerRowKebabMenu({
	anchorRef,
	idPrefix,
	item,
	open,
	onOpenChange,
	projects,
	priorities,
	labels,
	members,
	labelsLoadState,
	membersLoadState,
	onDateChange,
	onProjectChange,
	onPhaseChange,
	onPriorityChange,
	onAssigneeToggle,
	onLabelToggle,
}: TrackerRowKebabMenuProps) {
	const {
		panelRef,
		panelCoords,
		activeField,
		requestField,
		closePanel,
		datePopoverRef,
	} = useTrackerRowKebabMenuChrome({
		anchorRef,
		idPrefix,
		open,
		onOpenChange,
	});

	if (!open) return null;

	return createPortal(
		<div
			ref={panelRef}
			role="dialog"
			aria-label={`More properties for ${item.key}`}
			aria-modal="true"
			tabIndex={-1}
			onKeyDown={(event) => {
				if (event.key !== "Tab") return;
				const focusableElements = Array.from(
					event.currentTarget.querySelectorAll<HTMLElement>(
						'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
					),
				);
				if (focusableElements.length === 0) return;
				const first = focusableElements[0]!;
				const last = focusableElements.at(-1)!;
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first.focus();
				}
			}}
			style={{
				position: "fixed",
				top: panelCoords?.top ?? 0,
				left: panelCoords?.left ?? 0,
				zIndex: 50,
			}}
			className="w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-[0_8px_24px_rgba(23,42,62,0.12)]"
		>
			<div className="mb-3 flex items-center justify-between gap-2">
				<h2 className="font-medium text-neutral-900 text-sm">Properties</h2>
				<button
					type="button"
					aria-label="Close properties panel"
					onClick={closePanel}
					className="rounded-md px-2 py-1 text-neutral-600 text-xs hover:bg-neutral-100"
				>
					Close
				</button>
			</div>

			<TrackerRowKebabMenuFields
				idPrefix={idPrefix}
				item={item}
				activeField={activeField}
				requestField={requestField}
				datePopoverRef={datePopoverRef}
				projects={projects}
				priorities={priorities}
				labels={labels}
				members={members}
				labelsLoadState={labelsLoadState}
				membersLoadState={membersLoadState}
				{...(onDateChange ? { onDateChange } : {})}
				{...(onProjectChange ? { onProjectChange } : {})}
				{...(onPhaseChange ? { onPhaseChange } : {})}
				{...(onPriorityChange ? { onPriorityChange } : {})}
				{...(onAssigneeToggle ? { onAssigneeToggle } : {})}
				{...(onLabelToggle ? { onLabelToggle } : {})}
			/>
		</div>,
		document.body,
	);
}
