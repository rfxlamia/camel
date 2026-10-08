import { type SqlBool, sql } from "kysely";

/**
 * Board-scoped activity readers (GET /activity, chat and agent query_board_data)
 * must never surface tracker-prefixed events. After the work-items merge copy,
 * card_events also holds tracker_item_*, tracker_project_*, tracker_phase_* and
 * tracker_vocabulary_* rows; those belong to the unified feed only.
 *
 * The underscore is escaped so it matches a literal "_" instead of acting as a
 * single-character LIKE wildcard. Expects the `card_events as e` alias.
 */
export const excludeTrackerEvents = sql<SqlBool>`e.event_type NOT LIKE ${"tracker\\_%"} ESCAPE '\\'`;
