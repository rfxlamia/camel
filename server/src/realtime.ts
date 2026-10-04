import type { RedisClientType } from "redis";
import { getRedisClient } from "./db/redis.js";
import { logger } from "./lib/logger.js";
import { createRealtimeHub, type RealtimeHub } from "./realtime/hub.js";

// Redis carries the real-time layer (presence + pub/sub). If it is down the
// app must keep working: presence degrades to "just me" and events fall back
// to direct in-process fan-out (fine for a single server instance).

export { connectRedis } from "./db/redis.js";
export {
	workspaceEventChannel,
	workspacePresenceKey,
	workspacePresencePattern,
} from "./realtime/channels.js";
export { createRealtimeHub } from "./realtime/hub.js";
export type {
	AttachmentEventPayload,
	BoardEvent,
	RealtimeHubDeps,
} from "./realtime/types.js";

// ---- Production singleton ----------------------------------------------------

function createDisconnectedHub(): RealtimeHub {
	return createRealtimeHub({
		publisher: null,
		subscriber: null,
		presence: null,
	});
}

let activeHub: RealtimeHub = createDisconnectedHub();
let activeSubscriber: RedisClientType | null = null;

// Consumers capture these exports into dependency objects at module load
// (lib/helpers.ts, modules/agent/routes.ts), before initRealtime() swaps the
// hub. Each export must therefore resolve `activeHub` at call time rather than
// being bound to a particular hub.
export function publishEvent(
	...args: Parameters<RealtimeHub["publishEvent"]>
): ReturnType<RealtimeHub["publishEvent"]> {
	return activeHub.publishEvent(...args);
}

export function sseHandler(
	...args: Parameters<RealtimeHub["sseHandler"]>
): ReturnType<RealtimeHub["sseHandler"]> {
	return activeHub.sseHandler(...args);
}

export function heartbeat(
	...args: Parameters<RealtimeHub["heartbeat"]>
): ReturnType<RealtimeHub["heartbeat"]> {
	return activeHub.heartbeat(...args);
}

export function clearPresence(
	...args: Parameters<RealtimeHub["clearPresence"]>
): ReturnType<RealtimeHub["clearPresence"]> {
	return activeHub.clearPresence(...args);
}

export function onlineUsers(
	...args: Parameters<RealtimeHub["onlineUsers"]>
): ReturnType<RealtimeHub["onlineUsers"]> {
	return activeHub.onlineUsers(...args);
}

/** Replace the singleton only in integration tests that exercise the real hub. */
export function setRealtimeHubForTests(hub: RealtimeHub | null): void {
	activeHub = hub ?? createDisconnectedHub();
}

export async function initRealtime(): Promise<void> {
	const client = getRedisClient();
	if (!client) {
		logger.warn(
			"Redis not reachable — presence/real-time degraded (board still works)",
		);
		return;
	}

	try {
		const sub = client.duplicate();
		sub.on("error", (err) => {
			logger.error({ err }, "Redis subscriber error");
		});
		await sub.connect();
		activeSubscriber = sub;
		activeHub = createRealtimeHub({
			publisher: client,
			subscriber: sub,
			presence: client,
		});
		await activeHub.connectSubscriber();

		// Reconnection handlers — attach AFTER initial setup to avoid
		// firing during the first connect.
		client.on("ready", () => {
			activeHub.setRedisAvailable(true);
		});
		client.on("error", () => {
			activeHub.setRedisAvailable(false);
		});
		sub.on("ready", () => {
			activeHub.reconnectSubscriber().catch(() => {
				// reconnectSubscriber logs the failure and rethrows by design; this is
				// its only caller, and the next "ready" event retries.
			});
		});

		logger.info("Redis connected — real-time layer active");
	} catch {
		logger.warn(
			"Redis not reachable — presence/real-time degraded (board still works)",
		);
	}
}

export async function shutdownRealtime(): Promise<void> {
	activeHub.shutdown();
	await Promise.allSettled([
		activeSubscriber?.quit(),
		getRedisClient()?.quit(),
	]);
}
