import type { DBExecutor } from "../db/kysely.js";
import { db } from "../db/kysely.js";
import { sql } from "kysely";
import {
	findBoardCardByKeyNumber,
	findTrackerItemByKeyNumber,
} from "./work-item-response.js";

export type WorkItemEvent = {
	id: number;
	eventType: string;
	trackerItemId: number | null;
	title: string | null;
	payload: unknown;
	actor: { username: string; displayName: string | null } | null;
	createdAt: string;
};

export type UnifiedActivityEvent = {
	/** Stable key for React lists — scoped per source table. */
	eventKey: string;
	id: number;
	source: "board" | "tracker";
	eventType: string;
	title: string | null;
	payload: unknown;
	actor: { username: string; displayName: string | null } | null;
	createdAt: string;
};

function trackerEventSelect(executor: DBExecutor = db) {
	return executor
		.selectFrom("tracker_events as e")
		.leftJoin("users as u", "u.id", "e.actor_id")
		.leftJoin("tracker_items as ti", (join) =>
			join
				.onRef("ti.id", "=", "e.tracker_item_id")
				.on("ti.deleted_at", "is", null),
		)
		.select([
			"e.id",
			"e.event_type",
			"e.payload",
			"e.created_at",
			"e.tracker_item_id",
			"u.username",
			"u.display_name",
			"ti.title as current_item_title",
		]);
}

function cardEventSelect(executor: DBExecutor = db) {
	return executor
		.selectFrom("card_events as e")
		.leftJoin("users as u", "u.id", "e.actor_id")
		.leftJoin("cards as c", (join) =>
			join.onRef("c.id", "=", "e.card_id").on("c.deleted_at", "is", null),
		)
		.leftJoin("columns as fc", "fc.id", "e.from_column_id")
		.leftJoin("columns as tc", "tc.id", "e.to_column_id")
		.select([
			"e.id",
			"e.event_type",
			"e.payload",
			"e.created_at",
			"e.card_id",
			"u.username",
			"u.display_name",
			"c.title as current_card_title",
			"fc.title as from_column_title",
			"tc.title as to_column_title",
		]);
}

export function toTrackerEvent(e: {
	id: number;
	event_type: string;
	payload: unknown;
	created_at: Date;
	tracker_item_id: number | null;
	username: string | null;
	display_name: string | null;
	current_item_title: string | null;
}): WorkItemEvent {
	const payload = e.payload as
		| { title?: string }
		| Record<string, unknown>
		| null;
	const titleFromPayload =
		typeof payload?.title === "string" ? payload.title : null;
	return {
		id: e.id,
		eventType: e.event_type,
		trackerItemId: e.tracker_item_id,
		title: e.current_item_title ?? titleFromPayload,
		payload: payload ?? null,
		actor: e.username
			? { username: e.username, displayName: e.display_name }
			: null,
		createdAt: e.created_at.toISOString(),
	};
}

export function toCardTrackerEvent(e: {
	id: number;
	event_type: string;
	payload: unknown;
	created_at: Date;
	card_id: number | null;
	username: string | null;
	display_name: string | null;
	current_card_title: string | null;
	from_column_title: string | null;
	to_column_title: string | null;
}): WorkItemEvent {
	const payload = e.payload as
		| { title?: string; cardTitle?: string }
		| Record<string, unknown>
		| null;
	const titleFromPayload =
		typeof payload?.cardTitle === "string"
			? payload.cardTitle
			: typeof payload?.title === "string"
				? payload.title
				: null;
	const eventType =
		e.event_type === "create"
			? "tracker_item_created"
			: e.event_type === "delete"
				? "tracker_item_deleted"
				: "tracker_item_updated";
	return {
		id: e.id,
		eventType,
		trackerItemId: null,
		title: e.current_card_title ?? titleFromPayload,
		payload:
			e.event_type === "move"
				? {
						field: "status",
						from: e.from_column_title,
						to: e.to_column_title,
					}
				: (payload ?? null),
		actor: e.username
			? { username: e.username, displayName: e.display_name }
			: null,
		createdAt: e.created_at.toISOString(),
	};
}

export async function getWorkItemEvents(
	executor: DBExecutor,
	workspaceId: number,
	keyNumber: number,
): Promise<WorkItemEvent[] | null> {
	const trackerItem = await findTrackerItemByKeyNumber(
		executor,
		workspaceId,
		keyNumber,
	);
	if (trackerItem) {
		const rows = await trackerEventSelect(executor)
			.where("e.tracker_item_id", "=", trackerItem.id)
			.where("e.workspace_id", "=", workspaceId)
			.orderBy("e.created_at", "desc")
			.orderBy("e.id", "desc")
			.execute();
		return rows.map(toTrackerEvent);
	}

	const boardCard = await findBoardCardByKeyNumber(
		executor,
		workspaceId,
		keyNumber,
	);
	if (boardCard) {
		const rows = await cardEventSelect(executor)
			.where("e.card_id", "=", boardCard.id)
			.where("e.workspace_id", "=", workspaceId)
			.orderBy("e.created_at", "desc")
			.orderBy("e.id", "desc")
			.execute();
		return rows.map(toCardTrackerEvent);
	}

	return null;
}

function toUnifiedCardActivity(e: {
	id: number;
	event_type: string;
	payload: unknown;
	created_at: Date;
	username: string | null;
	display_name: string | null;
	current_card_title: string | null;
	from_column_title: string | null;
	to_column_title: string | null;
}): UnifiedActivityEvent {
	const adapted = toCardTrackerEvent({
		...e,
		card_id: null,
	});
	return {
		eventKey: `board:${adapted.id}`,
		id: adapted.id,
		source: "board",
		eventType: adapted.eventType,
		title: adapted.title,
		payload: adapted.payload,
		actor: adapted.actor,
		createdAt: adapted.createdAt,
	};
}

function toUnifiedTrackerActivity(e: {
	id: number;
	event_type: string;
	payload: unknown;
	created_at: Date;
	username: string | null;
	display_name: string | null;
	current_item_title: string | null;
}): UnifiedActivityEvent {
	const adapted = toTrackerEvent({
		...e,
		tracker_item_id: null,
	});
	return {
		eventKey: `tracker:${adapted.id}`,
		id: adapted.id,
		source: "tracker",
		eventType: adapted.eventType,
		title: adapted.title,
		payload: adapted.payload,
		actor: adapted.actor,
		createdAt: adapted.createdAt,
	};
}

export async function getUnifiedWorkspaceActivity(
	workspaceId: number,
	limit: number,
): Promise<UnifiedActivityEvent[]> {
	const rows = await sql<{
		source: "board" | "tracker";
		id: number;
		event_type: string;
		payload: unknown;
		created_at: Date;
		username: string | null;
		display_name: string | null;
		current_title: string | null;
		from_column_title: string | null;
		to_column_title: string | null;
	}>`
		SELECT * FROM (
			SELECT
				'board'::text AS source,
				e.id,
				e.event_type,
				e.payload,
				e.created_at,
				u.username,
				u.display_name,
				c.title AS current_title,
				fc.title AS from_column_title,
				tc.title AS to_column_title
			FROM card_events e
			LEFT JOIN users u ON u.id = e.actor_id
			LEFT JOIN cards c ON c.id = e.card_id AND c.deleted_at IS NULL
			LEFT JOIN columns fc ON fc.id = e.from_column_id
			LEFT JOIN columns tc ON tc.id = e.to_column_id
			WHERE e.workspace_id = ${workspaceId}
			UNION ALL
			SELECT
				'tracker'::text AS source,
				e.id,
				e.event_type,
				e.payload,
				e.created_at,
				u.username,
				u.display_name,
				ti.title AS current_title,
				NULL::text AS from_column_title,
				NULL::text AS to_column_title
			FROM tracker_events e
			LEFT JOIN users u ON u.id = e.actor_id
			LEFT JOIN tracker_items ti ON ti.id = e.tracker_item_id AND ti.deleted_at IS NULL
			WHERE e.workspace_id = ${workspaceId}
		) unified
		ORDER BY created_at DESC, id DESC
		LIMIT ${limit}
	`.execute(db);

	return rows.rows.map((row) => {
		if (row.source === "board") {
			return toUnifiedCardActivity({
				id: row.id,
				event_type: row.event_type,
				payload: row.payload,
				created_at: row.created_at,
				username: row.username,
				display_name: row.display_name,
				current_card_title: row.current_title,
				from_column_title: row.from_column_title,
				to_column_title: row.to_column_title,
			});
		}
		return toUnifiedTrackerActivity({
			id: row.id,
			event_type: row.event_type,
			payload: row.payload,
			created_at: row.created_at,
			username: row.username,
			display_name: row.display_name,
			current_item_title: row.current_title,
		});
	});
}
