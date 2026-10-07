import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getListLatencySnapshot } from "../core/work-item-latency.js";

export const HEALTH_PATH = "/api/health";

const FALLBACK_BUILD_ID = `dev-${randomUUID()}`;

export function buildHealthPayload() {
	return {
		ok: true as const,
		buildId: process.env.BUILD_ID || FALLBACK_BUILD_ID,
		workItemsListLatency: getListLatencySnapshot(),
	};
}

export function registerHealthRoutes(
	app: Express,
	opts: { isShuttingDown: () => boolean },
): void {
	app.get(["/health", HEALTH_PATH], (_req, res) => {
		if (opts.isShuttingDown()) {
			return res.status(503).json({ status: "shutting_down" });
		}
		res.json(buildHealthPayload());
	});
}
