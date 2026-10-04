import { describe, expect, it, vi } from "vitest";
import { logger } from "./lib/logger.js";
import type { AttachmentEventPayload, BoardEvent } from "./realtime.js";
import {
	createRealtimeHub,
	workspaceEventChannel,
	workspacePresencePattern,
} from "./realtime.js";

type MockRequest = {
	params: Record<string, string>;
	on: ReturnType<typeof vi.fn>;
	user?: { id: number };
};
type MockResponse = {
	writeHead: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
	status: ReturnType<typeof vi.fn>;
	json: ReturnType<typeof vi.fn>;
};

function mockSseRequest(workspaceId: number, userId?: number): MockRequest {
	return {
		params: { workspaceId: String(workspaceId) },
		on: vi.fn(),
		user: userId !== undefined ? { id: userId } : undefined,
	};
}

function mockSseResponse(): MockResponse {
	return {
		writeHead: vi.fn(),
		write: vi.fn(),
		end: vi.fn(),
		status: vi.fn().mockReturnThis(),
		json: vi.fn(),
	};
}

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

describe("SSE client workspace isolation", () => {
	it("fans out only to SSE clients in the target workspace", () => {
		const hub = createRealtimeHub({ publisher: null, subscriber: null });

		const reqA = mockSseRequest(1);
		const resA = mockSseResponse();
		hub.sseHandler(reqA as never, resA as never);

		const reqB = mockSseRequest(2);
		const resB = mockSseResponse();
		hub.sseHandler(reqB as never, resB as never);

		// Publish to workspace 1 — only resA should receive it
		hub.publishEvent(1, { type: "card.created", cardId: 10 });

		expect(resA.write).toHaveBeenCalledWith(
			expect.stringContaining("card.created"),
		);
		expect(resB.write).not.toHaveBeenCalledWith(
			expect.stringContaining("card.created"),
		);
	});

	it("delivers focus_session.updated only to the owning user's connections", () => {
		const hub = createRealtimeHub({ publisher: null, subscriber: null });

		const reqOwner = mockSseRequest(1, 7);
		const resOwner = mockSseResponse();
		hub.sseHandler(reqOwner as never, resOwner as never);

		const reqOwnerSecondTab = mockSseRequest(1, 7);
		const resOwnerSecondTab = mockSseResponse();
		hub.sseHandler(reqOwnerSecondTab as never, resOwnerSecondTab as never);

		const reqTeammate = mockSseRequest(1, 8);
		const resTeammate = mockSseResponse();
		hub.sseHandler(reqTeammate as never, resTeammate as never);

		hub.publishEvent(1, {
			type: "focus_session.updated",
			userId: 7,
			workspaceId: 1,
			payload: { session: null },
		});

		expect(resOwner.write).toHaveBeenCalledWith(
			expect.stringContaining("focus_session.updated"),
		);
		expect(resOwnerSecondTab.write).toHaveBeenCalledWith(
			expect.stringContaining("focus_session.updated"),
		);
		expect(resTeammate.write).not.toHaveBeenCalledWith(
			expect.stringContaining("focus_session.updated"),
		);
	});

	it("removes SSE client from index on disconnect", () => {
		const hub = createRealtimeHub({ publisher: null, subscriber: null });

		const req = mockSseRequest(1);
		const res = mockSseResponse();
		hub.sseHandler(req as never, res as never);

		// Simulate disconnect — find the "close" handler
		const closeHandler = req.on.mock.calls.find(
			([event]) => event === "close",
		)?.[1] as (() => void) | undefined;
		expect(closeHandler).toBeDefined();
		closeHandler?.();

		// Publish after disconnect — should not crash or write
		res.write.mockClear();
		hub.publishEvent(1, { type: "card.created", cardId: 99 });
		expect(res.write).not.toHaveBeenCalledWith(
			expect.stringContaining("card.created"),
		);
	});
});

describe("attachment event round-trip", () => {
	it("delivers metadata-only payloads through local fan-out", async () => {
		const hub = createRealtimeHub({ publisher: null, subscriber: null });
		const client = hub.connectLocalClient({ workspaceId: 1 });
		const payload: AttachmentEventPayload = {
			attachmentId: 17,
			mimeType: "image/png",
			createdAt: "2026-09-05T10:00:00.000Z",
		};

		await hub.publishEvent(1, {
			type: "attachment.added",
			cardId: 42,
			payload,
		});

		expect(client.drain()).toEqual([
			{
				type: "attachment.added",
				cardId: 42,
				payload: {
					attachmentId: 17,
					mimeType: "image/png",
					createdAt: "2026-09-05T10:00:00.000Z",
				},
			},
		]);
	});

	it("rejects legacy top-level attachment metadata", () => {
		const legacyEvent: BoardEvent = {
			type: "attachment.added",
			at: "2026-09-05T10:00:00.000Z",
			payload: {
				attachmentId: 17,
				mimeType: "image/png",
				createdAt: "2026-09-05T10:00:00.000Z",
			},
			// @ts-expect-error Legacy attachment metadata belongs under payload.
			attachmentId: 17,
			// @ts-expect-error Legacy attachment metadata belongs under payload.
			attachment: {
				id: 17,
				mimeType: "image/png",
				createdAt: "2026-09-05T10:00:00.000Z",
			},
		};

		expect(legacyEvent.payload).toMatchObject({ attachmentId: 17 });
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
		const logSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
		const hub = createRealtimeHub({ publisher: null, subscriber: null });

		// Initially false (no publisher)
		hub.setRedisAvailable(true);
		expect(logSpy).toHaveBeenCalledWith(
			{ from: false, to: true },
			"Redis availability changed",
		);

		// Setting same value again should not log
		logSpy.mockClear();
		hub.setRedisAvailable(true);
		expect(logSpy).not.toHaveBeenCalled();

		logSpy.mockRestore();
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

	it("reconnectSubscriber logs and rethrows subscribe errors", async () => {
		const pSubscribe = vi.fn(async () => {
			throw new Error("connection lost");
		});
		const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		const hub = createRealtimeHub({
			publisher: null,
			subscriber: { pSubscribe },
		});

		// rethrow is intentional — sub.on("ready") in realtime.ts catches it
		await expect(hub.reconnectSubscriber()).rejects.toThrow("connection lost");
		expect(logSpy).toHaveBeenCalledWith(
			{ err: expect.any(Error) },
			"Redis re-subscribe failed",
		);

		logSpy.mockRestore();
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

describe("shutdown", () => {
	it("ends all SSE clients and clears intervals on shutdown", () => {
		const hub = createRealtimeHub({ publisher: null, subscriber: null });

		const req1 = mockSseRequest(1);
		const res1 = mockSseResponse();
		hub.sseHandler(req1 as never, res1 as never);

		const req2 = mockSseRequest(1);
		const res2 = mockSseResponse();
		hub.sseHandler(req2 as never, res2 as never);

		hub.shutdown();

		expect(res1.end).toHaveBeenCalled();
		expect(res2.end).toHaveBeenCalled();

		// After shutdown, publishing should not crash (map is cleared)
		hub.publishEvent(1, { type: "card.created", cardId: 1 });
	});

	it("returns 503 for new SSE connections after shutdown", () => {
		const hub = createRealtimeHub({ publisher: null, subscriber: null });

		// Shutdown first
		hub.shutdown();

		// New SSE request should get 503
		const req = mockSseRequest(1);
		const res = mockSseResponse();
		hub.sseHandler(req as never, res as never);

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.json).toHaveBeenCalledWith({ error: "Server is shutting down" });
		expect(res.writeHead).not.toHaveBeenCalled();
	});

	it("is idempotent — calling shutdown twice does not throw", () => {
		const hub = createRealtimeHub({ publisher: null, subscriber: null });

		const req = mockSseRequest(1);
		const res = mockSseResponse();
		hub.sseHandler(req as never, res as never);

		expect(() => {
			hub.shutdown();
			hub.shutdown();
		}).not.toThrow();
	});
});

describe("singleton exports", () => {
	it("keeps routing to the current hub for consumers that snapshot the helpers", async () => {
		const realtime = await import("./realtime.js");
		// Mirrors lib/helpers.ts and agent/routes.ts, which capture these into
		// dependency objects at module load, before initRealtime() swaps the hub.
		const snapshot = {
			publishEvent: realtime.publishEvent,
			clearPresence: realtime.clearPresence,
		};
		const hub = realtime.createRealtimeHub({
			publisher: null,
			subscriber: null,
		});
		const client = hub.connectLocalClient({ workspaceId: 1 });

		realtime.setRealtimeHubForTests(hub);
		await snapshot.publishEvent(1, { type: "card.created", cardId: 3 });
		expect(client.drain()).toEqual([{ type: "card.created", cardId: 3 }]);

		realtime.setRealtimeHubForTests(null);
		await snapshot.publishEvent(1, { type: "card.created", cardId: 4 });
		expect(client.drain()).toEqual([]);
	});
});
