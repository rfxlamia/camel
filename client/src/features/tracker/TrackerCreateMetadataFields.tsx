import { Folder, Signpost, Tag, UserRound } from "lucide-react";
import { useMemo } from "react";
import {
	Avatar,
	LabelDot,
	PriorityGlyph,
	priorityBars,
	StatusGlyph,
	statusGlyphSpec,
} from "../../shared/TrackerGlyphs";
import { TrackerPropertyPicker } from "../../shared/TrackerPropertyPicker";
import type {
	TaskMetadataAction,
	TaskMetadataDraft,
} from "../../shared/taskMetadataDraft";
import { NO_PRIORITY, sortStatusesByPosition } from "../../shared/trackerUtils";
import type {
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import { toMetadataProjects } from "./trackerCreateLock";
import {
	buildCreateAssigneeOptions,
	buildCreateLabelOptions,
	buildCreatePhaseOptions,
	buildCreatePriorityOptions,
	buildCreateProjectOptions,
	buildCreateStatusOptions,
	summarise,
} from "./trackerCreatePickerOptions";

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
	const selectedPriority = orderedPriorities.find(
		(p) => p.id === draft.priorityId,
	);
	const selectedLabels = labels.filter((l) => draft.labelIds.includes(l.id));
	const selectedMembers = members.filter((m) =>
		draft.assigneeIds.includes(m.userId),
	);
	const selectedProject = projects.find((p) => p.id === draft.projectId);
	const selectedPhase = selectedProject?.phases.find(
		(p) => p.id === draft.phaseId,
	);
	const metadataProjects = useMemo(
		() => toMetadataProjects(projects),
		[projects],
	);
	const statusOptions = buildCreateStatusOptions(orderedStatuses, draft);
	const priorityOptions = buildCreatePriorityOptions(orderedPriorities, draft);
	const labelOptions = buildCreateLabelOptions(labels, draft);
	const assigneeOptions = buildCreateAssigneeOptions(members, draft);
	const projectOptions = buildCreateProjectOptions(projects, draft);
	const phaseOptions = buildCreatePhaseOptions(selectedProject, draft);
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
							dispatch({
								type: "setField",
								field: "statusId",
								value: Number(id),
							})
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
						onOpenChange={(open) =>
							onOpenPickerChange(open ? "priority" : null)
						}
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
