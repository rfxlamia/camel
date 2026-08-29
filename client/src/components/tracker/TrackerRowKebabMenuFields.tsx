import { Folder, Signpost, Tag, UserRound } from "lucide-react";
import type { RefObject } from "react";
import { NO_PRIORITY } from "../../lib/trackerUtils";
import type {
	TrackerItem,
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import { Avatar, LabelDot, PriorityGlyph } from "./TrackerGlyphs";
import { TrackerPropertyPicker } from "./TrackerPropertyPicker";
import {
	TrackerRowDatePopover,
	type TrackerRowDatePopoverHandle,
} from "./TrackerRowDatePopover";
import {
	type TrackerAuxiliaryLoadState,
	trackerAuxiliaryMessage,
} from "./trackerAuxiliaryState";
import type { KebabActiveField } from "./trackerRowKebabMenuChrome";
import { buildTrackerRowPickerState } from "./trackerRowPickerOptions";

export interface TrackerRowKebabMenuFieldsProps {
	idPrefix: string;
	item: TrackerItem;
	activeField: KebabActiveField;
	requestField: (next: KebabActiveField) => void;
	datePopoverRef: RefObject<TrackerRowDatePopoverHandle>;
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

export function TrackerRowKebabMenuFields({
	idPrefix,
	item,
	activeField,
	requestField,
	datePopoverRef,
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
}: TrackerRowKebabMenuFieldsProps) {
	const effectiveLabelsLoadState =
		labelsLoadState ?? (labels === undefined ? "loading" : "ready");
	const effectiveMembersLoadState =
		membersLoadState ?? (members === undefined ? "loading" : "ready");
	const {
		selectedProject,
		selectedPhase,
		dateLabel,
		projectLabel,
		phaseLabel,
		priorityLabel,
		bars: priorityBarsCount,
		projectOptions,
		phaseOptions,
		priorityOptions,
		assigneeOptions,
		assigneeValue,
		labelOptions,
		labelValue,
	} = buildTrackerRowPickerState({
		item,
		projects,
		priorities,
		labels,
		members,
	});

	return (
		<div className="flex flex-col gap-2">
			{onDateChange ? (
				<TrackerRowDatePopover
					ref={datePopoverRef}
					startDate={item.startDate ?? null}
					endDate={item.endDate ?? null}
					triggerLabel={dateLabel}
					idPrefix={idPrefix}
					open={activeField === "date"}
					onOpenChange={(nextOpen) => requestField(nextOpen ? "date" : null)}
					onCommit={onDateChange}
				/>
			) : null}

			{onProjectChange ? (
				<div data-testid={`${idPrefix}-project`}>
					<TrackerPropertyPicker
						placeholder="Set project"
						value={selectedProject?.name}
						triggerLabel={`Project: ${projectLabel}`}
						icon={
							<Folder
								size={12}
								className="shrink-0 text-primary-700"
								aria-hidden
							/>
						}
						searchPlaceholder="Set project to…"
						options={projectOptions}
						open={activeField === "project"}
						onOpenChange={(nextOpen) =>
							requestField(nextOpen ? "project" : null)
						}
						onSelect={(id) => onProjectChange(Number(id))}
						size="compact"
					/>
				</div>
			) : null}

			{onPhaseChange ? (
				<div data-testid={`${idPrefix}-phase`}>
					<TrackerPropertyPicker
						placeholder="Set phase"
						value={selectedPhase?.name}
						triggerLabel={`Phase: ${phaseLabel}`}
						icon={
							<Signpost
								size={12}
								className="shrink-0 text-primary-700"
								aria-hidden
							/>
						}
						searchPlaceholder="Set phase to…"
						options={phaseOptions}
						open={activeField === "phase"}
						onOpenChange={(nextOpen) => requestField(nextOpen ? "phase" : null)}
						onSelect={(id) => onPhaseChange(Number(id))}
						size="compact"
					/>
				</div>
			) : null}

			{onPriorityChange ? (
				<div data-testid={`${idPrefix}-priority`}>
					<TrackerPropertyPicker
						placeholder="Priority"
						value={item.priority?.name}
						triggerLabel={`Priority: ${priorityLabel}`}
						icon={<PriorityGlyph bars={priorityBarsCount} size={13} />}
						searchPlaceholder="Change priority…"
						options={priorityOptions}
						open={activeField === "priority"}
						onOpenChange={(nextOpen) =>
							requestField(nextOpen ? "priority" : null)
						}
						onSelect={(id) =>
							onPriorityChange(id === NO_PRIORITY ? null : Number(id))
						}
						size="compact"
					/>
				</div>
			) : null}

			{onAssigneeToggle ? (
				<div data-testid={`${idPrefix}-assignees`}>
					{effectiveMembersLoadState === "ready" &&
					members &&
					members.length > 0 ? (
						<TrackerPropertyPicker
							placeholder="Assignees"
							value={assigneeValue}
							triggerLabel="Assignees"
							icon={
								item.assignees.length > 0 ? (
									<Avatar name={item.assignees[0].displayName} size={16} />
								) : (
									<UserRound
										size={14}
										className="shrink-0 text-neutral-500"
										aria-hidden
									/>
								)
							}
							searchPlaceholder="Assign to…"
							options={assigneeOptions}
							open={activeField === "assignee"}
							onOpenChange={(nextOpen) =>
								requestField(nextOpen ? "assignee" : null)
							}
							onSelect={(id) => onAssigneeToggle(Number(id))}
							multiple
							size="compact"
						/>
					) : (
						<p className="px-1 text-neutral-500 text-xs">
							{trackerAuxiliaryMessage("members", effectiveMembersLoadState)}
						</p>
					)}
				</div>
			) : null}

			{onLabelToggle ? (
				<div data-testid={`${idPrefix}-labels`}>
					{effectiveLabelsLoadState === "ready" &&
					labels &&
					labels.length > 0 ? (
						<TrackerPropertyPicker
							placeholder="Labels"
							value={labelValue}
							triggerLabel="Labels"
							icon={
								item.labels.length > 0 ? (
									<LabelDot colour={item.labels[0].colour} />
								) : (
									<Tag
										size={12}
										className="shrink-0 text-neutral-500"
										aria-hidden
									/>
								)
							}
							searchPlaceholder="Change or add labels…"
							options={labelOptions}
							open={activeField === "label"}
							onOpenChange={(nextOpen) =>
								requestField(nextOpen ? "label" : null)
							}
							onSelect={(id) => onLabelToggle(Number(id))}
							multiple
							size="compact"
						/>
					) : (
						<p className="px-1 text-neutral-500 text-xs">
							{trackerAuxiliaryMessage("labels", effectiveLabelsLoadState)}
						</p>
					)}
				</div>
			) : null}
		</div>
	);
}
