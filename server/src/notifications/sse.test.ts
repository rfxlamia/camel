import { describe, expect, it, vi, afterEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../db/pool.js", () => ({
	pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from "../db/pool.js";
import {
	sseNotificationHandler,
	pushNotificationToUser,
	pushReadAllEvent,
} from "./sse.js";

const mockQuery = vi.mocked(pool.query);

describe("pushNotificationToUser — user-keyed isolation", () => {
	vi.useFakeTimers();

	const closeHandlers: Array<() => void> = [];

	afterEach(() => {
		closeHandlers.forEach((fn) => fn());
		closeHandlers.length = 0;
		vi.clearAllMocks();
	});

	it("delivers to matching userId only — other connected users are NOT notified", async () => {
		const write1 = vi.fn();
		const write2 = vi.fn();

		const makeReq = (userId: number) => {
			let closeCb: () => void = () => {};
			const req = {
				user: { id: userId },
				params: { workspaceId: "1" },
				headers: {},
				on: (event: string, cb: () => void) => {
					if (event === "close") closeCb = cb;
				},
			} as unknown as Request;
			return { req, close: () => closeCb() };
		};

		const c1 = makeReq(1);
		const c2 = makeReq(2);
		const res1 = { writeHead: vi.fn(), write: write1 } as unknown as Response;
		const res2 = { writeHead: vi.fn(), write: write2 } as unknown as Response;

		await sseNotificationHandler(c1.req, res1);
		await sseNotificationHandler(c2.req, res2);
		closeHandlers.push(c1.close, c2.close);

		write1.mockClear();
		write2.mockClear();

		pushNotificationToUser(1, 1, { id: 42, type: "card_assigned", title: "Assigned!" });

		expect(write1).toHaveBeenCalledOnce();
		expect(write1.mock.calls[0][0]).toContain("notification.created");
		expect(write2).not.toHaveBeenCalled();
	});

	it("delivers only to clients connected to the same workspace", async () => {
		const writeWs1 = vi.fn();
		const writeWs2 = vi.fn();

		const makeReq = (userId: number, workspaceId: string) => {
			let closeCb: () => void = () => {};
			const req = {
				user: { id: userId },
				params: { workspaceId },
				headers: {},
				on: (event: string, cb: () => void) => {
					if (event === "close") closeCb = cb;
				},
			} as unknown as Request;
			return { req, close: () => closeCb() };
		};

		const ws1 = makeReq(1, "1");
		const ws2 = makeReq(1, "2");
		const res1 = { writeHead: vi.fn(), write: writeWs1 } as unknown as Response;
		const res2 = { writeHead: vi.fn(), write: writeWs2 } as unknown as Response;

		await sseNotificationHandler(ws1.req, res1);
		await sseNotificationHandler(ws2.req, res2);
		closeHandlers.push(ws1.close, ws2.close);

		writeWs1.mockClear();
		writeWs2.mockClear();

		pushNotificationToUser(1, 1, { id: 42, type: "card_assigned", title: "Assigned!" });

		expect(writeWs1).toHaveBeenCalledOnce();
		expect(writeWs2).not.toHaveBeenCalled();
	});

	it("replays missed notifications scoped to the connected workspace", async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 } as never);

		const write = vi.fn();
		let closeCb: () => void = () => {};
		const req = {
			user: { id: 1 },
			params: { workspaceId: "7" },
			headers: { "last-event-id": "10" },
			on: (event: string, cb: () => void) => {
				if (event === "close") closeCb = cb;
			},
		} as unknown as Request;
		const res = { writeHead: vi.fn(), write } as unknown as Response;

		await sseNotificationHandler(req, res);
		closeHandlers.push(() => closeCb());

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("workspace_id = $2"),
			[1, 7, 10],
		);
	});

	it("read-all SSE event only reaches clients on the same workspace", async () => {
		const writeWs1 = vi.fn();
		const writeWs2 = vi.fn();

		const makeReq = (workspaceId: string) => {
			let closeCb: () => void = () => {};
			const req = {
				user: { id: 1 },
				params: { workspaceId },
				headers: {},
				on: (event: string, cb: () => void) => {
					if (event === "close") closeCb = cb;
				},
			} as unknown as Request;
			return { req, close: () => closeCb() };
		};

		const ws1 = makeReq("1");
		const ws2 = makeReq("2");
		const res1 = { writeHead: vi.fn(), write: writeWs1 } as unknown as Response;
		const res2 = { writeHead: vi.fn(), write: writeWs2 } as unknown as Response;

		await sseNotificationHandler(ws1.req, res1);
		await sseNotificationHandler(ws2.req, res2);
		closeHandlers.push(ws1.close, ws2.close);

		writeWs1.mockClear();
		writeWs2.mockClear();

		pushReadAllEvent(1, 1);

		expect(writeWs1).toHaveBeenCalledOnce();
		expect(writeWs1.mock.calls[0][0]).toContain("notifications.read-all");
		expect(writeWs2).not.toHaveBeenCalled();
	});
});
