export type TrackerVocabularyKind = "status" | "priority" | "label";

export type TrackerStatusCategory =
	| "backlog"
	| "started"
	| "completed"
	| "canceled";

export interface TrackerVocabulary {
	id: number;
	kind: TrackerVocabularyKind;
	name: string;
	position: number;
	colour: string;
	slot?: "backlog" | "todo" | "in_progress" | "done" | "canceled" | null;
	category?: TrackerStatusCategory | null;
	createdAt?: string;
}

export interface TrackerItemAssignee {
	id: number;
	username: string;
	displayName: string;
}

export interface TrackerItem {
	id: number;
	key: string;
	title: string;
	description: string;
	projectId?: number | null;
	phaseId?: number | null;
	startDate?: string | null;
	endDate?: string | null;
	completedAt?: string | null;
	position?: number;
	status: TrackerVocabulary;
	priority: TrackerVocabulary | null;
	labels: TrackerVocabulary[];
	assignees: TrackerItemAssignee[];
	version: number;
	createdAt: string;
	updatedAt: string;
	canonicalKey?: string;
	redirectFrom?: string;
}

export type WorkItemSource = "board" | "tracker";

export interface WorkItem extends TrackerItem {
	source: WorkItemSource;
	columnId?: number;
	columnName?: string | null;
	dueDate?: string | null;
	startedAt?: string | null;
	doneAt?: string | null;
}

export interface TrackerPhase {
	id: number;
	projectId: number;
	name: string;
	subtitle: string;
	startDate: string | null;
	endDate: string | null;
	position: number;
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface TrackerProject {
	id: number;
	name: string;
	startDate: string | null;
	endDate: string | null;
	position: number;
	version: number;
	phases: TrackerPhase[];
	createdAt?: string;
	updatedAt?: string;
}

export interface TrackerEvent {
	id: number;
	eventType: string;
	trackerItemId: number | null;
	title: string | null;
	actor: { username: string; displayName: string } | null;
	payload?: Record<string, unknown> | null;
	createdAt: string;
}
