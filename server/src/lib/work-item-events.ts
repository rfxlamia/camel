import { sql } from "kysely";
import type { DBExecutor } from "../db/kysely.js";
import { db } from "../db/kysely.js";
import {
	toCardTrackerEvent,
	toTrackerEvent,
} from "./work-item-event-mappers.js";
import { findWorkItemByKeyNumber } from "./work-item-response.js";

export { toCardTrackerEvent, toTrackerEvent };

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

export async function getWorkItemEvents(
	executor: DBExecutor,
	workspaceId: number,
	keyNumber: number,
): Promise<WorkItemEvent[] | null> {
	const item = await findWorkItemByKeyNumber(executor, workspaceId, keyNumber);
	if (!item) return null;

	const rows = await cardEventSelect(executor)
		.where("e.card_id", "=", item.id)
		.where("e.workspace_id", "=", workspaceId)
		.orderBy("e.created_at", "desc")
		.orderBy("e.id", "desc")
		.execute();
	if (item.column_id != null) return rows.map(toCardTrackerEvent);
	return rows.map((e) =>
		toTrackerEvent({
			...e,
			tracker_item_id: e.card_id,
			current_item_title: e.current_card_title,
		}),
	);
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
	// One table: source is "tracker" for item-less events and column-less items,
	// otherwise "board". The source join keeps soft-deleted cards so their events
	// do not flip to "tracker"; only the title join hides them.
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
		SELECT
			CASE WHEN c.id IS NULL OR c.column_id IS NULL
				THEN 'tracker' ELSE 'board' END AS source,
			e.id,
			e.event_type,
			e.payload,
			e.created_at,
			u.username,
			u.display_name,
			CASE WHEN c.deleted_at IS NULL THEN c.title END AS current_title,
			fc.title AS from_column_title,
			tc.title AS to_column_title
		FROM card_events e
		LEFT JOIN users u ON u.id = e.actor_id
		LEFT JOIN cards c ON c.id = e.card_id
		LEFT JOIN columns fc ON fc.id = e.from_column_id
		LEFT JOIN columns tc ON tc.id = e.to_column_id
		WHERE e.workspace_id = ${workspaceId}
			AND (e.card_id IS NOT NULL OR e.event_type LIKE 'tracker\\_%' ESCAPE '\\')
		ORDER BY e.created_at DESC, e.id DESC
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
