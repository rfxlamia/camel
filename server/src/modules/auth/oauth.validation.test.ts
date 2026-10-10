import express, { type RequestHandler } from "express";
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
vi.mock("./login-limiter.js", () => ({
	accountLockoutMiddleware: ((_req, _res, next: () => void) => {
		next();
	}) as RequestHandler,
	clearLoginFailures: vi.fn(),
}));

import { oauthRouter } from "./oauth.js";
import { createAuthRouter } from "./router.js";

/** ASCII hyphen-minus (char code 45), not EN DASH U+2013. */
const USERNAME_MESSAGE =
	"Username must be 3-32 characters: letters, numbers, underscore.";
const PASSWORD_MESSAGE = "Password must be at least 8 characters.";

const noopLimiter: RequestHandler = (_req, _res, next) => {
	next();
};

function oauthApp() {
	const instance = express();
	instance.use(express.json());
	instance.use("/api/auth", oauthRouter);
	return instance;
}

function registerApp() {
	const instance = express();
	instance.use(express.json());
	instance.use("/api/auth", createAuthRouter(noopLimiter));
	return instance;
}

function hyphenCharCode(message: string): number {
	return message.charCodeAt(message.indexOf("3") + 1);
}

describe("oauth validation preserves legacy 400 bodies", () => {
	it.each([
		["too-short username", { username: "ab" }],
		["illegal characters", { username: "a b!" }],
		["missing username", {}],
	])("set-username rejects %s with the ASCII-hyphen message", async (_label, body) => {
		const res = await request(oauthApp())
			.post("/api/auth/set-username")
			.send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: USERNAME_MESSAGE });
		expect(hyphenCharCode(res.body.error)).toBe(45);
		expect(res.body.error).not.toContain("\u2013");
	});

	it.each([
		["short password", { password: "short" }],
		["non-string password", { password: 12345 }],
	])("set-password rejects %s", async (_label, body) => {
		const res = await request(oauthApp())
			.post("/api/auth/set-password")
			.send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: PASSWORD_MESSAGE });
	});

	it.each([
		["too-short username", "ab"],
		["illegal characters", "a b!"],
	])("register and set-username return identical bodies for %s", async (_label, username) => {
		const oauthRes = await request(oauthApp())
			.post("/api/auth/set-username")
			.send({ username });
		const registerRes = await request(registerApp())
			.post("/api/auth/register")
			.send({ username, password: "longenough" });
		expect(oauthRes.status).toBe(400);
		expect(registerRes.status).toBe(400);
		expect(oauthRes.body).toEqual(registerRes.body);
		expect(oauthRes.body).toEqual({ error: USERNAME_MESSAGE });
	});
});
