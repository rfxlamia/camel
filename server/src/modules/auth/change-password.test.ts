import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	authed: true,
	usersRow: vi.fn<unknown>(),
	updatedRow: vi.fn<unknown>(),
	sessionDeleteExecute: vi.fn(),
	auditInsertExecute: vi.fn(),
	isPasswordChangeLockedOut: vi.fn<() => Promise<boolean>>(),
	checkAndRecordPasswordChangeAttempt: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("../../db/kysely.js", () => ({
	db: {
		selectFrom: vi.fn(() => {
			const chain = {
				select: vi.fn(() => chain),
				where: vi.fn(() => chain),
				executeTakeFirst: vi.fn().mockResolvedValue(mocks.usersRow),
			};
			return chain;
		}),
		updateTable: vi.fn(() => {
			const chain = {
				set: vi.fn(() => chain),
				where: vi.fn(() => chain),
				returning: vi.fn(() => chain),
				executeTakeFirst: vi.fn().mockResolvedValue(mocks.updatedRow),
			};
			return chain;
		}),
		deleteFrom: vi.fn(() => {
			const chain = {
				where: vi.fn(() => chain),
				execute: mocks.sessionDeleteExecute,
			};
			return chain;
		}),
		insertInto: vi.fn(() => {
			const chain = {
				values: vi.fn(() => chain),
				execute: mocks.auditInsertExecute,
			};
			return chain;
		}),
	},
}));

vi.mock("../../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../auth.js")>();
	return {
		...actual,
		requireAuth: ((_req: Request & { user?: unknown }, res, next) => {
			if (!mocks.authed) {
				return res.status(401).json({ error: "authentication required" });
			}
			_req.user = {
				id: 5,
				username: "nina",
				displayName: "Nina",
				email: null,
				emailVerified: false,
				needsUsername: false,
			};
			next();
		}) as unknown as RequestHandler,
	};
});
vi.mock("./login-limiter.js", () => ({
	accountLockoutMiddleware: ((_req, _res, next: () => void) => {
		next();
	}) as RequestHandler,
	clearLoginFailures: vi.fn(),
	isPasswordChangeLockedOut: mocks.isPasswordChangeLockedOut,
	checkAndRecordPasswordChangeAttempt:
		mocks.checkAndRecordPasswordChangeAttempt,
	clearPasswordChangeFailures: vi.fn(),
}));

import { createAuthRouter } from "./router.js";

const CURRENT_PASSWORD = "current-password";
const NEW_PASSWORD = "new-password-123";

function app() {
	const instance = express();
	instance.use(express.json());
	instance.use(cookieParser());
	instance.use("/api/auth", createAuthRouter());
	return instance;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.authed = true;
	mocks.sessionDeleteExecute.mockResolvedValue(undefined);
	mocks.auditInsertExecute.mockResolvedValue(undefined);
	mocks.isPasswordChangeLockedOut.mockResolvedValue(false);
	mocks.checkAndRecordPasswordChangeAttempt.mockResolvedValue(false);
});

function postChangePassword(
	body: Record<string, unknown>,
	cookie = "camel_session=presented-token",
) {
	return request(app())
		.post("/api/auth/change-password")
		.set("Cookie", cookie)
		.send(body);
}

describe("POST /auth/change-password", () => {
	it("requires authentication", async () => {
		mocks.authed = false;

		const res = await postChangePassword({
			currentPassword: CURRENT_PASSWORD,
			newPassword: NEW_PASSWORD,
		});

		expect(res.status).toBe(401);
	});

	it.each([
		["missing current password", { newPassword: NEW_PASSWORD }],
		[
			"non-string current password",
			{ currentPassword: 42, newPassword: NEW_PASSWORD },
		],
	])("rejects %s with 400", async (_label, body) => {
		const res = await postChangePassword(body);

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "Current password is required." });
	});

	it.each([
		[
			"short new password",
			{ currentPassword: CURRENT_PASSWORD, newPassword: "short" },
		],
		["missing new password", { currentPassword: CURRENT_PASSWORD }],
	])("rejects %s with 400", async (_label, body) => {
		const res = await postChangePassword(body);

		expect(res.status).toBe(400);
		expect(res.body).toEqual({
			error: "Password must be at least 8 characters.",
		});
	});

	it("returns 409 when the account has no password (OAuth user)", async () => {
		mocks.usersRow = { id: 5, password_hash: null };

		const res = await postChangePassword({
			currentPassword: CURRENT_PASSWORD,
			newPassword: NEW_PASSWORD,
		});

		expect(res.status).toBe(409);
		expect(res.body).toEqual({
			error: "No password set. Use set-password instead.",
		});
	});

	it("returns 429 and kills the presented session when locked out", async () => {
		mocks.isPasswordChangeLockedOut.mockResolvedValue(true);

		const res = await postChangePassword({
			currentPassword: CURRENT_PASSWORD,
			newPassword: NEW_PASSWORD,
		});

		expect(res.status).toBe(429);
		expect(res.body).toEqual({
			error: "Too many failed attempts — please try again later.",
		});
		expect(mocks.sessionDeleteExecute).toHaveBeenCalledTimes(1);
	});

	it("returns 403 when the current password is wrong and records the failure", async () => {
		const hash = await bcrypt.hash(CURRENT_PASSWORD, 4);
		mocks.usersRow = { id: 5, password_hash: hash };

		const res = await postChangePassword({
			currentPassword: "wrong-password",
			newPassword: NEW_PASSWORD,
		});

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: "Current password is incorrect." });
		expect(mocks.checkAndRecordPasswordChangeAttempt).toHaveBeenCalledWith(5);
	});

	it("returns 429 and kills the session when a failure trips the lockout", async () => {
		const hash = await bcrypt.hash(CURRENT_PASSWORD, 4);
		mocks.usersRow = { id: 5, password_hash: hash };
		mocks.checkAndRecordPasswordChangeAttempt.mockResolvedValue(true);

		const res = await postChangePassword({
			currentPassword: "wrong-password",
			newPassword: NEW_PASSWORD,
		});

		expect(res.status).toBe(429);
		expect(mocks.sessionDeleteExecute).toHaveBeenCalledTimes(1);
	});

	it("returns 400 when the new password equals the current one", async () => {
		const hash = await bcrypt.hash(CURRENT_PASSWORD, 4);
		mocks.usersRow = { id: 5, password_hash: hash };

		const res = await postChangePassword({
			currentPassword: CURRENT_PASSWORD,
			newPassword: CURRENT_PASSWORD,
		});

		expect(res.status).toBe(400);
		expect(res.body).toEqual({
			error: "New password must be different from the current password.",
		});
	});

	it("changes the password, writes an audit event, revokes other sessions", async () => {
		const hash = await bcrypt.hash(CURRENT_PASSWORD, 4);
		mocks.usersRow = { id: 5, password_hash: hash };
		mocks.updatedRow = { id: 5 };

		const res = await postChangePassword({
			currentPassword: CURRENT_PASSWORD,
			newPassword: NEW_PASSWORD,
		});

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true });
		expect(mocks.auditInsertExecute).toHaveBeenCalledTimes(1);
		expect(mocks.sessionDeleteExecute).toHaveBeenCalledTimes(1);
	});

	it("returns 409 when a concurrent change already replaced the old hash", async () => {
		const hash = await bcrypt.hash(CURRENT_PASSWORD, 4);
		mocks.usersRow = { id: 5, password_hash: hash };
		mocks.updatedRow = undefined;

		const res = await postChangePassword({
			currentPassword: CURRENT_PASSWORD,
			newPassword: NEW_PASSWORD,
		});

		expect(res.status).toBe(409);
		expect(res.body).toEqual({
			error: "Password was changed recently — try again.",
		});
		expect(mocks.sessionDeleteExecute).not.toHaveBeenCalled();
		expect(mocks.auditInsertExecute).not.toHaveBeenCalled();
	});
});
