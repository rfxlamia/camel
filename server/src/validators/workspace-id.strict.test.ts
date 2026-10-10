import type { Server } from "node:http";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth.js", () => ({
	requireAuth: (req: any, _res: any, next: () => void) => {
		req.user = { id: 1, username: "alice", displayName: "Bob" };
		next();
	},
}));
vi.mock("../lib/helpers.js", () => ({
	lookupMembership: vi.fn().mockResolvedValue("member"),
	recordActivity: vi.fn(),
}));
vi.mock("../db/kysely.js", () => ({ db: {} }));
vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));

import {
	createAgentRouter,
	ticketIntakeRouter,
} from "../modules/agent/index.js";
import { createMyWorkRouter } from "../modules/my-work/index.js";
import { settingsRouter } from "../modules/settings/index.js";
import { createSseManager } from "../realtime/sse.js";
import { parseWith } from "./http.js";
import { workspaceIdParam } from "./schemas.js";

const ERROR = { error: "workspaceId must be an integer" };
const PATH_IDS = [
	"0",
	"-1",
	"1e2",
	" 1",
	"abc",
	"1.5",
	"9007199254740993",
] as const;
const QUERY_IDS = [...PATH_IDS, ""] as const;

function encodeWs(id: string): string {
	return encodeURIComponent(id);
}

function withUser() {
	return (
		req: express.Request,
		_res: express.Response,
		next: express.NextFunction,
	) => {
		req.user = {
			id: 1,
			username: "alice",
			displayName: "Bob",
		} as express.Request["user"];
		next();
	};
}

function agentApp() {
	const instance = express();
	instance.use(express.json());
	instance.use("/api", createAgentRouter());
	return instance;
}

function ticketApp() {
	const instance = express();
	instance.use(express.json());
	instance.use(withUser());
	instance.use("/api", ticketIntakeRouter);
	return instance;
}

function settingsApp() {
	const instance = express();
	instance.use(express.json());
	instance.use(withUser());
	instance.use("/workspaces/:workspaceId/settings", settingsRouter);
	return instance;
}

function myWorkApp() {
	const service = {
		list: vi.fn().mockResolvedValue({ items: [] }),
		getDetail: vi.fn().mockResolvedValue(null),
		markDone: vi.fn(),
	};
	const instance = express();
	instance.use(express.json());
	instance.use(withUser());
	instance.use("/my-work", createMyWorkRouter({ service }));
	return instance;
}

function listen(app: express.Express): Promise<Server> {
	return new Promise((resolve, reject) => {
		const server = app.listen(0, "127.0.0.1", () => resolve(server));
		server.once("error", reject);
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function sseHead(
	workspaceId: string,
): Promise<{ status: number; body: unknown }> {
	const manager = createSseManager();
	const app = express();
	app.use(withUser());
	app.get("/workspaces/:workspaceId/events/stream", manager.handler);
	const server = await listen(app);
	try {
		const address = server.address() as AddressInfo;
		return await new Promise((resolve, reject) => {
			let settled = false;
			const finish = (
				error?: Error,
				value?: { status: number; body: unknown },
			) => {
				if (settled) return;
				settled = true;
				if (error) reject(error);
				else resolve(value as { status: number; body: unknown });
			};
			const req = http.get(
				{
					hostname: "127.0.0.1",
					port: address.port,
					path: `/workspaces/${encodeWs(workspaceId)}/events/stream`,
				},
				(res) => {
					req.setTimeout(0);
					const status = res.statusCode ?? 0;
					if (status !== 400) {
						finish(undefined, { status, body: undefined });
						req.destroy();
						return;
					}
					const chunks: Buffer[] = [];
					res.on("data", (chunk) => {
						chunks.push(chunk as Buffer);
					});
					res.on("end", () => {
						const raw = Buffer.concat(chunks).toString("utf8");
						finish(undefined, { status, body: JSON.parse(raw) });
					});
				},
			);
			req.setTimeout(1500, () => {
				req.destroy();
				finish(new Error(`timed out waiting for SSE headers (${workspaceId})`));
			});
			req.on("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "ECONNRESET") return;
				finish(error);
			});
		});
	} finally {
		manager.shutdown();
		await closeServer(server);
	}
}

describe("parseWith(workspaceIdParam)", () => {
	it.each(QUERY_IDS)("rejects %j", (raw) => {
		expect(parseWith(workspaceIdParam, raw)).toEqual({
			ok: false,
			body: ERROR,
		});
	});

	it.each([
		["01", 1],
		["7", 7],
	] as const)("accepts %s as %i", (raw, data) => {
		expect(parseWith(workspaceIdParam, raw)).toEqual({ ok: true, data });
	});
});

describe("PATH workspaceId is strict", () => {
	it.each(PATH_IDS)("agent routes reject %j", async (id) => {
		const path = `/api/workspaces/${encodeWs(id)}`;
		const responses = [
			await request(agentApp()).get(`${path}/agent/boards`),
			await request(agentApp())
				.post(`${path}/agent/boards`)
				.send({ intent: "build" }),
			await request(agentApp()).get(`${path}/agent/boards/2`),
		];
		for (const res of responses) {
			expect(res.status).toBe(400);
			expect(res.body).toEqual(ERROR);
		}
	});

	it.each(PATH_IDS)("ticket-intake GET chat-limit rejects %j", async (id) => {
		const res = await request(ticketApp()).get(
			`/api/workspaces/${encodeWs(id)}/ticket-intake/chat-limit`,
		);
		expect(res.status).toBe(400);
		expect(res.body).toEqual(ERROR);
	});

	it.each(
		PATH_IDS,
	)("SSE rejects %j without waiting for the stream", async (id) => {
		const res = await sseHead(id);
		expect(res.status).toBe(400);
		expect(res.body).toEqual(ERROR);
	});

	it.each(PATH_IDS)("settings rejects %j", async (id) => {
		const res = await request(settingsApp()).get(
			`/workspaces/${encodeWs(id)}/settings`,
		);
		expect(res.status).toBe(400);
		expect(res.body).toEqual(ERROR);
	});

	it.each(PATH_IDS)("my-work path rejects %j", async (id) => {
		const res = await request(myWorkApp()).get(
			`/my-work/${encodeWs(id)}/board/AT-1`,
		);
		expect(res.status).toBe(400);
		expect(res.body).toEqual(ERROR);
	});
});

describe("QUERY workspaceId is strict", () => {
	it.each(QUERY_IDS)("my-work query rejects %j", async (id) => {
		const res = await request(myWorkApp()).get(
			`/my-work?workspaceId=${encodeWs(id)}`,
		);
		expect(res.status).toBe(400);
		expect(res.body).toEqual(ERROR);
	});
});

describe("digit-only workspace ids pass validation", () => {
	it.each(["01", "7"])("my-work path and query accept %s", async (id) => {
		const pathRes = await request(myWorkApp()).get(`/my-work/${id}/board/AT-1`);
		expect(pathRes.status).not.toBe(400);
		const queryRes = await request(myWorkApp())
			.get("/my-work")
			.query({ workspaceId: id });
		expect(queryRes.status).not.toBe(400);
	});

	it.each(["01", "7"])("SSE opens a stream for %s", async (id) => {
		const res = await sseHead(id);
		expect(res.status).not.toBe(400);
		expect(res.status).toBe(200);
	});
});

describe("non-workspace params stay Invalid params", () => {
	it.each(["abc", "1.5"])("valid ws with board %s", async (board) => {
		const res = await request(agentApp()).get(
			`/api/workspaces/1/agent/boards/${board}`,
		);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "Invalid params" });
	});

	it("valid ws with invalid columnSlug", async () => {
		const res = await request(agentApp()).get(
			"/api/workspaces/1/agent/boards/2/outputs/bad%20slug",
		);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "Invalid params" });
	});
});
