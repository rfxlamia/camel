// server/src/routes/tracker-items.write.test.ts
//
// parseProjectPhase/parseDateRange are unit-tested against real DB lookups
// in tracker-item-parsers.test.ts (T5) — here they are mocked so this file
// tests only what T7 adds: wiring, position/date/completed_at persistence,
// and version semantics.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POSITION_GAP } from "../core/position.js";

function chainable(result: unknown) {
	const b: any = {};
	for (const m of [
		"where",
		"returning",
		"orderBy",
		"select",
		"$if",
		"onConflict",
		"innerJoin",
		"leftJoin",
	]) {
		b[m] = vi.fn(() => b);
	}
	const isArray = Array.isArray(result);
	b.execute = vi.fn().mockResolvedValue(isArray ? result : [result]);
	b.executeTakeFirst = vi.fn().mockResolvedValue(isArray ? result[0] : result);
	b.executeTakeFirstOrThrow = b.executeTakeFirst;
	return b;
}

const insertedValues: any[] = [];
const updatedSets: any[] = [];
let bucketMaxPosition: number | null = null;
let trxStatusCategory: string | null = "completed";

function makeTrx() {
	const trx: any = {};
	trx.updateTable = vi.fn(() => ({
		set: vi.fn((values: unknown) => {
			updatedSets.push(values);
			return chainable({ id: 1, title: "Ship WBS" });
		}),
	}));
	trx.insertInto = vi.fn(() => ({
		values: vi.fn((values: unknown) => {
			insertedValues.push(values);
			return chainable({ id: 1 });
		}),
		onConflict: vi.fn(() => chainable(undefined)),
	}));
	trx.selectFrom = vi.fn((table: string) => {
		if (table === "tracker_items") {
			return chainable({ max_position: bucketMaxPosition });
		}
		if (table === "tracker_vocabularies") {
			return chainable({ category: trxStatusCategory, id: 4 });
		}
		return chainable([]);
	});
	return trx;
}

const mockSelectFrom = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../db/kysely.js", () => ({
	db: {
		selectFrom: (...args: unknown[]) => mockSelectFrom(...args),
		transaction: (...args: unknown[]) => mockTransaction(...args),
	},
}));
vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: (req: any, _res: any, next: any) => {
		req.workspace = { workspaceId: 7, role: "member" };
		next();
	},
}));
vi.mock("./tracker-assignees.js", () => ({
	loadTrackerAssigneesForItems: vi.fn().mockResolvedValue(new Map()),
	syncTrackerItemAssignees: vi.fn(),
}));
vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));

const mockParseProjectPhase = vi.fn();
const mockParseDateRange = vi.fn();
vi.mock("./tracker-item-parsers.js", () => ({
	parseProjectPhase: (...args: unknown[]) => mockParseProjectPhase(...args),
	parseDateRange: (...args: unknown[]) => mockParseDateRange(...args),
	parseAssigneeIds: vi.fn().mockResolvedValue([]),
	parseLabelIds: vi.fn().mockResolvedValue([]),
}));

import { trackerItemsRouter } from "./tracker-items.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as any).user = { id: 1, displayName: "Bob" };
	next();
});
app.use("/workspaces/:workspaceId", trackerItemsRouter);

const existingItemRow = {
	id: 1,
	key_number: 42,
	title: "Ship WBS",
	description: "",
	version: 3,
	created_at: new Date("2026-08-01T00:00:00Z"),
	updated_at: new Date("2026-08-01T00:00:00Z"),
	status_id: 3,
	status_name: "In Progress",
	status_kind: "status",
	status_position: 2000,
	status_colour: "oklch(0.7 0.1 150)",
	status_category: "started",
	priority_id: null,
	priority_name: null,
	priority_kind: null,
	priority_position: null,
	priority_colour: null,
	project_id: 5,
	phase_id: 9,
	start_date: null,
	end_date: null,
	completed_at: null,
	position: 1024,
};

beforeEach(() => {
	insertedValues.length = 0;
	updatedSets.length = 0;
	bucketMaxPosition = null;
	trxStatusCategory = "completed";
	mockSelectFrom.mockReset();
	mockTransaction.mockReset();
	mockParseProjectPhase.mockReset().mockResolvedValue({
		projectId: null,
		phaseId: null,
	});
	mockParseDateRange.mockReset().mockReturnValue({
		startDate: null,
		endDate: null,
	});
	mockTransaction.mockImplementation(() => ({
		execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx()),
	}));
	mockSelectFrom.mockImplementation((table: string) => {
		if (table === "workspaces") return chainable({ name: "Camel Team" });
		if (table === "tracker_vocabularies") {
			return chainable({ category: "completed", id: 4 });
		}
		return chainable(existingItemRow);
	});
});

describe("POST /tracker/items — assignment, dates, completion", () => {
	it("assigns an end-of-bucket position and never leaves it NULL", async () => {
		const res = await request(app)
			.post("/workspaces/7/tracker/items")
			.send({ title: "New task" });
		expect(res.status).toBe(201);
		const created = insertedValues.find((v) => "title" in v);
		expect(created).toBeDefined();
		expect(created.position).not.toBeNull();
		expect(created.position).not.toBeUndefined();
		expect(created.position).toBe(POSITION_GAP);
	});

	it("persists projectId, phaseId, startDate and endDate on create", async () => {
		mockParseProjectPhase.mockResolvedValueOnce({ projectId: 5, phaseId: 9 });
		mockParseDateRange.mockReturnValueOnce({
			startDate: "2026-09-21",
			endDate: "2026-09-30",
		});
		const res = await request(app).post("/workspaces/7/tracker/items").send({
			title: "New task",
			projectId: 5,
			phaseId: 9,
			startDate: "2026-09-21",
			endDate: "2026-09-30",
		});
		expect(res.status).toBe(201);
		const created = insertedValues.find((v) => "title" in v);
		expect(created.project_id).toBe(5);
		expect(created.phase_id).toBe(9);
		expect(created.start_date).toBe("2026-09-21");
		expect(created.end_date).toBe("2026-09-30");
	});

	it("returns 400 for an inverted date range and creates nothing", async () => {
		mockParseDateRange.mockReturnValueOnce({ error: "end precedes start" });
		const res = await request(app).post("/workspaces/7/tracker/items").send({
			title: "New task",
			startDate: "2026-09-30",
			endDate: "2026-09-21",
		});
		expect(res.status).toBe(400);
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("returns 400 for a cross-workspace or soft-deleted project/phase and creates nothing", async () => {
		mockParseProjectPhase.mockResolvedValueOnce({ error: "not found" });
		const res = await request(app)
			.post("/workspaces/7/tracker/items")
			.send({ title: "New task", projectId: 999 });
		expect(res.status).toBe(400);
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("stamps completed_at when the initial status category is completed", async () => {
		mockSelectFrom.mockImplementation((table: string) => {
			if (table === "workspaces") return chainable({ name: "Camel Team" });
			if (table === "tracker_vocabularies") {
				return chainable({ category: "completed", id: 4 });
			}
			return chainable(existingItemRow);
		});
		const res = await request(app)
			.post("/workspaces/7/tracker/items")
			.send({ title: "Done task", statusId: 4 });
		expect(res.status).toBe(201);
		const created = insertedValues.find((v) => "title" in v);
		expect(created.completed_at).toBeDefined();
		expect(created.completed_at).not.toBeNull();
	});
});

describe("PATCH /tracker/items/:key — assignment, dates, completion", () => {
	it("derives project_id from phaseId and bumps version", async () => {
		mockParseProjectPhase.mockResolvedValueOnce({ projectId: 5, phaseId: 9 });
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ phaseId: 9, version: 3 });
		expect(res.status).toBe(200);
		const update = updatedSets.find((s) => "phase_id" in s);
		expect(update.phase_id).toBe(9);
		expect(update.project_id).toBe(5);
		expect(update.version).toBeDefined();
	});

	it("nulls phase_id when projectId alone is supplied", async () => {
		mockParseProjectPhase.mockResolvedValueOnce({ projectId: 2, phaseId: null });
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ projectId: 2, version: 3 });
		expect(res.status).toBe(200);
		const update = updatedSets.find((s) => "project_id" in s);
		expect(update.project_id).toBe(2);
		expect(update.phase_id).toBeNull();
	});

	it("clears both project_id and phase_id when {projectId: null} and no phaseId", async () => {
		mockParseProjectPhase.mockResolvedValueOnce({
			projectId: null,
			phaseId: null,
		});
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ projectId: null, version: 3 });
		expect(res.status).toBe(200);
		const update = updatedSets.find((s) => "project_id" in s);
		expect(update.project_id).toBeNull();
		expect(update.phase_id).toBeNull();
	});

	it("returns 400 for {projectId: null, phaseId: X}", async () => {
		mockParseProjectPhase.mockResolvedValueOnce({ error: "invalid pair" });
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ projectId: null, phaseId: 9, version: 3 });
		expect(res.status).toBe(400);
	});

	it("returns 400 for a cross-workspace or soft-deleted project/phase and writes nothing", async () => {
		mockParseProjectPhase.mockResolvedValueOnce({ error: "not found" });
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ projectId: 999, version: 3 });
		expect(res.status).toBe(400);
		expect(updatedSets).toHaveLength(0);
	});

	it("returns 400 for an inverted date range", async () => {
		mockParseDateRange.mockReturnValueOnce({ error: "end precedes start" });
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ startDate: "2026-09-30", endDate: "2026-09-21", version: 3 });
		expect(res.status).toBe(400);
	});

	it("ignores completedAt and position when present in the body", async () => {
		mockParseProjectPhase.mockResolvedValueOnce({ projectId: 5, phaseId: 9 });
		bucketMaxPosition = 2048;
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({
				phaseId: 9,
				version: 3,
				completedAt: "2020-01-01T00:00:00Z",
				position: 999999,
			});
		expect(res.status).toBe(200);
		const update = updatedSets.find((s) => "phase_id" in s);
		expect(update.position).not.toBe(999999);
		expect(update.completed_at).not.toBe("2020-01-01T00:00:00Z");
	});

	it("assigns a fresh end-of-bucket position when the bucket changes", async () => {
		mockParseProjectPhase.mockResolvedValueOnce({
			projectId: null,
			phaseId: null,
		});
		bucketMaxPosition = 3072;
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ projectId: null, version: 3 });
		expect(res.status).toBe(200);
		const update = updatedSets.find((s) => "project_id" in s);
		expect(update.position).toBe(3072 + POSITION_GAP);
	});

	it("sets completed_at via COALESCE when transitioning into a completed status", async () => {
		mockSelectFrom.mockImplementation((table: string) => {
			if (table === "workspaces") return chainable({ name: "Camel Team" });
			if (table === "tracker_vocabularies") {
				return chainable({ category: "completed", id: 4 });
			}
			return chainable(existingItemRow);
		});
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ statusId: 4, version: 3 });
		expect(res.status).toBe(200);
		const update = updatedSets.find((s) => "status_id" in s);
		expect(update.completed_at).toBeDefined();
	});

	it("clears completed_at when leaving a completed status", async () => {
		trxStatusCategory = "started";
		const doneRow = {
			...existingItemRow,
			status_id: 4,
			status_category: "completed",
			completed_at: new Date("2026-08-02T00:00:00Z"),
		};
		mockSelectFrom.mockImplementation((table: string) => {
			if (table === "workspaces") return chainable({ name: "Camel Team" });
			if (table === "tracker_vocabularies") {
				return chainable({ category: "started", id: 3 });
			}
			return chainable(doneRow);
		});
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ statusId: 3, version: 3 });
		expect(res.status).toBe(200);
		const update = updatedSets.find((s) => "status_id" in s);
		expect(update.completed_at).toBeNull();
	});

	it("leaves completed_at NULL when transitioning into canceled", async () => {
		trxStatusCategory = "canceled";
		mockSelectFrom.mockImplementation((table: string) => {
			if (table === "workspaces") return chainable({ name: "Camel Team" });
			if (table === "tracker_vocabularies") {
				return chainable({ category: "canceled", id: 5 });
			}
			return chainable(existingItemRow);
		});
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-42")
			.send({ statusId: 5, version: 3 });
		expect(res.status).toBe(200);
		const update = updatedSets.find((s) => "status_id" in s);
		expect(update.completed_at).toBeNull();
	});
});
