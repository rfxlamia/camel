import { cleanupExpiredSessions } from "../auth.js";
import {
	initNotificationService,
	startDueDateScheduler,
} from "../modules/notifications/index.js";
import { initRealtime } from "../realtime.js";
import { startWorkItemLatencyReporter } from "./work-item-latency.js";

const SESSION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let cleanupInterval: ReturnType<typeof setInterval> | undefined;
let latencyReporterInterval: ReturnType<typeof setInterval> | undefined;
let dueDateSchedulerInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Starts schedulers, the latency reporter, the notification listeners and the
 * Redis subscriber. `BACKGROUND_JOBS=off` starts none of them (maintenance
 * mode); any other value, or unset, starts all. HTTP/SSE are unaffected.
 */
export async function startBackgroundJobs(): Promise<void> {
	if (process.env["BACKGROUND_JOBS"] === "off") return;

	await initRealtime();
	initNotificationService();
	dueDateSchedulerInterval = startDueDateScheduler();
	latencyReporterInterval = startWorkItemLatencyReporter();

	// Cleanup expired sessions on startup, then every 24 hours.
	await cleanupExpiredSessions();
	cleanupInterval = setInterval(
		cleanupExpiredSessions,
		SESSION_CLEANUP_INTERVAL_MS,
	);
}

/** Clears the timers owned by this module that shutdown used to clear. */
export function stopBackgroundJobs(): void {
	if (cleanupInterval) clearInterval(cleanupInterval);
	if (latencyReporterInterval) clearInterval(latencyReporterInterval);
	if (dueDateSchedulerInterval) clearInterval(dueDateSchedulerInterval);
	cleanupInterval = undefined;
	latencyReporterInterval = undefined;
	dueDateSchedulerInterval = undefined;
}
