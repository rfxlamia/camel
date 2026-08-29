import { sortStatusesByPosition, formatDateRange, NO_PRIORITY } from "../../lib/trackerUtils";
import type {
	TrackerItem,
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import {
	Avatar,
	LabelDot,
	PriorityGlyph,
	priorityBars,
} from "./TrackerGlyphs";
import type { PickerOption } from "./TrackerPropertyPicker";

export interface TrackerRowPickerContext {
	item: TrackerItem;
	projects?: TrackerProject[];
	priorities: TrackerVocabulary[];
	labels?: TrackerVocabulary[];
	members?: WorkspaceMember[];
}

export function buildTrackerRowPickerState({
	item,
	projects,
	priorities,
	labels,
	members,
}: TrackerRowPickerContext) {
	const selectedProject = projects?.find((p) => p.id === item.projectId);
	const selectedPhase = selectedProject?.phases.find(
		(p) => p.id === item.phaseId,
	);
	const dateLabel =
		formatDateRange(item.startDate ?? null, item.endDate ?? null) ??
		"Set date";
	const projectLabel = selectedProject?.name ?? "Set project";
	const phaseLabel = selectedPhase?.name ?? "Set phase";

	const projectOptions: PickerOption[] =
		projects?.map((p) => ({
			id: String(p.id),
			label: p.name,
			selected: p.id === item.projectId,
		})) ?? [];

	const phaseOptions: PickerOption[] = (selectedProject?.phases ?? []).map(
		(ph) => ({
			id: String(ph.id),
			label: ph.name,
			selected: ph.id === item.phaseId,
		}),
	);

	const orderedPriorities = sortStatusesByPosition(priorities);
	const priorityLabel = item.priority?.name ?? "No priority";
	const bars = item.priority
		? priorityBars(orderedPriorities, item.priority.id)
		: 0;

	const priorityOptions: PickerOption[] = [
		{
			id: NO_PRIORITY,
			label: "No priority",
			selected: item.priority === null,
			icon: <PriorityGlyph bars={0} size={13} />,
		},
		...orderedPriorities.map((priority) => ({
			id: String(priority.id),
			label: priority.name,
			selected: priority.id === item.priority?.id,
			icon: (
				<PriorityGlyph
					bars={priorityBars(orderedPriorities, priority.id)}
					size={13}
				/>
			),
		})),
	];

	const assigneeIds = item.assignees.map((a) => a.id);
	const assigneeOptions: PickerOption[] =
		members?.map((m) => ({
			id: String(m.userId),
			label: m.displayName,
			hint: `@${m.username}`,
			selected: assigneeIds.includes(m.userId),
			icon: <Avatar name={m.displayName} />,
		})) ?? [];

	const assigneeValue =
		item.assignees.length === 0
			? undefined
			: item.assignees.length === 1
				? item.assignees[0].displayName
				: `${item.assignees[0].displayName} +${item.assignees.length - 1}`;

	const orderedLabels = labels ? sortStatusesByPosition(labels) : [];
	const labelOptions: PickerOption[] = orderedLabels.map((l) => ({
		id: String(l.id),
		label: l.name,
		selected: item.labels.some((label) => label.id === l.id),
		icon: <LabelDot colour={l.colour} />,
	}));

	const labelValue =
		item.labels.length === 0
			? undefined
			: item.labels.length === 1
				? item.labels[0].name
				: `${item.labels[0].name} +${item.labels.length - 1}`;

	return {
		selectedProject,
		selectedPhase,
		dateLabel,
		projectLabel,
		phaseLabel,
		priorityLabel,
		bars,
		projectOptions,
		phaseOptions,
		priorityOptions,
		assigneeOptions,
		assigneeValue,
		labelOptions,
		labelValue,
	};
}
