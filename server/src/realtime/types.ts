import type { Response } from "express";
import type { AuthUser } from "../auth.js";

export interface AttachmentEventPayload {
	attachmentId: number;
	mimeType: string;
	createdAt: string;
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
	// Agent events (Phase 1)
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

type BoardEventFields = {
	actor?: AuthUser;
	cardId?: number;
	trackerItemId?: number;
	userId?: number;
	workspaceId?: number;
	workspaceName?: string;
	role?: string;
	toolName?: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
	attempt?: number;
	columnSlug?: string;
	token?: string;
	boardId?: number;
	success?: boolean;
	issueUrl?: string;
	issueIdentifier?: string;
	errorMessage?: string;
	retryable?: boolean;
	ticketResult?: {
		success: boolean;
		issueUrl?: string;
		issueIdentifier?: string;
		errorMessage?: string;
		retryable?: boolean;
	};
	at?: string;
};

export type BoardEvent =
	| (BoardEventFields & {
			type: "attachment.added" | "attachment.removed";
			payload: AttachmentEventPayload;
	  })
	| (BoardEventFields & {
			type: Exclude<BoardEventType, "attachment.added" | "attachment.removed">;
			payload?: Record<string, unknown>;
	  });

type WithoutAt<T> = T extends unknown ? Omit<T, "at"> : never;
export type PublishableEvent = WithoutAt<BoardEvent>;

export interface PublisherLike {
	publish(channel: string, message: string): Promise<number>;
	set?(key: string, value: string, options?: { EX: number }): Promise<unknown>;
	del?(key: string): Promise<unknown>;
	mGet?(keys: string[]): Promise<(string | null)[]>;
}

export interface SubscriberLike {
	pSubscribe(
		pattern: string,
		listener: (message: string, channel: string) => void,
	): Promise<void>;
}

export interface PresenceLike {
	scanIterator(options: {
		MATCH: string;
		COUNT?: number;
	}): AsyncIterable<string | string[]>;
	set?(key: string, value: string, options?: { EX: number }): Promise<unknown>;
	del?(key: string): Promise<unknown>;
	mGet?(keys: string[]): Promise<(string | null)[]>;
}

export interface RealtimeHubDeps {
	publisher: PublisherLike | null;
	subscriber: SubscriberLike | null;
	presence?: PresenceLike | null;
}

export interface SseClient {
	workspaceId: number;
	userId?: number;
	res: Response;
	keepAlive: ReturnType<typeof setInterval>;
}

export interface LocalTestClient {
	workspaceId: number;
	buffer: PublishableEvent[];
}
