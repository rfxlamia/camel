import type { Server } from "node:http";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Response } from "express";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSseManager } from "./sse.js";
import type { PublishableEvent } from "./types.js";

const ERROR_BODY = { error: "workspaceId must be an integer" };
const FANOUT_IDS = [Number.NaN, 0, 1, 1.5, 100, -1];
const LEAK_EVENT: PublishableEvent = { type: "card.created" };

type SseManager = ReturnType<typeof createSseManager>;

function mount() {
	const manager = createSseManager();
	const app = express();
	const responses: Response[] = [];
	app.use((req, res, next) => {
		req.user = { id: 1, username: "alice" } as express.Request["user"];
		responses.push(res);
		next();
	});
	app.get("/workspaces/:workspaceId/events/stream", manager.handler);
	return { app, manager, responses };
}

function captureLaterWrites(res: Response): unknown[] {
	const writes: unknown[] = [];
	const write = res.write;
	res.write = function (this: Response, ...args: never[]) {
		writes.push(args[0]);
		return write.apply(this, args);
	} as typeof res.write;
	res.on("error", () => {});
	return writes;
}

function fanOutEverywhere(manager: SseManager): void {
	for (const workspaceId of FANOUT_IDS) {
		manager.fanOut(workspaceId, "leak", LEAK_EVENT);
	}
}

function expectValidation400(res: request.Response): void {
	expect(res.status).toBe(400);
	expect(res.status).not.toBe(503);
	expect(res.body).toEqual(ERROR_BODY);
	expect(res.headers["content-type"]).toContain("application/json");
	expect(res.headers["content-type"]).not.toContain("text/event-stream");
	expect(res.headers["cache-control"]).not.toBe("no-cache");
}

function expectNoRegisteredClient(
	res: Response | undefined,
	manager: SseManager,
): void {
	if (!res) throw new Error("expected the SSE response");
	const writes = captureLaterWrites(res);
	fanOutEverywhere(manager);
	expect(writes).toEqual([]);
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

async function expectOpenStream(workspaceId: string): Promise<void> {
	const { app, manager } = mount();
	const server = await listen(app);
	try {
		const address = server.address() as AddressInfo;
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				if (error) reject(error);
				else resolve();
			};
			const req = http.get(
				{
					hostname: "127.0.0.1",
					port: address.port,
					path: `/workspaces/${encodeURIComponent(workspaceId)}/events/stream`,
				},
				(res) => {
					req.setTimeout(0);
					try {
						expect(res.statusCode).not.toBe(400);
						expect(res.statusCode).toBe(200);
						expect(res.headers["content-type"]).toContain("text/event-stream");
						finish();
					} catch (error) {
						finish(error instanceof Error ? error : new Error(String(error)));
					} finally {
						req.destroy();
					}
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

describe("SSE workspace id validation", () => {
	it.each([
		"abc",
		"1.5",
	])("rejects %s with JSON 400 and does not register a client", async (workspaceId) => {
		const { app, manager, responses } = mount();
		const res = await request(app).get(
			`/workspaces/${workspaceId}/events/stream`,
		);
		expectValidation400(res);
		expectNoRegisteredClient(responses[0], manager);
	});

	it.each([
		"abc",
		"1.5",
	])("returns 400 not 503 after shutdown for %s", async (workspaceId) => {
		const { app, manager, responses } = mount();
		manager.shutdown();
		const res = await request(app).get(
			`/workspaces/${workspaceId}/events/stream`,
		);
		expectValidation400(res);
		expectNoRegisteredClient(responses[0], manager);
	});

	it.each([
		"1e2",
		"0",
	])("opens an event stream for integer workspace id %s", async (workspaceId) => {
		await expectOpenStream(workspaceId);
	});
});
