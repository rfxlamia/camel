import { describe, expect, it, vi } from "vitest";
import {
	createRealtimeHub,
	workspaceEventChannel,
	workspacePresencePattern,
} from "./realtime.js";

describe("workspace realtime isolation", () => {
	it("keeps local fallback clients isolated by workspace", async () => {
		const hub = createRealtimeHub({ publisher: null, subscriber: null });
		const wsA = hub.connectLocalClient({ workspaceId: 1 });
		const wsB = hub.connectLocalClient({ workspaceId: 2 });

		await hub.publishEvent(2, { type: "card.created", cardId: 42 });

		expect(wsA.drain()).toEqual([]);
		expect(wsB.drain()).toEqual([{ type: "card.created", cardId: 42 }]);
	});

	it("uses workspace-specific Redis channels and presence key scans", async () => {
		expect(workspaceEventChannel(7)).toBe("camel:workspace:7:events");
		expect(workspacePresencePattern(7)).toBe("camel:workspace:7:presence:*");

		const publish = vi.fn(async () => 1);
		const scanIterator = vi.fn(async function* () {
			yield "camel:workspace:7:presence:1";
		});
		const hub = createRealtimeHub({
			publisher: { publish },
			subscriber: null,
			presence: { scanIterator },
		});

		await hub.publishEvent(7, { type: "card.updated", cardId: 5 });
		await hub.onlineUsers(7);

		expect(publish).toHaveBeenCalledWith(
			"camel:workspace:7:events",
			expect.any(String),
		);
		expect(scanIterator).toHaveBeenCalledWith({
			MATCH: "camel:workspace:7:presence:*",
		});
	});
});

describe("agent live-thinking event round-trip", () => {
	it("preserves type, columnSlug, token, and boardId through local fan-out", async () => {
		const hub = createRealtimeHub({ publisher: null, subscriber: null });
		const client = hub.connectLocalClient({ workspaceId: 1 });

		await hub.publishEvent(1, {
			type: "agent.card.thinking",
			columnSlug: "analysis-specialist",
			token: "let me reason",
			boardId: 42,
		});

		expect(client.drain()).toEqual([
			{
				type: "agent.card.thinking",
				columnSlug: "analysis-specialist",
				token: "let me reason",
				boardId: 42,
			},
		]);
	});
});

describe("Redis reconnection", () => {
	it("setRedisAvailable flips the flag and logs on change", () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const hub = createRealtimeHub({ publisher: null, subscriber: null });

		// Initially false (no publisher)
		hub.setRedisAvailable(true);
		expect(consoleSpy).toHaveBeenCalledWith(
			"Redis availability changed: false → true",
		);

		// Setting same value again should not log
		consoleSpy.mockClear();
		hub.setRedisAvailable(true);
		expect(consoleSpy).not.toHaveBeenCalled();

		consoleSpy.mockRestore();
	});

	it("reconnectSubscriber calls connectSubscriber", async () => {
		const pSubscribe = vi.fn(async () => {});
		const hub = createRealtimeHub({
			publisher: null,
			subscriber: { pSubscribe },
		});

		await hub.reconnectSubscriber();
		expect(pSubscribe).toHaveBeenCalledWith(
			"camel:workspace:*:events",
			expect.any(Function),
		);
	});

	it("reconnectSubscriber handles errors gracefully", async () => {
		const pSubscribe = vi.fn(async () => {
			throw new Error("connection lost");
		});
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const hub = createRealtimeHub({
			publisher: null,
			subscriber: { pSubscribe },
		});

		// Should not throw
		await hub.reconnectSubscriber();
		expect(consoleSpy).toHaveBeenCalledWith(
			"Redis re-subscribe failed:",
			expect.any(Error),
		);

		consoleSpy.mockRestore();
	});

	it("publishEvent uses Redis when available after reconnection", async () => {
		const publish = vi.fn(async () => 1);
		const hub = createRealtimeHub({
			publisher: { publish },
			subscriber: null,
		});

		// Flip to unavailable then back
		hub.setRedisAvailable(false);
		hub.setRedisAvailable(true);

		await hub.publishEvent(1, { type: "card.created", cardId: 1 });
		expect(publish).toHaveBeenCalled();
	});

	it("publishEvent falls back to local fan-out when redisAvailable is false", async () => {
		const publish = vi.fn(async () => 1);
		const hub = createRealtimeHub({
			publisher: { publish },
			subscriber: null,
		});
		const client = hub.connectLocalClient({ workspaceId: 1 });

		// Flip to unavailable
		hub.setRedisAvailable(false);

		await hub.publishEvent(1, { type: "card.created", cardId: 1 });
		expect(publish).not.toHaveBeenCalled();
		expect(client.drain()).toHaveLength(1);
	});
});
