import { Router } from "express";
import { trackerItemsRouter } from "./tracker-items.js";

/**
 * Canonical `/work-items` routes alias the legacy `/tracker/items` handlers.
 * Rewrites the URL before dispatch so handler logic is not duplicated.
 */
export const workItemsRouter = Router({ mergeParams: true });

workItemsRouter.use((req, _res, next) => {
	req.url = req.url.replace(/^\/work-items/, "/tracker/items");
	next();
});

workItemsRouter.use(trackerItemsRouter);
