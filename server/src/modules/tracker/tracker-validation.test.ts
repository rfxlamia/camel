import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindTrackerItem = vi.fn();
const mockFindBoardCard = vi.fn();

vi.mock("../../db/kysely.js", () => ({ db: {} }));
vi.mock("../../realtime.js", () => ({ publishEvent: vi.fn() }));
vi.mock("../../lib/helpers.js", () => ({ recordActivity: vi.fn() }));
vi.mock("../../lib/tracker-activity.js", () => ({
	recordTrackerActivity: vi.fn(),
}));
vi.mock("../../middleware/workspace.js", () => ({
	requireWorkspaceMember: (
		req: express.Request,
		_res: express.Response,
		next: express.NextFunction,
	) => {
		req.workspace = { workspaceId: 7, role: "admin" };
		next();
	},
}));
vi.mock("./tracker-item-create-queries.js", () => ({
	workspacePrefix: vi.fn().mockResolvedValue("CT"),
}));
vi.mock("./tracker-item-merged-queries.js", () => ({
	findColumnlessItem: (...args: unknown[]) => mockFindTrackerItem(...args),
	classifyWriteFailure: vi.fn(),
	loadMutationResponse: vi.fn(),
}));
vi.mock("../../lib/work-item-response.js", () => ({
	findBoardCardByKeyNumber: (...args: unknown[]) => mockFindBoardCard(...args),
}));

import { createTrackerItemHandler } from "./tracker-item-create.js";
import { getTrackerItemHandler } from "./tracker-item-read.js";
import { reorderTrackerItemHandler } from "./tracker-item-reorder.js";
import { updateTrackerItemHandler } from "./tracker-item-update.js";
import { trackerPhasesRouter } from "./tracker-phases.js";
import { trackerProjectsRouter } from "./tracker-projects.js";
import { trackerVocabulariesRouter } from "./tracker-vocabularies.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1 } as never;
		req.workspace = { workspaceId: 7, role: "admin" };
		next();
	});
	const base = "/workspaces/:workspaceId/tracker";
	app.get(`${base}/items/:key`, getTrackerItemHandler);
	app.post(`${base}/items`, createTrackerItemHandler);
	app.patch(`${base}/items/:key`, updateTrackerItemHandler);
	app.post(`${base}/items/:key/reorder`, reorderTrackerItemHandler);
	app.use("/workspaces/:workspaceId", trackerPhasesRouter);
	app.use("/workspaces/:workspaceId", trackerProjectsRouter);
	app.use("/workspaces/:workspaceId", trackerVocabulariesRouter);
	return app;
}

const T = "/workspaces/7/tracker";

describe("tracker 400 bodies", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFindTrackerItem.mockResolvedValue(undefined);
		mockFindBoardCard.mockResolvedValue(undefined);
	});

	describe("tracker key", () => {
		it.each([
			["get", () => request(createApp()).get(`${T}/items/nope`)],
			[
				"patch",
				() =>
					request(createApp()).patch(`${T}/items/nope`).send({ title: "x" }),
			],
			[
				"reorder",
				() =>
					request(createApp())
						.post(`${T}/items/nope/reorder`)
						.send({ beforeKey: "CT-1" }),
			],
		])("%s rejects a malformed key", async (_name, call) => {
			const res = await call();
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "invalid tracker key" });
		});
	});

	describe("create", () => {
		it.each([
			{},
			{ title: "   " },
			{ title: 5 },
		])("requires a title (%j)", async (body) => {
			const res = await request(createApp()).post(`${T}/items`).send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "title is required" });
		});
	});

	describe("update", () => {
		it("rejects a non-integer version before any lookup", async () => {
			const res = await request(createApp())
				.patch(`${T}/items/CT-1`)
				.send({ version: "2", title: "x" });
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "version must be an integer" });
			expect(mockFindTrackerItem).not.toHaveBeenCalled();
		});

		it("returns 404 for an unknown key even when the body is invalid", async () => {
			const res = await request(createApp())
				.patch(`${T}/items/CT-1`)
				.send({ title: "  " });
			expect(res.status).toBe(404);
		});

		it("returns 409 for a board card edited with extra fields", async () => {
			mockFindBoardCard.mockResolvedValue({ id: 3 });
			const res = await request(createApp())
				.patch(`${T}/items/CT-1`)
				.send({ statusId: 2, title: "x" });
			expect(res.status).toBe(409);
		});

		it("rejects a non-integer statusId on a board card", async () => {
			mockFindBoardCard.mockResolvedValue({ id: 3 });
			const res = await request(createApp())
				.patch(`${T}/items/CT-1`)
				.send({ statusId: "2" });
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "statusId must be an integer" });
		});

		describe("on an existing tracker item", () => {
			beforeEach(() => {
				mockFindTrackerItem.mockResolvedValue({
					id: 1,
					title: "t",
					project_id: null,
					phase_id: null,
				});
			});

			it.each([
				[{ statusId: "2" }, "statusId must be an integer"],
				[{ statusId: 1.5, title: "x" }, "statusId must be an integer"],
				[{ title: "  " }, "title is required"],
				[
					{ title: "x", priorityId: "high" },
					"priorityId must be an integer or null",
				],
				[{ description: 5 }, "no updatable fields provided"],
				[{}, "no updatable fields provided"],
			])("%j -> 400 %s", async (body, message) => {
				const res = await request(createApp())
					.patch(`${T}/items/CT-1`)
					.send(body);
				expect(res.status).toBe(400);
				expect(res.body).toEqual({ error: message });
			});

			it("checks title before status and priority", async () => {
				const res = await request(createApp())
					.patch(`${T}/items/CT-1`)
					.send({ title: "", statusId: "x", priorityId: "y" });
				expect(res.body).toEqual({ error: "title is required" });
			});
		});
	});

	describe("reorder", () => {
		it("rejects cross-bucket moves", async () => {
			const res = await request(createApp())
				.post(`${T}/items/CT-1/reorder`)
				.send({ projectId: 1, beforeKey: "CT-2" });
			expect(res.status).toBe(400);
			expect(res.body).toEqual({
				error: "cross-bucket move not allowed on reorder",
			});
		});

		it.each([
			[{ beforeKey: 1 }, "beforeKey must be a string"],
			[{ beforeKey: null }, "beforeKey must be a string"],
			[{ afterKey: 1 }, "afterKey must be a string"],
			[{ beforeKey: 1, afterKey: 2 }, "beforeKey must be a string"],
			[{}, "beforeKey or afterKey is required"],
			[[], "beforeKey or afterKey is required"],
			[[{ beforeKey: "CT-2" }], "beforeKey or afterKey is required"],
		])("%j -> 400 %s", async (body, message) => {
			const res = await request(createApp())
				.post(`${T}/items/CT-1/reorder`)
				.send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: message });
		});
	});

	describe("vocabularies", () => {
		it.each([
			undefined,
			"bogus",
			"123",
		])("GET rejects kind %j", async (kind) => {
			const res = await request(createApp())
				.get(`${T}/vocabularies`)
				.query(kind === undefined ? {} : { kind });
			expect(res.status).toBe(400);
			expect(res.body).toEqual({
				error: "kind must be status, priority, or label",
			});
		});

		it.each([
			[
				{ kind: "nope", name: "a", position: 1 },
				"kind must be status, priority, or label",
			],
			[
				{ kind: "status", name: "", position: "x" },
				"The status vocabulary is fixed.",
			],
			[{ kind: "label", name: "  ", position: 1 }, "name is required"],
			[
				{ kind: "label", name: "a", position: "1" },
				"position must be a number",
			],
			[{ kind: "label", name: "a" }, "position must be a number"],
		])("POST %j -> 400 %s", async (body, message) => {
			const res = await request(createApp())
				.post(`${T}/vocabularies`)
				.send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: message });
		});
	});

	describe("projects", () => {
		it("POST requires a name", async () => {
			const res = await request(createApp())
				.post(`${T}/projects`)
				.send({ name: " " });
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "name is required" });
		});

		it.each([
			["abc", { name: "a", version: 1 }, "invalid project id"],
			["0", { name: "a", version: 1 }, "invalid project id"],
			["1e2", { name: "a", version: 1 }, "invalid project id"],
			["5", { name: " ", version: 1 }, "name is required"],
			["5", { name: "a" }, "version must be an integer"],
			["5", { name: "a", version: "1" }, "version must be an integer"],
		])("PATCH /projects/%s %j -> 400 %s", async (id, body, message) => {
			const res = await request(createApp())
				.patch(`${T}/projects/${id}`)
				.send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: message });
		});

		it("DELETE rejects a bad id", async () => {
			const res = await request(createApp()).delete(`${T}/projects/x`);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "invalid project id" });
		});
	});

	describe("phases", () => {
		it.each([
			["abc", { name: "a" }, "invalid project id"],
			["5", { name: " " }, "name is required"],
		])("POST /projects/%s/phases %j -> 400 %s", async (id, body, message) => {
			const res = await request(createApp())
				.post(`${T}/projects/${id}/phases`)
				.send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: message });
		});

		it.each([
			["abc", { name: "a", version: 1 }, "invalid phase id"],
			["5", { name: "", version: 1 }, "name is required"],
			["5", { name: "a" }, "version must be an integer"],
		])("PATCH /phases/%s %j -> 400 %s", async (id, body, message) => {
			const res = await request(createApp())
				.patch(`${T}/phases/${id}`)
				.send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: message });
		});

		it("DELETE rejects a bad id", async () => {
			const res = await request(createApp()).delete(`${T}/phases/0`);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "invalid phase id" });
		});
	});
});
