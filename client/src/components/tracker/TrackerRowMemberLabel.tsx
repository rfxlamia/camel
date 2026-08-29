import { Tag, UserRound } from "lucide-react";
import { sortStatusesByPosition } from "../../lib/trackerUtils";
import type {
	TrackerItem,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import { Avatar, LabelDot } from "./TrackerGlyphs";
import {
	type PickerOption,
	TrackerPropertyPicker,
} from "./TrackerPropertyPicker";
import {
	type TrackerAuxiliaryLoadState,
	trackerAuxiliaryMessage,
} from "./trackerAuxiliaryState";

function buildAssigneeOptions(
	members: WorkspaceMember[] | undefined,
	item: TrackerItem,
): PickerOption[] {
	const assigneeIds = item.assignees.map((a) => a.id);
	return (
		members?.map((m) => ({
			id: String(m.userId),
			label: m.displayName,
			hint: `@${m.username}`,
			selected: assigneeIds.includes(m.userId),
			icon: <Avatar name={m.displayName} />,
		})) ?? []
	);
}

function buildAssigneeDisplayValue(item: TrackerItem): string | undefined {
	if (item.assignees.length === 0) return undefined;
	if (item.assignees.length === 1) return item.assignees[0].displayName;
	return `${item.assignees[0].displayName} +${item.assignees.length - 1}`;
}

function buildLabelOptions(
	labels: TrackerVocabulary[] | undefined,
	item: TrackerItem,
): PickerOption[] {
	const orderedLabels = labels ? sortStatusesByPosition(labels) : [];
	return orderedLabels.map((l) => ({
		id: String(l.id),
		label: l.name,
		selected: item.labels.some((label) => label.id === l.id),
		icon: <LabelDot colour={l.colour} />,
	}));
}

function buildLabelDisplayValue(item: TrackerItem): string | undefined {
	if (item.labels.length === 0) return undefined;
	if (item.labels.length === 1) return item.labels[0].name;
	return `${item.labels[0].name} +${item.labels.length - 1}`;
}

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
					className="pointer-events-auto hidden shrink-0 items-center lg:flex"
				>
					{effectiveLabelsLoadState === "ready" && labels.length > 0 ? (
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
							open={labelsOpen}
							onOpenChange={onLabelsOpenChange}
							onSelect={(id) => onLabelToggle(Number(id))}
							multiple
							size="compact"
						/>
					) : (
						<span className="px-1 text-neutral-500 text-xs">
							{trackerAuxiliaryMessage("labels", effectiveLabelsLoadState)}
						</span>
					)}
				</span>
			) : (
				<div className="hidden shrink-0 items-center gap-1.5 sm:flex">
					{item.labels.map((label) => (
						<span
							key={label.id}
							className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 py-0.5 pr-2 pl-1.5 text-neutral-600 text-xs"
						>
							<LabelDot colour={label.colour} />
							{label.name}
						</span>
					))}
				</div>
			)}
			{members !== undefined && onAssigneeToggle ? (
				<span
					data-testid={`row-inline-assignees-${item.key}`}
					className="pointer-events-auto hidden shrink-0 items-center lg:flex"
				>
					{effectiveMembersLoadState === "ready" && members.length > 0 ? (
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
							open={assigneesOpen}
							onOpenChange={onAssigneesOpenChange}
							onSelect={(id) => onAssigneeToggle(Number(id))}
							multiple
							size="compact"
						/>
					) : (
						<span className="px-1 text-neutral-500 text-xs">
							{trackerAuxiliaryMessage("members", effectiveMembersLoadState)}
						</span>
					)}
				</span>
			) : (
				<div className="-space-x-1 hidden w-12 shrink-0 items-center justify-end md:flex">
					{item.assignees.length === 0 ? (
						<span
							className="h-[18px] w-[18px] rounded-full border border-neutral-300 border-dashed"
							aria-hidden
						/>
					) : (
						item.assignees.slice(0, 2).map((a) => (
							<span key={a.id} title={a.displayName} className="flex">
								<Avatar name={a.displayName} size={18} />
							</span>
						))
					)}
				</div>
			)}
		</>
	);
}
