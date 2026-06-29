import { EventEmitter } from "node:events";

export interface DomainEvent {
	type: string;
	workspaceId: number;
	actorId: number;
	payload: Record<string, unknown>;
}

export const domainBus = new EventEmitter();

export const EVENTS = {
	CARD_ASSIGNED: "card:assigned",
	CARD_DUE_DATE_CHANGED: "card:dueDateChanged",
	CARD_DUE_DATE_REMOVED: "card:dueDateRemoved",
	MEMBER_JOINED: "member:joined",
	SYSTEM_ALERT: "system:alert",
	CARD_DELETED: "card:deleted",
} as const;
