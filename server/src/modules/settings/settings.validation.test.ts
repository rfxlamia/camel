import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/kysely.js", () => ({ db: {} }));
vi.mock("../../realtime.js", () => ({ publishEvent: vi.fn() }));

const mockGetMemberRole = vi.fn();
vi.mock("./settings-repo.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./settings-repo.js")>()),
	getMemberRole: (...args: unknown[]) => mockGetMemberRole(...args),
}));

import { settingsRouter } from "./settings.js";
import { parseSettingsPatch } from "./settings-patch.js";

const WORKSPACE_MSG = "workspaceId must be an integer";
const VERSION_MSG = "version must be an integer";

function failure(body: unknown) {
	const result = parseSettingsPatch(body);
	if (result.ok) throw new Error("expected a validation failure");
	return result.body;
}

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1, username: "alice" } as express.Request["user"];
		next();
	});
	app.use("/workspaces/:workspaceId/settings", settingsRouter);
	return app;
}

describe("settings route workspaceId validation", () => {
	it.each([
		"abc",
		"1.5",
		"0",
		"-1",
		"1e2",
	])("every verb rejects workspaceId %s with 400", async (id) => {
		const app = createApp();
		const path = `/workspaces/${id}/settings`;
		const responses = [
			await request(app).get(path),
			await request(app).patch(path).send({ version: 0 }),
			await request(app).delete(path),
			await request(app).post(`${path}/logo`),
		];
		for (const res of responses) {
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: WORKSPACE_MSG });
		}
	});
});

describe("parseSettingsPatch object form", () => {
	it("pins every message", () => {
		expect(failure({ boardName: 5, version: 0 })).toEqual({
			error: "boardName must be a string",
		});
		expect(failure({ boardName: "   ", version: 0 })).toEqual({
			error: "Name is required",
		});
		expect(failure({ boardName: "x".repeat(16), version: 0 })).toEqual({
			error: "Max 15 characters",
		});
		expect(failure({ logoPath: 5, version: 0 })).toEqual({
			error: "logoPath must be a string",
		});
		expect(failure({ logoPath: "  ", version: 0 })).toEqual({
			error: "logoPath cannot be empty",
		});
	});

	it("checks boardName before logoPath before updates before version", () => {
		expect(failure({ boardName: 1, logoPath: 1 })).toEqual({
			error: "boardName must be a string",
		});
		expect(failure({ logoPath: 1, updates: [{ key: "nope" }] })).toEqual({
			error: "logoPath must be a string",
		});
		expect(failure({ updates: [{ key: "nope" }] })).toEqual({
			error: "Invalid setting key: nope",
		});
	});

	it.each([
		["missing", {}],
		["string", { version: "1" }],
		["float", { version: 1.5 }],
		["null", { version: null }],
	])("rejects a %s version", (_label, body) => {
		expect(failure(body)).toEqual({ error: VERSION_MSG });
	});

	it("handles non-object bodies without throwing", () => {
		for (const body of [null, undefined, "str", 5]) {
			expect(failure(body)).toEqual({ error: VERSION_MSG });
		}
	});

	it("trims values and lets explicit fields beat updates[] entries", () => {
		const result = parseSettingsPatch({
			version: 2,
			boardName: "  Alpha ",
			updates: [
				{ key: "board_name", value: "Ignored" },
				{ key: "logo_path", value: " /a.png " },
			],
		});
		expect(result).toEqual({
			ok: true,
			data: {
				clientVersion: 2,
				updates: [
					{ key: "board_name", textValue: "Alpha" },
					{ key: "logo_path", textValue: "/a.png" },
				],
			},
		});
	});

	it("pins updates[] item messages", () => {
		const v = { version: 0 };
		expect(
			failure({ ...v, updates: [{ key: "board_name", value: 1 }] }),
		).toEqual({ error: "board_name value must be a string" });
		expect(
			failure({ ...v, updates: [{ key: "logo_path", value: 1 }] }),
		).toEqual({
			error: "logo_path value must be a string",
		});
		expect(
			failure({ ...v, updates: [{ key: "logo_path", value: " " }] }),
		).toEqual({ error: "logo_path cannot be empty" });
		expect(failure({ ...v, updates: [{ key: 5, value: "x" }] })).toEqual({
			error: "Invalid setting key: 5",
		});
		expect(failure({ ...v, updates: [null] })).toEqual({
			error: "Invalid setting key: ",
		});
	});
});

describe("parseSettingsPatch array form", () => {
	it("builds the message from the raw item", () => {
		expect(failure([{ key: "nope", version: 0 }])).toEqual({
			error: "Invalid setting key: nope",
		});
		expect(failure([{ key: 5, textValue: "x", version: 0 }])).toEqual({
			error: "Invalid setting key: 5",
		});
		expect(failure([{ key: "", textValue: "x", version: 0 }])).toEqual({
			error: "Invalid setting key: ",
		});
		expect(failure([null])).toEqual({ error: "Invalid setting key: " });
		expect(failure([7])).toEqual({ error: "Invalid setting key: " });
	});

	it("pins value messages", () => {
		expect(failure([{ key: "board_name", textValue: 1, version: 0 }])).toEqual({
			error: "board_name value must be a string",
		});
		expect(
			failure([{ key: "board_name", textValue: " ", version: 0 }]),
		).toEqual({
			error: "Name is required",
		});
		expect(failure([{ key: "logo_path", textValue: 1, version: 0 }])).toEqual({
			error: "logo_path value must be a string",
		});
		expect(failure([{ key: "logo_path", textValue: " ", version: 0 }])).toEqual(
			{
				error: "logo_path cannot be empty",
			},
		);
	});

	it("uses the last numeric item version and ignores non-numeric ones", () => {
		const result = parseSettingsPatch([
			{ key: "board_name", textValue: "A", version: 1 },
			{ key: "logo_path", textValue: "/a.png", version: "x" },
		]);
		expect(result).toMatchObject({ ok: true, data: { clientVersion: 1 } });
		expect(failure([{ key: "board_name", textValue: "A" }])).toEqual({
			error: VERSION_MSG,
		});
		expect(failure([])).toEqual({ error: VERSION_MSG });
	});
});

describe("settings route ordering (membership and role before body validation)", () => {
	beforeEach(() => mockGetMemberRole.mockReset());

	it("PATCH with an invalid body is 404 for a non-member", async () => {
		mockGetMemberRole.mockResolvedValue(undefined);
		const res = await request(createApp())
			.patch("/workspaces/7/settings")
			.send({ boardName: 5 });
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Not found" });
	});

	it("PATCH with an invalid body is 403 for a plain member", async () => {
		mockGetMemberRole.mockResolvedValue("member");
		const res = await request(createApp())
			.patch("/workspaces/7/settings")
			.send({ boardName: 5 });
		expect(res.status).toBe(403);
	});

	it("PATCH with an invalid body is 400 for an admin", async () => {
		mockGetMemberRole.mockResolvedValue("admin");
		const res = await request(createApp())
			.patch("/workspaces/7/settings")
			.send({ boardName: 5, version: 0 });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "boardName must be a string" });
	});

	it("PATCH with a null array item is 400, not a 500", async () => {
		mockGetMemberRole.mockResolvedValue("owner");
		const res = await request(createApp())
			.patch("/workspaces/7/settings")
			.send([null]);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "Invalid setting key: " });
	});

	it("POST /logo without a file is 400 for an owner", async () => {
		mockGetMemberRole.mockResolvedValue("owner");
		const res = await request(createApp()).post("/workspaces/7/settings/logo");
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "No file uploaded" });
	});
});

describe("parseSettingsPatch version range", () => {
	it("rejects unsafe integers (zod int) that used to reach the 409 path", () => {
		expect(failure({ version: 1e300 })).toEqual({ error: VERSION_MSG });
		expect(failure({ version: 2 ** 60 })).toEqual({ error: VERSION_MSG });
	});
});
