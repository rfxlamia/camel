import { sql } from "kysely";
import type { DBExecutor } from "../../db/kysely.js";

export async function batchUpdateCardPositions(
	dbExec: DBExecutor,
	workspaceId: number,
	columnId: number,
	rows: ReadonlyArray<{ id: number; position: number }>,
): Promise<void> {
	if (rows.length === 0) return;

	const values = sql.join(
		rows.map(
			({ id, position }) =>
				sql`(${id}::integer, ${position}::double precision)`,
		),
		sql`, `,
	);

	await sql`
		UPDATE cards AS c
		SET position = v.position
		FROM (VALUES ${values}) AS v(id, position)
		WHERE c.id = v.id
			AND c.workspace_id = ${workspaceId}
			AND c.column_id = ${columnId}
			AND c.deleted_at IS NULL
	`.execute(dbExec);
}
