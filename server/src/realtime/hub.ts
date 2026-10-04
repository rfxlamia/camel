import { logger } from "../lib/logger.js";
import { createPresenceManager } from "./presence.js";
import { createEventPublisher } from "./publisher.js";
import { createSseManager } from "./sse.js";
import type {
	LocalTestClient,
	PresenceLike,
	PublishableEvent,
	RealtimeHubDeps,
} from "./types.js";

export function createRealtimeHub(deps: RealtimeHubDeps) {
	let redisAvailable = deps.publisher !== null;
	const localTestClients = new Set<LocalTestClient>();
	const isRedisAvailable = () => redisAvailable;

	const sse = createSseManager();
	const presence = createPresenceManager({
		presence: (deps.presence ?? deps.publisher) as PresenceLike | null,
		isRedisAvailable,
	});

	function fanOut(
		workspaceId: number,
		message: string,
		event: PublishableEvent,
	): void {
		sse.fanOut(workspaceId, message, event);
		for (const client of localTestClients) {
			if (client.workspaceId === workspaceId) client.buffer.push(event);
		}
	}

	const publisher = createEventPublisher({ deps, isRedisAvailable, fanOut });

	function setRedisAvailable(available: boolean): void {
		if (redisAvailable === available) return;
		logger.info(
			{ from: redisAvailable, to: available },
			"Redis availability changed",
		);
		redisAvailable = available;
	}

	function connectLocalClient({ workspaceId }: { workspaceId: number }) {
		const client: LocalTestClient = { workspaceId, buffer: [] };
		localTestClients.add(client);
		return {
			drain: () => {
				const events = [...client.buffer];
				client.buffer = [];
				return events;
			},
		};
	}

	return {
		setRedisAvailable,
		connectLocalClient,
		connectSubscriber: publisher.connectSubscriber,
		reconnectSubscriber: publisher.reconnectSubscriber,
		publishEvent: publisher.publishEvent,
		sseHandler: sse.handler,
		shutdown: sse.shutdown,
		heartbeat: presence.heartbeat,
		clearPresence: presence.clearPresence,
		onlineUsers: presence.onlineUsers,
	};
}

export type RealtimeHub = ReturnType<typeof createRealtimeHub>;
