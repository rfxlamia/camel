import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/kysely.js", () => ({ db: {} }));
vi.mock("../../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: () => void) => {
			req.user = {
				id: 1,
				username: null,
				displayName: "Ana",
				email: "ana@gmail.com",
				emailVerified: true,
				needsUsername: true,
			};
			next();
		},
	};
});

import { oauthRouter } from "./oauth.js";

/** EN DASH U+2013, not the router's ASCII hyphen-minus. */
const USERNAME_MESSAGE =
	"Username must be 3–32 characters: letters, numbers, underscore.";
const PASSWORD_MESSAGE = "Password must be at least 8 characters.";

function app() {
	const instance = express();
	instance.use(express.json());
	instance.use("/api/auth", oauthRouter);
	return instance;
}

describe("oauth validation preserves legacy 400 bodies", () => {
	it.each([
		["too-short username", { username: "ab" }],
		["illegal characters", { username: "a b!" }],
		["missing username", {}],
	])("set-username rejects %s with the en-dash message", async (_label, body) => {
		const res = await request(app()).post("/api/auth/set-username").send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: USERNAME_MESSAGE });
		expect(USERNAME_MESSAGE).toContain("\u2013");
	});

	it.each([
		["short password", { password: "short" }],
		["non-string password", { password: 12345 }],
	])("set-password rejects %s", async (_label, body) => {
		const res = await request(app()).post("/api/auth/set-password").send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: PASSWORD_MESSAGE });
	});
});
