import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { csrfProtection, generateCsrfToken } from "../middleware/csrf.js";

describe("CSRF Protection", () => {
	let app: express.Application;

	beforeEach(() => {
		app = express();
		app.use(cookieParser());
		app.use(express.json());

		app.get("/api/csrf-token", (req, res) => {
			const token = generateCsrfToken();
			res.cookie("csrf_token", token, {
				httpOnly: false,
				sameSite: "strict",
				secure: process.env.NODE_ENV === "production",
			});
			res.json({ csrfToken: token });
		});

		app.post("/api/test", csrfProtection, (req, res) => {
			res.json({ success: true });
		});
	});

	it("should reject POST without CSRF token", async () => {
		const response = await request(app)
			.post("/api/test")
			.send({ data: "test" })
			.expect(403);
		expect(response.body).toEqual({ error: "CSRF token missing" });
	});

	it("should reject POST with invalid CSRF token", async () => {
		const response = await request(app)
			.post("/api/test")
			.set("Cookie", ["csrf_token=invalid_token"])
			.set("X-CSRF-Token", "invalid_token")
			.send({ data: "test" })
			.expect(403);
		expect(response.body).toEqual({ error: "CSRF token invalid" });
	});

	it("should accept POST with valid CSRF token", async () => {
		const tokenResponse = await request(app).get("/api/csrf-token").expect(200);
		const csrfToken = tokenResponse.body.csrfToken;
		const cookies = tokenResponse.headers["set-cookie"];

		const response = await request(app)
			.post("/api/test")
			.set("Cookie", cookies)
			.set("X-CSRF-Token", csrfToken)
			.send({ data: "test" })
			.expect(200);
		expect(response.body).toEqual({ success: true });
	});

	it("should accept GET requests without CSRF token", async () => {
		app.get("/api/test-get", csrfProtection, (req, res) => {
			res.json({ success: true });
		});
		await request(app).get("/api/test-get").expect(200);
	});
});
