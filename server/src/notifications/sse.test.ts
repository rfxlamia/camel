import { describe, expect, it, vi, afterEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../db/pool.js", () => ({
	pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { sseNotificationHandler, pushNotificationToUser } from "./sse.js";

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
});
