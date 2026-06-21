import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { requestTimeout, serverTimeout } from "../middleware/timeout.js";

describe("Request Timeout", () => {
	let app: express.Application;

	beforeEach(() => {
		app = express();
		app.use(requestTimeout(1000));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should complete request within timeout", async () => {
		app.get("/fast", (req, res) => {
			res.json({ ok: true });
		});

		const response = await request(app).get("/fast").expect(200);
		expect(response.body).toEqual({ ok: true });
	});

	it("should timeout slow requests", async () => {
		app.get("/slow", (req, res) => {
			setTimeout(() => {
				if (!res.headersSent) res.json({ ok: true });
			}, 2000);
		});

		const response = await request(app).get("/slow").expect(503);
		expect(response.body).toEqual({ error: "Request timeout" });
	});

	it("should allow custom timeout per route", async () => {
		app.get("/custom-timeout", requestTimeout(500), (req, res) => {
			setTimeout(() => {
				if (!res.headersSent) res.json({ ok: true });
			}, 1000);
		});

		const response = await request(app).get("/custom-timeout").expect(503);
		expect(response.body).toEqual({ error: "Request timeout" });
	});

	it("should not timeout when disabled", async () => {
		// Create fresh app without the 1000ms timeout middleware
		const freshApp = express();
		freshApp.use(requestTimeout(0));
		freshApp.get("/no-timeout", (req, res) => {
			setTimeout(() => {
				res.json({ ok: true });
			}, 1500); // More than 1000ms to prove timeout is disabled
		});

		const response = await request(freshApp).get("/no-timeout").expect(200);
		expect(response.body).toEqual({ ok: true });
	});
});

describe("Server Timeout", () => {
	it("should configure server timeouts", () => {
		const server = {
			timeout: 0,
			keepAliveTimeout: 0,
			headersTimeout: 0,
			setTimeout: vi.fn(),
			on: vi.fn(),
		} as any;

		serverTimeout(server, {
			timeout: 30000,
			keepAliveTimeout: 65000,
			headersTimeout: 66000,
		});

		expect(server.timeout).toBe(30000);
		expect(server.keepAliveTimeout).toBe(65000);
		expect(server.headersTimeout).toBe(66000);
	});
});
