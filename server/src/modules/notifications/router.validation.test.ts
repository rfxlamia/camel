import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	emit: vi.fn(),
	executeTakeFirst: vi.fn().mockResolvedValue({ role: "admin" }),
}));

vi.mock("../../db/kysely.js", () => {
	const chain = {
		select: () => chain,
		where: () => chain,
		executeTakeFirst: () => mocks.executeTakeFirst(),
	};
	return {
		db: {
			selectFrom: () => chain,
		},
	};
});

vi.mock("../../events.js", () => ({
	domainBus: { emit: mocks.emit },
	EVENTS: {
		SYSTEM_ALERT: "system:alert",
	},
}));

vi.mock("../../middleware/workspace.js", () => ({
	requireWorkspaceMember: (_req: unknown, _res: unknown, next: () => void) =>
		next(),
}));

import { EVENTS } from "../../events.js";
import { notificationsRouter } from "./router.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1, displayName: "Alice" } as express.Request["user"];
		next();
	});
	app.use("/workspaces/:workspaceId/notifications", notificationsRouter);
	return app;
}

describe("POST /workspaces/:workspaceId/notifications/system-alert title", () => {
	beforeEach(() => {
		mocks.emit.mockClear();
		mocks.executeTakeFirst.mockClear();
	});

	it.each([
		["absent", {}],
		["empty", { title: "" }],
		["whitespace", { title: "   " }],
		["non-string", { title: 5 }],
	])("rejects a %s title", async (_label, body) => {
		const res = await request(createApp())
			.post("/workspaces/7/notifications/system-alert")
			.send(body);

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "title is required" });
		expect(mocks.emit).not.toHaveBeenCalled();
	});

	it("emits the trimmed title for a whitespace-padded title", async () => {
		const res = await request(createApp())
			.post("/workspaces/7/notifications/system-alert")
			.send({ title: "  hello  " });

		expect(res.status).not.toBe(400);
		expect(res.status).toBe(202);
		expect(mocks.emit).toHaveBeenCalledWith(EVENTS.SYSTEM_ALERT, {
			type: EVENTS.SYSTEM_ALERT,
			workspaceId: 7,
			actorId: 1,
			payload: { title: "hello", body: null },
		});
	});
});
