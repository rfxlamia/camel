import { Router } from "express";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { createTrackerItemHandler } from "./tracker-item-create.js";
import { deleteTrackerItemHandler } from "./tracker-item-delete.js";
import {
	getTrackerItemEventsHandler,
	getTrackerItemHandler,
	listTrackerItemsHandler,
} from "./tracker-item-read.js";
import { reorderTrackerItemHandler } from "./tracker-item-reorder.js";
import { updateTrackerItemHandler } from "./tracker-item-update.js";

export const trackerItemsRouter = Router({ mergeParams: true });

trackerItemsRouter.get(
	"/tracker/items",
	requireWorkspaceMember,
	listTrackerItemsHandler,
);

trackerItemsRouter.post(
	"/tracker/items",
	requireWorkspaceMember,
	createTrackerItemHandler,
);

trackerItemsRouter.get(
	"/tracker/items/:key",
	requireWorkspaceMember,
	getTrackerItemHandler,
);

trackerItemsRouter.patch(
	"/tracker/items/:key/position",
	requireWorkspaceMember,
	reorderTrackerItemHandler,
);

trackerItemsRouter.patch(
	"/tracker/items/:key",
	requireWorkspaceMember,
	updateTrackerItemHandler,
);

trackerItemsRouter.delete(
	"/tracker/items/:key",
	requireWorkspaceMember,
	deleteTrackerItemHandler,
);

trackerItemsRouter.get(
	"/tracker/items/:key/events",
	requireWorkspaceMember,
	getTrackerItemEventsHandler,
);
