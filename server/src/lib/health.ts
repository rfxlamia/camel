import { randomUUID } from "node:crypto";
import { getListLatencySnapshot } from "../core/work-item-latency.js";

const FALLBACK_BUILD_ID = `dev-${randomUUID()}`;

export function buildHealthPayload() {
	return {
		ok: true as const,
		buildId: process.env.BUILD_ID || FALLBACK_BUILD_ID,
		workItemsListLatency: getListLatencySnapshot(),
	};
}
