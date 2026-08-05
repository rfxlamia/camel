// Keep in sync with schema.sql retroactive seed (DO $$ block) and -- tracker: category backfill
import type { DBExecutor } from "../db/kysely.js";
import { POSITION_GAP } from "./position.js";

export type TrackerVocabularySeedRow = {
	kind: "status" | "priority" | "label";
	name: string;
	position: number;
	colour: string;
	category?: string | null;
};

export const DEFAULT_TRACKER_VOCABULARY: TrackerVocabularySeedRow[] = [
	{
		kind: "status",
		name: "Backlog",
		position: POSITION_GAP,
		colour: "oklch(0.89 0.07 250)",
		category: "backlog",
	},
	{
		kind: "status",
		name: "Todo",
		position: POSITION_GAP * 2,
		colour: "oklch(0.89 0.07 200)",
		category: "backlog",
	},
	{
		kind: "status",
		name: "In Progress",
		position: POSITION_GAP * 3,
		colour: "oklch(0.89 0.07 150)",
		category: "started",
	},
	{
		kind: "status",
		name: "Done",
		position: POSITION_GAP * 4,
		colour: "oklch(0.89 0.07 140)",
		category: "completed",
	},
	{
		kind: "status",
		name: "Canceled",
		position: POSITION_GAP * 5,
		colour: "oklch(0.89 0.07 30)",
		category: "canceled",
	},
	{
		kind: "priority",
		name: "High",
		position: POSITION_GAP,
		colour: "oklch(0.89 0.07 25)",
	},
	{
		kind: "priority",
		name: "Medium",
		position: POSITION_GAP * 2,
		colour: "oklch(0.89 0.07 85)",
	},
	{
		kind: "priority",
		name: "Low",
		position: POSITION_GAP * 3,
		colour: "oklch(0.89 0.07 220)",
	},
	{
		kind: "label",
		name: "Feature",
		position: POSITION_GAP,
		colour: "oklch(0.89 0.07 280)",
	},
	{
		kind: "label",
		name: "Bug",
		position: POSITION_GAP * 2,
		colour: "oklch(0.89 0.07 15)",
	},
	{
		kind: "label",
		name: "Maintain",
		position: POSITION_GAP * 3,
		colour: "oklch(0.89 0.07 180)",
	},
];

export async function seedTrackerVocabulary(
	trx: DBExecutor,
	workspaceId: number,
): Promise<void> {
	await trx
		.insertInto("tracker_vocabularies")
		.values(
			DEFAULT_TRACKER_VOCABULARY.map((row) => ({
				workspace_id: workspaceId,
				kind: row.kind,
				name: row.name,
				position: row.position,
				colour: row.colour,
				category: row.category ?? null,
			})),
		)
		.execute();
}
