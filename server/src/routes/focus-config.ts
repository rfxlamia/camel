import { Router } from "express";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";

export const focusConfigRouter = Router();

focusConfigRouter.get("/focus/config", requireAuth, (_req, res) => {
	res.json({ enabled: config.FOCUS_MODE_ENABLED === "true" });
});
