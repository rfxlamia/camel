import type {
	TrackerItem,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import { AvatarStack, LabelDotCluster } from "../../shared/TrackerGlyphs";
import { TrackerPropertyPicker } from "../../shared/TrackerPropertyPicker";
import {
	type TrackerAuxiliaryLoadState,
	trackerAuxiliaryMessage,
} from "./trackerAuxiliaryState";
import {
	buildAssigneeDisplayValue,
	buildAssigneeOptions,
	buildLabelDisplayValue,
	buildLabelOptions,
} from "./trackerRowPickerOptions";

interface Props {
	item: TrackerItem;
	labels?: TrackerVocabulary[];
	members?: WorkspaceMember[];
	labelsLoadState?: TrackerAuxiliaryLoadState;
	membersLoadState?: TrackerAuxiliaryLoadState;
	onLabelToggle?: (toggledId: number) => void;
	onAssigneeToggle?: (toggledId: number) => void;
	labelsOpen: boolean;
	assigneesOpen: boolean;
	onLabelsOpenChange: (open: boolean) => void;
	onAssigneesOpenChange: (open: boolean) => void;
}

export function TrackerRowMemberLabelFields({
	item,
	labels,
	members,
	onLabelToggle,
	onAssigneeToggle,
	labelsOpen,
	assigneesOpen,
	onLabelsOpenChange,
	onAssigneesOpenChange,
	labelsLoadState,
	membersLoadState,
}: Props) {
	const effectiveLabelsLoadState =
		labelsLoadState ?? (labels === undefined ? "loading" : "ready");
	const effectiveMembersLoadState =
		membersLoadState ?? (members === undefined ? "loading" : "ready");
	const labelOptions = buildLabelOptions(labels, item);
	const labelValue = buildLabelDisplayValue(item);
	const assigneeOptions = buildAssigneeOptions(members, item);
	const assigneeValue = buildAssigneeDisplayValue(item);

	return (
		<>
			{labels !== undefined && onLabelToggle ? (
				<span
					data-testid={`row-inline-labels-${item.key}`}
					className="pointer-events-auto hidden w-14 shrink-0 items-center lg:flex"
				>
					{effectiveLabelsLoadState === "ready" && labels.length > 0 ? (
						<TrackerPropertyPicker
							placeholder="Labels"
							value={labelValue}
							triggerLabel="Labels"
							icon={
								<LabelDotCluster
									labels={item.labels}
									testId={`row-label-dots-${item.key}`}
								/>
							}
							searchPlaceholder="Change or add labels…"
							options={labelOptions}
							open={labelsOpen}
							onOpenChange={onLabelsOpenChange}
							onSelect={(id) => onLabelToggle(Number(id))}
							multiple
							size="row"
							iconOnly
						/>
					) : (
						<span className="w-full min-w-0 truncate px-1 text-neutral-500 text-xs">
							{trackerAuxiliaryMessage("labels", effectiveLabelsLoadState)}
						</span>
					)}
				</span>
			) : (
				<div className="hidden w-14 shrink-0 items-center overflow-hidden sm:flex">
					<LabelDotCluster
						labels={item.labels}
						testId={`row-label-dots-${item.key}`}
					/>
				</div>
			)}
			{members !== undefined && onAssigneeToggle ? (
				<span
					data-testid={`row-inline-assignees-${item.key}`}
					className="pointer-events-auto hidden w-12 shrink-0 items-center lg:flex"
				>
					{effectiveMembersLoadState === "ready" && members.length > 0 ? (
						<TrackerPropertyPicker
							placeholder="Assignees"
							value={assigneeValue}
							triggerLabel="Assignees"
							icon={
								<AvatarStack
									members={item.assignees}
									testId={`row-avatar-stack-${item.key}`}
								/>
							}
							searchPlaceholder="Assign to…"
							options={assigneeOptions}
							open={assigneesOpen}
							onOpenChange={onAssigneesOpenChange}
							onSelect={(id) => onAssigneeToggle(Number(id))}
							multiple
							size="row"
							iconOnly
						/>
					) : (
						<span className="w-full min-w-0 truncate px-1 text-neutral-500 text-xs">
							{trackerAuxiliaryMessage("members", effectiveMembersLoadState)}
						</span>
					)}
				</span>
			) : (
				<div className="hidden w-12 shrink-0 items-center justify-end overflow-hidden md:flex">
					<AvatarStack
						members={item.assignees}
						testId={`row-avatar-stack-${item.key}`}
					/>
				</div>
			)}
		</>
	);
}
