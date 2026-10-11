import { sql } from "kysely";
import type { DBExecutor } from "../../db/kysely.js";

// ---------------------------------------------------------------------------
// Artifact DB helpers — exported for unit tests
// ---------------------------------------------------------------------------

export const realArtifactDeps = {
	insertArtifact: async (
		dbExec: DBExecutor,
		data: {
			boardId: number;
			workspaceId: number;
			filename: string;
			format: "md";
			content: string;
		},
	): Promise<void> => {
		await dbExec
			.insertInto("agent_artifacts")
			.values({
				board_id: data.boardId,
				workspace_id: data.workspaceId,
				filename: data.filename,
				format: data.format,
				content: data.content,
			})
			.onConflict((oc) =>
				oc.column("board_id").doUpdateSet((eb) => ({
					filename: eb.ref("excluded.filename"),
					content: eb.ref("excluded.content"),
					format: eb.ref("excluded.format"),
					created_at: sql`now()`,
				})),
			)
			.execute();
	},

	getArtifact: async (
		dbExec: DBExecutor,
		boardId: number,
	): Promise<{
		filename: string;
		format: "md";
		content: string;
	} | null> => {
		const row = await dbExec
			.selectFrom("agent_artifacts")
			.select(["filename", "format", "content"])
			.where("board_id", "=", boardId)
			.executeTakeFirst();
		if (!row) return null;
		return {
			filename: row.filename,
			format: row.format as "md",
			content: row.content,
		};
	},
};

export function buildArtifactDownload(data: {
	filename: string;
	content: string;
}): { headers: Record<string, string>; body: string } {
	return {
		headers: {
			"Content-Disposition": `attachment; filename="${data.filename}"`,
			"Content-Type": "text/markdown; charset=utf-8",
		},
		body: data.content,
	};
}
