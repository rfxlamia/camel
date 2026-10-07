import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getListLatencySnapshot } from "../core/work-item-latency.js";

export const HEALTH_PATH = "/api/health";

const FALLBACK_BUILD_ID = `dev-${randomUUID()}`;

function currentBuildId(): string {
	return process.env.BUILD_ID || FALLBACK_BUILD_ID;
}

/** Public payload: no usage or latency data leaves the internal route. */
export function buildPublicHealthPayload() {
	return { ok: true as const, buildId: currentBuildId() };
}

/** Internal payload for /health (not proxied by nginx). */
export function buildHealthPayload() {
	return {
		...buildPublicHealthPayload(),
		workItemsListLatency: getListLatencySnapshot(),
	};
}

export function registerHealthRoutes(
	app: Express,
	opts: { isShuttingDown: () => boolean },
): void {
	app.get("/health", (_req, res) => {
		if (opts.isShuttingDown()) {
			return res.status(503).json({ status: "shutting_down" });
		}
		res.json(buildHealthPayload());
	});
	app.get(HEALTH_PATH, (_req, res) => {
		if (opts.isShuttingDown()) {
			return res.status(503).json({ status: "shutting_down" });
		}
		res.json(buildPublicHealthPayload());
	});
}
