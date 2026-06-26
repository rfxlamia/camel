import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requireEmailVerified } from "../email-gate.js";

function makeRes() {
	const res = {
		status: vi.fn(),
		json: vi.fn(),
	} as unknown as Response;
	(res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
	return res;
}

describe("requireEmailVerified middleware", () => {
	it("responds 403 with needsEmailVerification:true when emailVerified is false", () => {
		const req = {
			user: {
				id: 1,
				username: "lama",
				displayName: "Lama",
				email: null,
				emailVerified: false,
				needsUsername: false,
			},
		} as unknown as Request;
		const res = makeRes();
		const next = vi.fn() as unknown as NextFunction;

		requireEmailVerified(req, res, next);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ needsEmailVerification: true });
		expect(next).not.toHaveBeenCalled();
	});

	it("calls next() and sends no response when emailVerified is true", () => {
		const req = {
			user: {
				id: 2,
				username: "ana",
				displayName: "Ana",
				email: "ana@gmail.com",
				emailVerified: true,
				needsUsername: false,
			},
		} as unknown as Request;
		const res = makeRes();
		const next = vi.fn() as unknown as NextFunction;

		requireEmailVerified(req, res, next);

		expect(next).toHaveBeenCalledOnce();
		expect(res.status).not.toHaveBeenCalled();
		expect(res.json).not.toHaveBeenCalled();
	});

	it("calls next() without blocking when req.user is undefined (requireAuth handles 401)", () => {
		const req = {} as Request;
		const res = makeRes();
		const next = vi.fn() as unknown as NextFunction;

		requireEmailVerified(req, res, next);

		expect(next).toHaveBeenCalledOnce();
		expect(res.status).not.toHaveBeenCalled();
	});
});
