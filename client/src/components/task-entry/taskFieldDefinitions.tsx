import type {
	TaskMetadataAction,
	TaskMetadataDraft,
	TaskMetadataProject,
} from "./taskMetadataDraft";
import type {
	TaskMetadataCatalogEntry,
	TaskMetadataCatalogKey,
	TaskMetadataCatalogs,
} from "./TaskMetadataCatalogProvider";
import type { TrackerProject, TrackerVocabulary, WorkspaceMember } from "../../types";

export type TaskFieldCatalogState =
	| "loading"
	| "ready"
	| "empty"
	| "failed"
	| "disabled";

export interface TaskFieldOption {
	id: string;
	label: string;
}

export interface TaskFieldCommandDefinition {
	id: string;
	label: string;
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
		const options = (entry.items as WorkspaceMember[]).map((member) => ({
			id: String(member.userId),
			label: member.displayName || member.username,
		}));
		return { catalogState: "ready", options, allowsCreate: false };
	}

	if (key === "project") {
		const options = (entry.items as TrackerProject[]).map((project) => ({
			id: String(project.id),
			label: project.name,
		}));
		return { catalogState: "ready", options, allowsCreate: false };
	}

	const options = (entry.items as TrackerVocabulary[]).map((item) => ({
		id: String(item.id),
		label: item.name,
	}));
	return { catalogState: "ready", options, allowsCreate: false };
}

function dateField(
	id: "dueDate" | "startDate" | "endDate",
	label: string,
): TaskFieldCommandDefinition {
	return {
		id,
		label,
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
		multiple,
		...mapCatalogState(catalogs[key], catalogs.retry, key),
		mapOptionToValue,
		buildSelectAction,
		buildRemoveAction,
		getSelectedOptionIds,
	};
}

function phaseField(catalogs: TaskMetadataCatalogs): TaskFieldCommandDefinition {
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
		...base,
		catalogState,
		options: catalogState === "ready" ? phaseOptions : [],
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
	const project = projects.find((candidate) => candidate.id === lock.lockedProjectId);
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
			(value) => ({ type: "setField", field: "priorityId", value: value as number }),
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

export function getTrackerTaskFieldDefinitions(
	catalogs: TaskMetadataCatalogs,
	lock?: TrackerFieldLockContext,
): TaskFieldCommandDefinition[] {
	const fields: TaskFieldCommandDefinition[] = [
		catalogField(
			"statusId",
			"Status",
			"status",
			catalogs,
			false,
			(id) => Number(id),
			(value) => ({ type: "setField", field: "statusId", value: value as number }),
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
			(value) => ({ type: "setField", field: "priorityId", value: value as number }),
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

	if (!isValidLock(lock)) {
		return fields;
	}

	return fields.filter((field) => field.id !== "projectId" && field.id !== "phaseId");
}
