import { CalendarDays, Folder, Signpost, Tag, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type {
	TrackerProject,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
import {
	Avatar,
	LabelDot,
	PriorityGlyph,
	priorityBars,
	StatusGlyph,
	statusGlyphSpec,
} from "../tracker/TrackerGlyphs";
import type {
	TaskMetadataCatalogEntry,
	TaskMetadataCatalogKey,
	TaskMetadataCatalogs,
} from "./TaskMetadataCatalogProvider";
import type {
	TaskMetadataAction,
	TaskMetadataDraft,
	TaskMetadataProject,
} from "./taskMetadataDraft";

export type TaskFieldCatalogState =
	| "loading"
	| "ready"
	| "empty"
	| "failed"
	| "disabled";

export interface TaskFieldOption {
	id: string;
	label: string;
	icon?: ReactNode;
}

export interface TaskFieldCommandDefinition {
	id: string;
	label: string;
	icon?: ReactNode;
	multiple?: boolean;
	catalogState: TaskFieldCatalogState;
	options: TaskFieldOption[];
	allowsCreate?: boolean;
	errorMessage?: string;
	onRetry?: () => void;
	mapOptionToValue: (id: string) => unknown;
	buildSelectAction: (value: unknown) => TaskMetadataAction;
	buildRemoveAction: () => TaskMetadataAction;
	getSelectedOptionIds: (draft: TaskMetadataDraft) => string[];
}

export type { TaskMetadataCatalogs };

export interface TrackerFieldLockContext {
	lockedProjectId?: number | null;
	lockedPhaseId?: number | null;
	projects?: TrackerProject[] | TaskMetadataProject[];
}

function mapCatalogState<K extends TaskMetadataCatalogKey>(
	entry: TaskMetadataCatalogEntry<K>,
	retry: (key: TaskMetadataCatalogKey) => void,
	key: K,
): Pick<
	TaskFieldCommandDefinition,
	"catalogState" | "options" | "allowsCreate" | "errorMessage" | "onRetry"
> {
	if (entry.status === "loading") {
		return { catalogState: "loading", options: [], allowsCreate: false };
	}
	if (entry.status === "empty") {
		return { catalogState: "empty", options: [], allowsCreate: false };
	}
	if (entry.status === "failed") {
		return {
			catalogState: "failed",
			options: [],
			allowsCreate: false,
			errorMessage: entry.error,
			onRetry: () => retry(key),
		};
	}

	if (key === "assignee") {
		const options = (entry.items as WorkspaceMember[]).map((member) => {
			const label = member.displayName || member.username;
			return {
				id: String(member.userId),
				label,
				icon: <Avatar name={label} size={14} />,
			};
		});
		return { catalogState: "ready", options, allowsCreate: false };
	}

	if (key === "project") {
		const options = (entry.items as TrackerProject[]).map((project) => ({
			id: String(project.id),
			label: project.name,
			icon: (
				<Folder size={13} className="shrink-0 text-neutral-500" aria-hidden />
			),
		}));
		return { catalogState: "ready", options, allowsCreate: false };
	}

	// Vocabulary catalogs share a shape but not a glyph: priority reads as bars,
	// status as a progress ring, labels as their own colour.
	const vocabulary = entry.items as TrackerVocabulary[];
	const options = vocabulary.map((item) => ({
		id: String(item.id),
		label: item.name,
		icon:
			key === "priority" ? (
				<PriorityGlyph bars={priorityBars(vocabulary, item.id)} />
			) : key === "status" ? (
				<StatusGlyph spec={statusGlyphSpec(vocabulary, item.id)} />
			) : (
				<LabelDot colour={item.colour} />
			),
	}));
	return { catalogState: "ready", options, allowsCreate: false };
}

const FIELD_ICON_CLASS = "shrink-0 text-neutral-500";

function dateField(
	id: "dueDate" | "startDate" | "endDate",
	label: string,
): TaskFieldCommandDefinition {
	return {
		id,
		label,
		icon: <CalendarDays size={14} className={FIELD_ICON_CLASS} aria-hidden />,
		catalogState: "ready",
		options: [],
		allowsCreate: false,
		mapOptionToValue: (value) => value,
		buildSelectAction: (value) => ({ type: "setDate", field: id, value }),
		buildRemoveAction: () => ({ type: "removeField", field: id }),
		getSelectedOptionIds: (draft) =>
			draft[id] === null ? [] : [draft[id] as string],
	};
}

const CATALOG_FIELD_ICON: Record<TaskMetadataCatalogKey, ReactNode> = {
	assignee: <UserRound size={14} className={FIELD_ICON_CLASS} aria-hidden />,
	priority: <PriorityGlyph bars={0} />,
	label: <Tag size={14} className={FIELD_ICON_CLASS} aria-hidden />,
	project: <Folder size={14} className={FIELD_ICON_CLASS} aria-hidden />,
	status: <StatusGlyph spec={{ shape: "pending", fraction: 0 }} />,
};

function catalogField(
	id: string,
	label: string,
	key: TaskMetadataCatalogKey,
	catalogs: TaskMetadataCatalogs,
	multiple: boolean,
	mapOptionToValue: (id: string) => unknown,
	buildSelectAction: (value: unknown) => TaskMetadataAction,
	buildRemoveAction: () => TaskMetadataAction,
	getSelectedOptionIds: (draft: TaskMetadataDraft) => string[],
): TaskFieldCommandDefinition {
	return {
		id,
		label,
		icon: CATALOG_FIELD_ICON[key],
		multiple,
		...mapCatalogState(catalogs[key], catalogs.retry, key),
		mapOptionToValue,
		buildSelectAction,
		buildRemoveAction,
		getSelectedOptionIds,
	};
}

function phaseField(
	catalogs: TaskMetadataCatalogs,
): TaskFieldCommandDefinition {
	const projectEntry = catalogs.project;
	const phaseOptions =
		projectEntry.status === "ready"
			? projectEntry.items.flatMap((project) =>
					project.phases.map((phase) => ({
						id: String(phase.id),
						label: phase.name,
					})),
				)
			: [];

	const base = mapCatalogState(catalogs.project, catalogs.retry, "project");
	const catalogState =
		base.catalogState === "ready" && phaseOptions.length === 0
			? "empty"
			: base.catalogState;

	return {
		id: "phaseId",
		label: "Phase",
		icon: <Signpost size={14} className={FIELD_ICON_CLASS} aria-hidden />,
		...base,
		catalogState,
		options:
			catalogState === "ready"
				? phaseOptions.map((option) => ({
						...option,
						icon: (
							<Signpost size={13} className={FIELD_ICON_CLASS} aria-hidden />
						),
					}))
				: [],
		mapOptionToValue: (id) => Number(id),
		buildSelectAction: (value) => ({
			type: "setPhase",
			phaseId: value as number,
			projects:
				projectEntry.status === "ready"
					? projectEntry.items.map((project) => ({
							id: project.id,
							phases: project.phases.map((phase) => ({
								id: phase.id,
								projectId: project.id,
							})),
						}))
					: [],
		}),
		buildRemoveAction: () => ({ type: "removeField", field: "phaseId" }),
		getSelectedOptionIds: (draft) =>
			draft.phaseId === null ? [] : [String(draft.phaseId)],
	};
}

function isValidLock(
	lock: TrackerFieldLockContext | undefined,
): lock is TrackerFieldLockContext & { lockedProjectId: number } {
	if (!lock?.lockedProjectId) return false;
	const projects = lock.projects ?? [];
	const project = projects.find(
		(candidate) => candidate.id === lock.lockedProjectId,
	);
	if (!project) return false;
	if (lock.lockedPhaseId == null) return true;
	return project.phases.some((phase) => phase.id === lock.lockedPhaseId);
}

export function getBoardTaskFieldDefinitions(
	catalogs: TaskMetadataCatalogs,
): TaskFieldCommandDefinition[] {
	return [
		catalogField(
			"assigneeIds",
			"Assignee",
			"assignee",
			catalogs,
			true,
			(id) => Number(id),
			(value) => ({ type: "toggleAssignee", id: value as number }),
			() => ({ type: "removeField", field: "assigneeIds" }),
			(draft) => draft.assigneeIds.map((id) => String(id)),
		),
		catalogField(
			"priorityId",
			"Priority",
			"priority",
			catalogs,
			false,
			(id) => Number(id),
			(value) => ({
				type: "setField",
				field: "priorityId",
				value: value as number,
			}),
			() => ({ type: "removeField", field: "priorityId" }),
			(draft) => (draft.priorityId === null ? [] : [String(draft.priorityId)]),
		),
		catalogField(
			"labelIds",
			"Labels",
			"label",
			catalogs,
			true,
			(id) => Number(id),
			(value) => ({ type: "toggleLabel", id: value as number }),
			() => ({ type: "removeField", field: "labelIds" }),
			(draft) => draft.labelIds.map((id) => String(id)),
		),
		catalogField(
			"projectId",
			"Project",
			"project",
			catalogs,
			false,
			(id) => Number(id),
			(value) => ({ type: "setProject", projectId: value as number }),
			() => ({ type: "removeField", field: "projectId" }),
			(draft) => (draft.projectId === null ? [] : [String(draft.projectId)]),
		),
		phaseField(catalogs),
		dateField("dueDate", "Due date"),
	];
}

function buildTrackerTaskFields(
	catalogs: TaskMetadataCatalogs,
): TaskFieldCommandDefinition[] {
	return [
		catalogField(
			"statusId",
			"Status",
			"status",
			catalogs,
			false,
			(id) => Number(id),
			(value) => ({
				type: "setField",
				field: "statusId",
				value: value as number,
			}),
			() => ({ type: "removeField", field: "statusId" }),
			(draft) => (draft.statusId === null ? [] : [String(draft.statusId)]),
		),
		catalogField(
			"priorityId",
			"Priority",
			"priority",
			catalogs,
			false,
			(id) => Number(id),
			(value) => ({
				type: "setField",
				field: "priorityId",
				value: value as number,
			}),
			() => ({ type: "removeField", field: "priorityId" }),
			(draft) => (draft.priorityId === null ? [] : [String(draft.priorityId)]),
		),
		catalogField(
			"assigneeIds",
			"Assignee",
			"assignee",
			catalogs,
			true,
			(id) => Number(id),
			(value) => ({ type: "toggleAssignee", id: value as number }),
			() => ({ type: "removeField", field: "assigneeIds" }),
			(draft) => draft.assigneeIds.map((id) => String(id)),
		),
		catalogField(
			"labelIds",
			"Labels",
			"label",
			catalogs,
			true,
			(id) => Number(id),
			(value) => ({ type: "toggleLabel", id: value as number }),
			() => ({ type: "removeField", field: "labelIds" }),
			(draft) => draft.labelIds.map((id) => String(id)),
		),
		catalogField(
			"projectId",
			"Project",
			"project",
			catalogs,
			false,
			(id) => Number(id),
			(value) => ({ type: "setProject", projectId: value as number }),
			() => ({ type: "removeField", field: "projectId" }),
			(draft) => (draft.projectId === null ? [] : [String(draft.projectId)]),
		),
		phaseField(catalogs),
		dateField("startDate", "Start date"),
		dateField("endDate", "End date"),
	];
}

export function getTrackerTaskFieldDefinitions(
	catalogs: TaskMetadataCatalogs,
	lock?: TrackerFieldLockContext,
): TaskFieldCommandDefinition[] {
	const fields = buildTrackerTaskFields(catalogs);

	if (!isValidLock(lock)) {
		return fields;
	}

	return fields.filter(
		(field) => field.id !== "projectId" && field.id !== "phaseId",
	);
}
