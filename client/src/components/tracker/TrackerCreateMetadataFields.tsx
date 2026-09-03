import { Folder, Signpost, Tag, UserRound } from "lucide-react";
import { useMemo } from "react";
import { NO_PRIORITY, sortStatusesByPosition } from "../../lib/trackerUtils";
import type {
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import type { TaskMetadataAction, TaskMetadataDraft } from "../task-entry/taskMetadataDraft";
import {
	Avatar,
	LabelDot,
	PriorityGlyph,
	StatusGlyph,
	priorityBars,
	statusGlyphSpec,
} from "./TrackerGlyphs";
import {
	type PickerOption,
	TrackerPropertyPicker,
} from "./TrackerPropertyPicker";

export type TrackerCreatePickerName =
	| "status"
	| "priority"
	| "assignees"
	| "labels"
	| "project"
	| "phase";

interface Props {
	draft: TaskMetadataDraft;
	dispatch: (action: TaskMetadataAction) => void;
	openPicker: TrackerCreatePickerName | null;
	onOpenPickerChange: (picker: TrackerCreatePickerName | null) => void;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	labels: TrackerVocabulary[];
	members: WorkspaceMember[];
	projects: TrackerProject[];
	hideProjectPickers?: boolean;
	fieldErrors?: Partial<Record<string, string>>;
}

const summarise = (names: string[]) =>
	names.length === 0
		? undefined
		: names.length === 1
			? names[0]
			: `${names[0]} +${names.length - 1}`;

export function TrackerCreateMetadataFields({
	draft,
	dispatch,
	openPicker,
	onOpenPickerChange,
	statuses,
	priorities,
	labels,
	members,
	projects,
	hideProjectPickers = false,
	fieldErrors = {},
}: Props) {
	const orderedStatuses = useMemo(
		() => sortStatusesByPosition(statuses),
		[statuses],
	);
	const orderedPriorities = useMemo(
		() => sortStatusesByPosition(priorities),
		[priorities],
	);

	const selectedStatus = orderedStatuses.find((s) => s.id === draft.statusId);
	const selectedPriority = orderedPriorities.find((p) => p.id === draft.priorityId);
	const selectedLabels = labels.filter((l) => draft.labelIds.includes(l.id));
	const selectedMembers = members.filter((m) => draft.assigneeIds.includes(m.userId));
	const selectedProject = projects.find((p) => p.id === draft.projectId);
	const selectedPhase = selectedProject?.phases.find((p) => p.id === draft.phaseId);

	const metadataProjects = useMemo(
		() =>
			projects.map((project) => ({
				id: project.id,
				phases: project.phases.map((phase) => ({
					id: phase.id,
					projectId: project.id,
				})),
			})),
		[projects],
	);

	const statusOptions: PickerOption[] = orderedStatuses.map((s) => ({
		id: String(s.id),
		label: s.name,
		selected: s.id === draft.statusId,
		icon: <StatusGlyph spec={statusGlyphSpec(orderedStatuses, s.id)} />,
	}));

	const priorityOptions: PickerOption[] = [
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

	const labelOptions: PickerOption[] = labels.map((l) => ({
		id: String(l.id),
		label: l.name,
		selected: draft.labelIds.includes(l.id),
		icon: <LabelDot colour={l.colour} />,
	}));

	const assigneeOptions: PickerOption[] = members.map((m) => ({
		id: String(m.userId),
		label: m.displayName,
		hint: `@${m.username}`,
		selected: draft.assigneeIds.includes(m.userId),
		icon: <Avatar name={m.displayName} />,
	}));

	const projectOptions: PickerOption[] = projects.map((p) => ({
		id: String(p.id),
		label: p.name,
		selected: p.id === draft.projectId,
	}));

	const phaseOptions: PickerOption[] = (selectedProject?.phases ?? []).map((ph) => ({
		id: String(ph.id),
		label: ph.name,
		selected: ph.id === draft.phaseId,
	}));

	const pickerErrorProps = (field: string) =>
		fieldErrors[field]
			? {
					"data-field-error": fieldErrors[field],
					"aria-invalid": true as const,
				}
			: {};

	return (
		<div className="flex flex-wrap items-center gap-2">
			{orderedStatuses.length > 0 && (
				<span {...pickerErrorProps("statusId")}>
					<TrackerPropertyPicker
						placeholder="Status"
						value={selectedStatus?.name}
						icon={
							selectedStatus ? (
								<StatusGlyph
									spec={statusGlyphSpec(orderedStatuses, selectedStatus.id)}
								/>
							) : (
								<StatusGlyph spec={{ shape: "pending", fraction: 0 }} />
							)
						}
						searchPlaceholder="Change status…"
						options={statusOptions}
						open={openPicker === "status"}
						onOpenChange={(open) => onOpenPickerChange(open ? "status" : null)}
						onSelect={(id) =>
							dispatch({ type: "setField", field: "statusId", value: Number(id) })
						}
					/>
				</span>
			)}

			{orderedPriorities.length > 0 && (
				<span {...pickerErrorProps("priorityId")}>
					<TrackerPropertyPicker
						placeholder="Priority"
						value={selectedPriority?.name}
						icon={
							<PriorityGlyph
								bars={
									selectedPriority
										? priorityBars(orderedPriorities, selectedPriority.id)
										: 0
								}
							/>
						}
						searchPlaceholder="Set priority to…"
						options={priorityOptions}
						open={openPicker === "priority"}
						onOpenChange={(open) => onOpenPickerChange(open ? "priority" : null)}
						onSelect={(id) => {
							if (id === NO_PRIORITY) {
								dispatch({ type: "removeField", field: "priorityId" });
							} else {
								dispatch({
									type: "setField",
									field: "priorityId",
									value: Number(id),
								});
							}
						}}
					/>
				</span>
			)}

			{members.length > 0 && (
				<span {...pickerErrorProps("assigneeIds")}>
					<TrackerPropertyPicker
						placeholder="Assignee"
						value={summarise(selectedMembers.map((m) => m.displayName))}
						icon={
							selectedMembers.length > 0 ? (
								<Avatar name={selectedMembers[0].displayName} size={16} />
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
						open={openPicker === "assignees"}
						onOpenChange={(open) =>
							onOpenPickerChange(open ? "assignees" : null)
						}
						onSelect={(id) =>
							dispatch({ type: "toggleAssignee", id: Number(id) })
						}
						multiple
					/>
				</span>
			)}

			{labels.length > 0 && (
				<span {...pickerErrorProps("labelIds")}>
					<TrackerPropertyPicker
						placeholder="Labels"
						value={summarise(selectedLabels.map((l) => l.name))}
						icon={
							selectedLabels.length > 0 ? (
								<LabelDot colour={selectedLabels[0].colour} />
							) : (
								<Tag
									size={14}
									className="shrink-0 text-neutral-500"
									aria-hidden
								/>
							)
						}
						searchPlaceholder="Add label…"
						options={labelOptions}
						open={openPicker === "labels"}
						onOpenChange={(open) => onOpenPickerChange(open ? "labels" : null)}
						onSelect={(id) => dispatch({ type: "toggleLabel", id: Number(id) })}
						multiple
					/>
				</span>
			)}

			{!hideProjectPickers && projects.length > 0 && (
				<>
					<span {...pickerErrorProps("projectId")}>
						<TrackerPropertyPicker
							placeholder="Project"
							value={selectedProject?.name}
							icon={
								<Folder
									size={14}
									className="shrink-0 text-neutral-500"
									aria-hidden
								/>
							}
							searchPlaceholder="Set project to…"
							options={projectOptions}
							open={openPicker === "project"}
							onOpenChange={(open) =>
								onOpenPickerChange(open ? "project" : null)
							}
							onSelect={(id) => {
								dispatch({
									type: "setProject",
									projectId: Number(id),
									projects: metadataProjects,
								});
							}}
						/>
					</span>
					<span {...pickerErrorProps("phaseId")}>
						<TrackerPropertyPicker
							placeholder="Phase"
							value={selectedPhase?.name}
							icon={
								<Signpost
									size={14}
									className="shrink-0 text-neutral-500"
									aria-hidden
								/>
							}
							searchPlaceholder="Set phase to…"
							options={phaseOptions}
							open={openPicker === "phase"}
							onOpenChange={(open) => onOpenPickerChange(open ? "phase" : null)}
							onSelect={(id) => {
								if (draft.projectId === null) return;
								dispatch({
									type: "setPhase",
									phaseId: Number(id),
									projects: metadataProjects,
								});
							}}
						/>
					</span>
				</>
			)}
		</div>
	);
}
