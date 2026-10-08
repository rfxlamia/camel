import { sql } from "kysely";
import type { DBExecutor } from "../db/kysely.js";

export type PreconditionViolation = { precondition: string; count: number };

type PreconditionRow = {
	null_key: number;
	null_status: number;
	null_column: number;
	already_migrated: number;
};

/**
 * Counts rows that break the assumptions the merge parity check relies on.
 * Any violation must abort `snapshot` before the merge: otherwise `verify`
 * can false-fail after commit and force a full restore instead of a cheap abort.
 * Returns counts only, never row contents.
 */
export async function findPreconditionViolations(
	dbExec: DBExecutor,
): Promise<PreconditionViolation[]> {
	const { rows } = await sql<PreconditionRow>`
		SELECT
			(SELECT count(*)::integer FROM cards
				WHERE deleted_at IS NULL AND key_number IS NULL) AS null_key,
			(SELECT count(*)::integer FROM cards
				WHERE deleted_at IS NULL AND status_id IS NULL) AS null_status,
			(SELECT count(*)::integer FROM cards
				WHERE deleted_at IS NULL AND column_id IS NULL) AS null_column,
			(SELECT count(*)::integer FROM tracker_items
				WHERE migrated_to_id IS NOT NULL) AS already_migrated
	`.execute(dbExec);
	const row = rows[0];
	const checks: PreconditionViolation[] = [
		{ precondition: "live cards with NULL key_number", count: row.null_key },
		{
			precondition: "live cards with NULL status_id",
			count: row.null_status,
		},
		{
			precondition: "live cards with NULL column_id",
			count: row.null_column,
		},
		{
			precondition: "tracker_items rows with migrated_to_id already set",
			count: row.already_migrated,
		},
	];
	return checks
		.map((check) => ({ ...check, count: Number(check.count) }))
		.filter((check) => check.count > 0);
}
