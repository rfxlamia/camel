import type { AttachmentActivityPayload } from "../activity";
import type { User } from "../auth";
import type { TrackerVocabulary } from "../tracker";

export interface CardAssignee {
	id: number;
	username: string;
	displayName: string;
}

export interface CardAttachment {
	id: number;
	thumbnailUrl: string;
	originalUrl: string;
	downloadUrl: string;
	mimeType: string;
	createdAt: string;
}

export interface Card {
	id: number;
	key?: string | null;
	columnId: number;
	title: string;
	description: string;
	position: number;
	version: number;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	doneAt: string | null;
	// Calendar date "YYYY-MM-DD" (no time-of-day) or null when unset.
	dueDate: string | null;
	status?: TrackerVocabulary | null;
	priority?: TrackerVocabulary | null;
	labels?: TrackerVocabulary[];
	projectId?: number | null;
	projectName?: string | null;
	phaseId?: number | null;
	phaseName?: string | null;
	assignees: CardAssignee[];
	attachments?: CardAttachment[];
	workspaceId?: number;
}

export type BoardEventType =
	| "card.created"
	| "card.updated"
	| "card.moved"
	| "card.reordered"
	| "card.deleted"
	| "attachment.added"
	| "attachment.removed"
	| "column.created"
	| "column.updated"
	| "column.deleted"
	| "presence.changed"
	| "settings.updated"
	| "membership.removed"
	| "membership.role_changed"
	| "agent.board.generating"
	| "agent.board.ready"
	| "agent.board.failed"
	| "agent.card.started"
	| "agent.card.token"
	| "agent.card.done"
	| "agent.card.failed"
	| "agent.card.thinking"
	| "agent.tool.started"
	| "agent.tool.result"
	| "agent.tool.failed"
	| "ticket_intake.submit_result"
	| "tracker.created"
	| "tracker.updated"
	| "tracker.deleted"
	| "tracker.vocabulary.created"
	| "tracker.project.created"
	| "tracker.project.updated"
	| "tracker.project.deleted"
	| "tracker.phase.created"
	| "tracker.phase.updated"
	| "tracker.phase.deleted"
	| "focus_session.updated";

export interface BoardEvent {
	type: BoardEventType;
	actor: User;
	cardId?: number;
	at: string;
	payload?: AttachmentActivityPayload;
}

export interface Column {
	id: number;
	title: string;
	position: number;
	wipLimit: number | null;
	policy: string;
	isDone: boolean;
	isSignable: boolean;
	signableAssigneeId: number | null;
	color: string | null;
	cards: Card[];
}

export interface Board {
	columns: Column[];
}

export interface FlowMetrics {
	throughput: number;
	avgLeadTimeMs: number | null;
	avgCycleTimeMs: number | null;
	wipCount: number;
}

export interface MetricsHistoryBucket {
	weekStart: string;
	throughput: number;
	avgLeadTimeMs: number | null;
	avgCycleTimeMs: number | null;
	wipCount: number;
}
