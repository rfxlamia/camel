import {
	Avatar,
	LabelDot,
	PriorityGlyph,
	priorityBars,
	StatusGlyph,
	statusGlyphSpec,
} from "../../shared/TrackerGlyphs";
import type { PickerOption } from "../../shared/TrackerPropertyPicker";
import type { TaskMetadataDraft } from "../../shared/taskMetadataDraft";
import { NO_PRIORITY } from "../../shared/trackerUtils";
import type {
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";

export const summarise = (names: string[]) =>
	names.length === 0
		? undefined
		: names.length === 1
			? names[0]
			: `${names[0]} +${names.length - 1}`;

export function buildCreateStatusOptions(
	orderedStatuses: TrackerVocabulary[],
	draft: TaskMetadataDraft,
): PickerOption[] {
	return orderedStatuses.map((s) => ({
		id: String(s.id),
		label: s.name,
		selected: s.id === draft.statusId,
		icon: <StatusGlyph spec={statusGlyphSpec(orderedStatuses, s.id)} />,
	}));
}

export function buildCreatePriorityOptions(
	orderedPriorities: TrackerVocabulary[],
	draft: TaskMetadataDraft,
): PickerOption[] {
	return [
		{
			id: NO_PRIORITY,
			label: "No priority",
			selected: draft.priorityId === null,
			icon: <PriorityGlyph bars={0} />,
		},
		...orderedPriorities.map((p) => ({
			id: String(p.id),
			label: p.name,
			selected: p.id === draft.priorityId,
			icon: <PriorityGlyph bars={priorityBars(orderedPriorities, p.id)} />,
		})),
	];
}

export function buildCreateLabelOptions(
	labels: TrackerVocabulary[],
	draft: TaskMetadataDraft,
): PickerOption[] {
	return labels.map((l) => ({
		id: String(l.id),
		label: l.name,
		selected: draft.labelIds.includes(l.id),
		icon: <LabelDot colour={l.colour} />,
	}));
}

export function buildCreateAssigneeOptions(
	members: WorkspaceMember[],
	draft: TaskMetadataDraft,
): PickerOption[] {
	return members.map((m) => ({
		id: String(m.userId),
		label: m.displayName,
		hint: `@${m.username}`,
		selected: draft.assigneeIds.includes(m.userId),
		icon: <Avatar name={m.displayName} />,
	}));
}

export function buildCreateProjectOptions(
	projects: TrackerProject[],
	draft: TaskMetadataDraft,
): PickerOption[] {
	return projects.map((p) => ({
		id: String(p.id),
		label: p.name,
		selected: p.id === draft.projectId,
	}));
}

export function buildCreatePhaseOptions(
	selectedProject: TrackerProject | undefined,
	draft: TaskMetadataDraft,
): PickerOption[] {
	return (selectedProject?.phases ?? []).map((ph) => ({
		id: String(ph.id),
		label: ph.name,
		selected: ph.id === draft.phaseId,
	}));
}
