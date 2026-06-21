import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { securityHeaders } from "../middleware/security-headers";

describe("Security Headers", () => {
	let app: express.Application;

	beforeEach(() => {
		app = express();
		app.use(securityHeaders());
		app.get("/test", (_req, res) => {
			res.json({ ok: true });
		});
	});

	it("should set X-Content-Type-Options header", async () => {
		const response = await request(app).get("/test").expect(200);
		expect(response.headers["x-content-type-options"]).toBe("nosniff");
	});

	it("should set X-Frame-Options header", async () => {
		const response = await request(app).get("/test").expect(200);
		expect(response.headers["x-frame-options"]).toBe("DENY");
	});

	it("should set Strict-Transport-Security header in production", async () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			const prodApp = express();
			prodApp.use(securityHeaders());
			prodApp.get("/test", (_req, res) => {
				res.json({ ok: true });
			});
			const response = await request(prodApp).get("/test").expect(200);
			expect(response.headers["strict-transport-security"]).toBeDefined();
			expect(response.headers["strict-transport-security"]).toContain(
				"max-age",
			);
		} finally {
			process.env.NODE_ENV = originalEnv;
		}
	});

	it("should set Content-Security-Policy header", async () => {
		const response = await request(app).get("/test").expect(200);
		expect(response.headers["content-security-policy"]).toBeDefined();
	});

	it("should set X-XSS-Protection header to 0", async () => {
		const response = await request(app).get("/test").expect(200);
		expect(response.headers["x-xss-protection"]).toBe("0");
	});

	it("should set Referrer-Policy header", async () => {
		const response = await request(app).get("/test").expect(200);
		expect(response.headers["referrer-policy"]).toBe(
			"strict-origin-when-cross-origin",
		);
	});

	it("should set Permissions-Policy header", async () => {
		const response = await request(app).get("/test").expect(200);
		expect(response.headers["permissions-policy"]).toBeDefined();
	});
});
