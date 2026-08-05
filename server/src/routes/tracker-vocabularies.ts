import { Router } from "express";
import { sql } from "kysely";
import { generateRandomPastelBorder } from "../core/pastelColor.js";
import { db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";
import { recordTrackerActivity } from "./tracker-activity.js";

const VOCAB_KINDS = ["status", "priority", "label"] as const;
type VocabKind = (typeof VOCAB_KINDS)[number];

const RETURNING_COLUMNS = [
	"id",
	"kind",
	"name",
	"position",
	"colour",
	"category",
	"created_at",
] as const;

function isVocabKind(value: string): value is VocabKind {
	return (VOCAB_KINDS as readonly string[]).includes(value);
}

function serializeVocabulary(row: {
	id: number;
	kind: string;
	name: string;
	position: number;
	colour: string;
	category: string | null;
	created_at: Date | string;
}) {
	return {
		id: row.id,
		kind: row.kind,
		name: row.name,
		position: row.position,
		colour: row.colour,
		category: row.category,
		createdAt: row.created_at,
	};
}

export const trackerVocabulariesRouter = Router({ mergeParams: true });

trackerVocabulariesRouter.get(
	"/tracker/vocabularies",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const kind = typeof req.query.kind === "string" ? req.query.kind : "";

		if (!isVocabKind(kind)) {
			return res
				.status(400)
				.json({ error: "kind must be status, priority, or label" });
		}

		const rows = await db
			.selectFrom("tracker_vocabularies")
			.select(RETURNING_COLUMNS)
			.where("workspace_id", "=", workspaceId)
			.where("kind", "=", kind)
			.orderBy("position", "asc")
			.execute();

		res.json(rows.map(serializeVocabulary));
	},
);

trackerVocabulariesRouter.post(
	"/tracker/vocabularies",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const actor = req.user!;
		const { kind, name, position, colour } = req.body ?? {};

		if (!isVocabKind(kind)) {
			return res
				.status(400)
				.json({ error: "kind must be status, priority, or label" });
		}

		if (kind === "status") {
			return res
				.status(400)
				.json({ error: "The status vocabulary is fixed." });
		}

		const trimmedName = typeof name === "string" ? name.trim() : "";
		if (!trimmedName) {
			return res.status(400).json({ error: "name is required" });
		}

		if (typeof position !== "number" || !Number.isFinite(position)) {
			return res.status(400).json({ error: "position must be a number" });
		}

		const duplicate = await db
			.selectFrom("tracker_vocabularies")
			.select("id")
			.where("workspace_id", "=", workspaceId)
			.where("kind", "=", kind)
			.where(sql`lower(name)`, "=", trimmedName.toLowerCase())
			.executeTakeFirst();

		if (duplicate) {
			return res.status(409).json({ error: "Vocabulary name already exists" });
		}

		const resolvedColour =
			typeof colour === "string" && colour.trim().length > 0
				? colour.trim()
				: generateRandomPastelBorder();

		try {
			const created = await db.transaction().execute(async (trx) => {
				const row = await trx
					.insertInto("tracker_vocabularies")
					.values({
						workspace_id: workspaceId,
						kind,
						name: trimmedName,
						position,
						colour: resolvedColour,
					})
					.returning(RETURNING_COLUMNS)
					.executeTakeFirstOrThrow();

				await recordTrackerActivity(
					trx,
					actor,
					workspaceId,
					"tracker_vocabulary_created",
					{
						payload: {
							vocabularyId: row.id,
							kind,
							name: trimmedName,
						},
					},
				);

				return row;
			});

			await publishEvent(workspaceId, {
				type: "tracker.vocabulary.created",
				actor,
			});
			res.status(201).json(serializeVocabulary(created));
		} catch (err: unknown) {
			const pgErr = err as { code?: string };
			if (pgErr.code === "23505") {
				return res
					.status(409)
					.json({ error: "Vocabulary name already exists" });
			}
			throw err;
		}
	},
);
