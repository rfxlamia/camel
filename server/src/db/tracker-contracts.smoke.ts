import type { BoardEvent } from "../realtime.js";
import { db } from "./kysely.js";

// Compile-only contract checks — not imported at runtime.
void db.selectFrom("tracker_projects").selectAll();
void db.selectFrom("tracker_phases").selectAll();

const _events: BoardEvent["type"][] = [
	"tracker.project.created",
	"tracker.project.updated",
	"tracker.project.deleted",
	"tracker.phase.created",
	"tracker.phase.updated",
	"tracker.phase.deleted",
];
