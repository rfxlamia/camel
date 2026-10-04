import { logger } from "../lib/logger.js";
import {
	parseWorkspaceFromEventChannel,
	WORKSPACE_EVENTS_PATTERN,
	workspaceEventChannel,
} from "./channels.js";
import type { PublishableEvent, RealtimeHubDeps } from "./types.js";

type FanOut = (
	workspaceId: number,
	message: string,
	event: PublishableEvent,
) => void;

interface EventPublisherOptions {
	deps: RealtimeHubDeps;
	isRedisAvailable: () => boolean;
	fanOut: FanOut;
}

export function createEventPublisher({
	deps,
	isRedisAvailable,
	fanOut,
}: EventPublisherOptions) {
	function onRedisMessage(message: string, channel: string): void {
		const workspaceId = parseWorkspaceFromEventChannel(channel);
		if (workspaceId === null) return;
		try {
			fanOut(workspaceId, message, JSON.parse(message) as PublishableEvent);
		} catch {
			// ignore malformed payloads
		}
	}

	async function connectSubscriber(): Promise<void> {
		if (!deps.subscriber) return;
		await deps.subscriber.pSubscribe(WORKSPACE_EVENTS_PATTERN, onRedisMessage);
	}

	async function reconnectSubscriber(): Promise<void> {
		try {
			await connectSubscriber();
			logger.info(
				"Redis subscriber reconnected — re-subscribed to workspace events",
			);
		} catch (err) {
			logger.error({ err }, "Redis re-subscribe failed");
			throw err;
		}
	}

	async function publishEvent(
		workspaceId: number,
		event: PublishableEvent,
	): Promise<void> {
		const message = JSON.stringify({
			...event,
			at: new Date().toISOString(),
		});
		if (isRedisAvailable() && deps.publisher) {
			try {
				await deps.publisher.publish(
					workspaceEventChannel(workspaceId),
					message,
				);
				return;
			} catch {
				// fall through to local fan-out
			}
		}
		fanOut(workspaceId, message, event);
	}

	return { publishEvent, connectSubscriber, reconnectSubscriber };
}
