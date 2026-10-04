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

// Hub methods are closures (no `this`), so these live bindings are the hub's
// own functions. `useHub` re-points them whenever the singleton is replaced.
export let publishEvent = activeHub.publishEvent;
export let sseHandler = activeHub.sseHandler;
export let heartbeat = activeHub.heartbeat;
export let clearPresence = activeHub.clearPresence;
export let onlineUsers = activeHub.onlineUsers;

function useHub(hub: RealtimeHub): void {
	activeHub = hub;
	publishEvent = hub.publishEvent;
	sseHandler = hub.sseHandler;
	heartbeat = hub.heartbeat;
	clearPresence = hub.clearPresence;
	onlineUsers = hub.onlineUsers;
}

/** Replace the singleton only in integration tests that exercise the real hub. */
export function setRealtimeHubForTests(hub: RealtimeHub | null): void {
	useHub(hub ?? createDisconnectedHub());
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
		useHub(
			createRealtimeHub({
				publisher: client,
				subscriber: sub,
				presence: client,
			}),
		);
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
				// already logged by reconnectSubscriber before it rethrew
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
