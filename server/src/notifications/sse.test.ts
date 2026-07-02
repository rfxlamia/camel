import "dotenv/config";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { Request, Response } from "express";
import { db } from "../db/kysely.js";
import {
	sseNotificationHandler,
	pushNotificationToUser,
	pushReadAllEvent,
} from "./sse.js";

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

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"pushNotificationToUser — missed-notification replay (real DB)",
	() => {
		it("replays missed notifications scoped to the connected workspace", async () => {
			const user = await db
				.insertInto("users")
				.values({
					username: `sse-replay-${Date.now()}`,
					display_name: "SSE Replay Tester",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: "SSE Replay WS",
					owner_user_id: user.id,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			const notification = await db
				.insertInto("notifications")
				.values({
					user_id: user.id,
					workspace_id: workspace.id,
					type: "card_assigned",
					title: "Assigned!",
				})
				.returning("id")
				.executeTakeFirstOrThrow();

			try {
				const write = vi.fn();
				let closeCb: () => void = () => {};
				const req = {
					user: { id: user.id },
					params: { workspaceId: String(workspace.id) },
					headers: { "last-event-id": String(notification.id - 1) },
					on: (event: string, cb: () => void) => {
						if (event === "close") closeCb = cb;
					},
				} as unknown as Request;
				const res = { writeHead: vi.fn(), write } as unknown as Response;

				await sseNotificationHandler(req, res);
				closeCb();

				const replayCall = write.mock.calls.find((call) =>
					String(call[0]).includes("notification.created"),
				);
				expect(replayCall).toBeDefined();
				expect(replayCall?.[0]).toContain(`id: ${notification.id}`);
			} finally {
				await db
					.deleteFrom("notifications")
					.where("id", "=", notification.id)
					.execute();
				await db
					.deleteFrom("workspaces")
					.where("id", "=", workspace.id)
					.execute();
				await db.deleteFrom("users").where("id", "=", user.id).execute();
			}
		});
	},
);
