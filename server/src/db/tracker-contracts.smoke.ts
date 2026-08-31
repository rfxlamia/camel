import type { BoardEvent } from "../realtime.js";
import { db } from "./kysely.js";
import type { DB } from "./types.js";

// Compile-only contract checks — not imported at runtime.
void db.selectFrom("tracker_projects").selectAll();
void db.selectFrom("tracker_phases").selectAll();

type _ItemCols = Pick<
	DB["tracker_items"],
	"project_id" | "phase_id" | "start_date" | "end_date" | "completed_at" | "position"
>;
type _VocabCols = Pick<DB["tracker_vocabularies"], "category">;

const _events: BoardEvent["type"][] = [
	"column.deleted",
	"tracker.project.created",
	"tracker.project.updated",
	"tracker.project.deleted",
	"tracker.phase.created",
	"tracker.phase.updated",
	"tracker.phase.deleted",
];
