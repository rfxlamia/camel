import { addDays, format } from "date-fns";

export interface TaskMetadataPhase {
	id: number;
	projectId: number;
}
export interface TaskMetadataProject {
	id: number;
	phases: TaskMetadataPhase[];
}
export type TaskMetadataDateField = "dueDate" | "startDate" | "endDate";
export type TaskMetadataSingleField =
	| "statusId"
	| "priorityId"
	| "projectId"
	| "phaseId"
	| TaskMetadataDateField;
export interface TaskMetadataErrors {
	startDate?: string;
	endDate?: string;
	dueDate?: string;
	dateRange?: string;
}
export interface TaskMetadataDraft {
	statusId: number | null;
	priorityId: number | null;
	assigneeIds: number[];
	labelIds: number[];
	projectId: number | null;
	phaseId: number | null;
	dueDate: string | null;
	startDate: string | null;
	endDate: string | null;
	projects: TaskMetadataProject[];
	errors: TaskMetadataErrors;
}
export interface TaskMetadataPayload {
	statusId?: number;
	priorityId?: number;
	assigneeIds?: number[];
	labelIds?: number[];
	projectId?: number;
	phaseId?: number;
	dueDate?: string;
	startDate?: string;
	endDate?: string;
}
export interface TaskMetadataAction {
	type: string;
	[key: string]: unknown;
}

export const INVALID_DATE_RANGE_MESSAGE = "End date cannot precede Start date.";
const dateFields = ["dueDate", "startDate", "endDate"] as const;
const emptyErrors: TaskMetadataErrors = {};
const uniqueIds = (ids: number[]) => [...new Set(ids)];

function numberFrom(
	action: TaskMetadataAction,
	...keys: string[]
): number | null {
	for (const key of keys) {
		const value = action[key];
		if (typeof value === "number") return value;
		if (typeof value === "string" && value.trim()) {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}
function stringFrom(
	action: TaskMetadataAction,
	...keys: string[]
): string | null {
	for (const key of keys)
		if (typeof action[key] === "string") return action[key] as string;
	return null;
}
function projectsFrom(
	action: TaskMetadataAction,
	fallback: TaskMetadataProject[],
) {
	return Array.isArray(action.projects)
		? (action.projects as TaskMetadataProject[])
		: fallback;
}
function isDateField(field: string | null): field is TaskMetadataDateField {
	return field !== null && dateFields.includes(field as TaskMetadataDateField);
}

export function createInitialTaskMetadataDraft(
	initial: Partial<TaskMetadataDraft> = {},
): TaskMetadataDraft {
	return {
		statusId: initial.statusId ?? null,
		priorityId: initial.priorityId ?? null,
		assigneeIds: uniqueIds(initial.assigneeIds ?? []),
		labelIds: uniqueIds(initial.labelIds ?? []),
		projectId: initial.projectId ?? null,
		phaseId: initial.phaseId ?? null,
		dueDate: initial.dueDate ?? null,
		startDate: initial.startDate ?? null,
		endDate: initial.endDate ?? null,
		projects: initial.projects ?? [],
		errors: initial.errors ?? emptyErrors,
	};
}

export function resolveDatePreset(
	preset: string,
	now: Date = new Date(),
): string {
	const normalized = preset.toLowerCase().replace(/\s+/g, "");
	const days = normalized === "today" ? 0 : normalized === "tomorrow" ? 1 : 7;
	return format(addDays(now, days), "yyyy-MM-dd");
}

function setDate(
	state: TaskMetadataDraft,
	field: TaskMetadataDateField,
	value: string | null,
) {
	const invalidEnd =
		field === "endDate" &&
		value !== null &&
		state.startDate !== null &&
		value < state.startDate;
	const invalidStart =
		field === "startDate" &&
		value !== null &&
		state.endDate !== null &&
		value > state.endDate;
	if (invalidEnd || invalidStart) {
		const key = invalidEnd ? "endDate" : "startDate";
		return {
			...state,
			errors: {
				...state.errors,
				[key]: INVALID_DATE_RANGE_MESSAGE,
				dateRange: INVALID_DATE_RANGE_MESSAGE,
			},
		};
	}
	const errors = { ...state.errors };
	delete errors[field];
	delete errors.dateRange;
	return { ...state, [field]: value, errors };
}

function toggle(
	state: TaskMetadataDraft,
	field: "assigneeIds" | "labelIds",
	id: number,
) {
	const ids = uniqueIds(state[field]);
	return {
		...state,
		[field]: ids.includes(id)
			? ids.filter((value) => value !== id)
			: [...ids, id],
	};
}
function setProject(state: TaskMetadataDraft, action: TaskMetadataAction) {
	const projectId = numberFrom(action, "projectId", "value", "id");
	const projects = projectsFrom(action, state.projects);
	const project = projects.find((candidate) => candidate.id === projectId);
	const phaseStillBelongs =
		project?.phases.some((phase) => phase.id === state.phaseId) ?? false;
	return {
		...state,
		projectId,
		phaseId:
			projectId !== state.projectId && !phaseStillBelongs
				? null
				: state.phaseId,
		projects,
	};
}
function setPhase(state: TaskMetadataDraft, action: TaskMetadataAction) {
	const phaseId = numberFrom(action, "phaseId", "value", "id");
	const projects = projectsFrom(action, state.projects);
	if (phaseId === null) return { ...state, phaseId: null, projects };
	const phase = projects
		.flatMap((project) => project.phases)
		.find((candidate) => candidate.id === phaseId);
	return {
		...state,
		phaseId,
		projectId: phase?.projectId ?? state.projectId,
		projects,
	};
}
function setField(
	state: TaskMetadataDraft,
	action: TaskMetadataAction,
	field: string | null,
) {
	if (!field) return state;
	if (isDateField(field))
		return setDate(state, field, stringFrom(action, "value"));
	const value = numberFrom(action, "value", "id");
	if (field === "statusId") return { ...state, statusId: value };
	if (field === "priorityId") return { ...state, priorityId: value };
	if (field === "projectId")
		return setProject(state, {
			...action,
			type: "setProject",
			projectId: value,
		});
	if (field === "phaseId")
		return setPhase(state, { ...action, type: "setPhase", phaseId: value });
	return state;
}
function setDateAction(state: TaskMetadataDraft, action: TaskMetadataAction) {
	const field = stringFrom(action, "field", "dateField");
	if (!isDateField(field)) return state;
	if (action.type.toLowerCase().includes("preset")) {
		const preset = stringFrom(action, "preset", "value");
		return preset ? setDate(state, field, resolveDatePreset(preset)) : state;
	}
	return setDate(state, field, stringFrom(action, "value", "date"));
}
function reset(state: TaskMetadataDraft, action: TaskMetadataAction) {
	const preserve = Array.isArray(action.preserve)
		? (action.preserve as string[])
		: [];
	return createInitialTaskMetadataDraft({
		statusId: preserve.includes("statusId") ? state.statusId : null,
		projectId: preserve.includes("projectId") ? state.projectId : null,
		phaseId: preserve.includes("phaseId") ? state.phaseId : null,
		projects: state.projects,
	});
}

export function taskMetadataReducer(
	state: TaskMetadataDraft,
	action: TaskMetadataAction,
): TaskMetadataDraft {
	const type = action.type.toLowerCase();
	if (type === "toggleassignee" || type === "toggle-assignees") {
		const id = numberFrom(action, "id", "userId", "value");
		return id === null ? state : toggle(state, "assigneeIds", id);
	}
	if (type === "togglelabel" || type === "toggle-label") {
		const id = numberFrom(action, "id", "labelId", "value");
		return id === null ? state : toggle(state, "labelIds", id);
	}
	if (type === "setproject" || type === "project")
		return setProject(state, action);
	if (type === "setphase" || type === "phase") return setPhase(state, action);
	if (
		type === "setdatepreset" ||
		type === "datepreset" ||
		type === "set-date-preset" ||
		type === "setdate" ||
		type === "setdatevalue" ||
		type === "date"
	)
		return setDateAction(state, action);
	if (type === "setfield" || type === "field")
		return setField(state, action, stringFrom(action, "field"));
	if (type === "setpriority" || type === "priority")
		return {
			...state,
			priorityId: numberFrom(action, "priorityId", "value", "id"),
		};
	if (type === "removefield" || type === "remove") {
		const field = stringFrom(action, "field");
		if (field === "projectId")
			return { ...state, projectId: null, phaseId: null };
		if (field === "phaseId") return { ...state, phaseId: null };
		if (field && field in state) return { ...state, [field]: null };
	}
	if (type === "reset") return reset(state, action);
	return state;
}

export function selectTaskMetadataPayload(
	state: TaskMetadataDraft,
): TaskMetadataPayload {
	return {
		...(state.statusId === null ? {} : { statusId: state.statusId }),
		...(state.priorityId === null ? {} : { priorityId: state.priorityId }),
		...(state.assigneeIds.length
			? { assigneeIds: uniqueIds(state.assigneeIds) }
			: {}),
		...(state.labelIds.length ? { labelIds: uniqueIds(state.labelIds) } : {}),
		...(state.projectId === null ? {} : { projectId: state.projectId }),
		...(state.phaseId === null ? {} : { phaseId: state.phaseId }),
		...(state.dueDate === null ? {} : { dueDate: state.dueDate }),
		...(state.startDate === null ? {} : { startDate: state.startDate }),
		...(state.endDate === null ? {} : { endDate: state.endDate }),
	};
}
export function selectTaskMetadataValidation(state: TaskMetadataDraft) {
	return state.errors;
}
export const getTaskMetadataPayload = selectTaskMetadataPayload;
export const getTaskMetadataValidation = selectTaskMetadataValidation;
export function applyDatePreset(
	state: TaskMetadataDraft,
	field: TaskMetadataDateField,
	preset: string,
	now = new Date(),
) {
	return setDate(state, field, resolveDatePreset(preset, now));
}
