export type BoardCreatePayload = {
	columnId: number;
	title: string;
	description?: string;
	assigneeIds?: number[];
	priorityId?: number | null;
	labelIds?: number[];
	projectId?: number | null;
	phaseId?: number | null;
	dueDate?: string | null;
};

export type TrackerCreatePayload = {
	title: string;
	description?: string;
	statusId?: number;
	priorityId?: number | null;
	labelIds?: number[];
	assigneeIds?: number[];
	projectId?: number | null;
	phaseId?: number | null;
	startDate?: string | null;
	endDate?: string | null;
};

export type TaskCreateFieldErrors = Partial<
	Record<
		| "title"
		| "description"
		| "statusId"
		| "assigneeIds"
		| "priorityId"
		| "labelIds"
		| "projectId"
		| "phaseId"
		| "dueDate"
		| "startDate"
		| "endDate",
		string
	>
>;
