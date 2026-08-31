// server/src/routes/tracker-projects.test.ts
//
// The position-read race is simulated with a promise-chain "row lock": each
// transaction awaits the previous one before its callback runs, mirroring
// what `SELECT ... FOR UPDATE` guarantees against real Postgres. This
// proves the handler takes the lock before it reads position, not that
// Postgres itself locks correctly — that guarantee is Postgres's, not this
// test's.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chainable(result: unknown) {
	const b: any = {};
	for (const m of ["where", "returning", "orderBy", "select", "$if", "forUpdate"]) {
		b[m] = vi.fn(() => b);
	}
	const isArray = Array.isArray(result);
	b.execute = vi.fn().mockResolvedValue(isArray ? result : [result]);
	b.executeTakeFirst = vi.fn().mockResolvedValue(isArray ? result[0] : result);
	b.executeTakeFirstOrThrow = b.executeTakeFirst;
	return b;
}

const insertedValues: Array<{ table: string; values: any }> = [];
const updatedSets: Array<{ table: string; values: any }> = [];
const callLog: string[] = [];

let sharedProjectCount = 0;
let phaseRows: any[] = [];
let itemRows: any[] = [];
let cardRows: any[] = [];
let lockChain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
	const run = lockChain.then(fn, fn);
	lockChain = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

function makeTrx() {
	const trx: any = {};
	trx.selectFrom = vi.fn((table: string) => {
		if (table === "workspaces") {
			const b = chainable({ id: 7 });
			b.forUpdate = vi.fn(() => {
				callLog.push("lock");
				return b;
			});
			return b;
		}
		if (table === "tracker_projects") {
			const b = chainable({ n: sharedProjectCount });
			b.executeTakeFirst = vi.fn(async () => {
				callLog.push("count");
				return { n: sharedProjectCount };
			});
			b.executeTakeFirstOrThrow = b.executeTakeFirst;
			return b;
		}
		if (table === "tracker_phases") return chainable(phaseRows);
		if (table === "tracker_items") return chainable(itemRows);
		if (table === "cards") return chainable(cardRows);
		return chainable([]);
	});
	trx.insertInto = vi.fn((table: string) => ({
		values: vi.fn((values: unknown) => {
			insertedValues.push({ table, values });
			if (table === "tracker_projects") sharedProjectCount += 1;
			return chainable({ id: 42, phases: [], ...(values as object) });
		}),
	}));
	trx.updateTable = vi.fn((table: string) => ({
		set: vi.fn((values: unknown) => {
			updatedSets.push({ table, values });
			return chainable(table === "tracker_items" ? itemRows : undefined);
		}),
	}));
	return trx;
}

const mockSelectFrom = vi.fn();
const mockUpdateTable = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../db/kysely.js", () => ({
	db: {
		selectFrom: (...args: unknown[]) => mockSelectFrom(...args),
		updateTable: (...args: unknown[]) => mockUpdateTable(...args),
		transaction: (...args: unknown[]) => mockTransaction(...args),
	},
}));
vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: (req: any, _res: any, next: any) => {
		req.workspace = { workspaceId: 7, role: "member" };
		next();
	},
}));
vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
vi.mock("./helpers.js", () => ({ recordActivity: vi.fn() }));
vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));

import { publishEvent } from "../realtime.js";
import { recordActivity } from "./helpers.js";
import { recordTrackerActivity } from "./tracker-activity.js";
import { trackerProjectsRouter } from "./tracker-projects.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as any).user = { id: 1, displayName: "Bob" };
	next();
});
app.use("/workspaces/:workspaceId", trackerProjectsRouter);

function useTransactionalTrx() {
	mockTransaction.mockImplementation(() => ({
		execute: (cb: (trx: unknown) => unknown) => withLock(() => cb(makeTrx())),
	}));
}

beforeEach(() => {
	insertedValues.length = 0;
	updatedSets.length = 0;
	callLog.length = 0;
	lockChain = Promise.resolve();
	sharedProjectCount = 0;
	phaseRows = [];
	itemRows = [];
	cardRows = [];
	mockSelectFrom.mockReset();
	mockUpdateTable.mockReset();
	mockTransaction.mockReset();
	vi.mocked(publishEvent).mockReset();
	vi.mocked(recordActivity).mockReset();
	vi.mocked(recordTrackerActivity).mockReset();
});

describe("POST /tracker/projects", () => {
	it("creates a project and returns 201 with the serialized project", async () => {
		sharedProjectCount = 2;
		useTransactionalTrx();
		const res = await request(app)
			.post("/workspaces/7/tracker/projects")
			.send({ name: "Rilis v2" });
		expect(res.status).toBe(201);
		expect(res.body.name).toBe("Rilis v2");
		expect(res.body.phases).toEqual([]);
	});

	it("rejects a whitespace-only name with 400 and opens no transaction", async () => {
		const res = await request(app)
			.post("/workspaces/7/tracker/projects")
			.send({ name: "   " });
		expect(res.status).toBe(400);
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("serializes two concurrent creates by taking the lock before reading position, so both succeed", async () => {
		sharedProjectCount = 9;
		useTransactionalTrx();
		const [first, second] = await Promise.all([
			request(app).post("/workspaces/7/tracker/projects").send({ name: "A" }),
			request(app).post("/workspaces/7/tracker/projects").send({ name: "B" }),
		]);
		const statuses = [first.status, second.status].sort();
		expect(statuses).toEqual([201, 201]);
		expect(insertedValues).toHaveLength(2);

		const lockIdx = callLog.flatMap((e, i) => (e === "lock" ? [i] : []));
		const countIdx = callLog.flatMap((e, i) => (e === "count" ? [i] : []));
		expect(lockIdx).toHaveLength(2);
		expect(countIdx).toHaveLength(2);
		expect(lockIdx[0]).toBeLessThan(countIdx[0]);
		expect(lockIdx[1]).toBeLessThan(countIdx[1]);
	});

	it("accepts a name reused from a soft-deleted project", async () => {
		sharedProjectCount = 3;
		useTransactionalTrx();
		const res = await request(app)
			.post("/workspaces/7/tracker/projects")
			.send({ name: "Rilis v2" });
		expect(res.status).toBe(201);
	});
});

describe("PATCH /tracker/projects/:id", () => {
	it("renames the project when the version matches", async () => {
		mockUpdateTable.mockImplementation((table: string) => ({
			set: vi.fn((values: unknown) => {
				updatedSets.push({ table, values });
				return chainable({ id: 3, name: "Rilis v3", version: 2, phases: [] });
			}),
		}));
		const res = await request(app)
			.patch("/workspaces/7/tracker/projects/3")
			.send({ name: "Rilis v3", version: 1 });
		expect(res.status).toBe(200);
		expect(res.body.name).toBe("Rilis v3");
	});

	it("returns 409 for a stale version on rename", async () => {
		mockUpdateTable.mockImplementation((table: string) => ({
			set: vi.fn((values: unknown) => {
				updatedSets.push({ table, values });
				return chainable(undefined); // no row matched the given version
			}),
		}));
		mockSelectFrom.mockImplementation((table: string) =>
			table === "tracker_projects"
				? chainable({ id: 3, version: 5 })
				: chainable([]),
		);
		const res = await request(app)
			.patch("/workspaces/7/tracker/projects/3")
			.send({ name: "Rilis v3", version: 1 });
		expect(res.status).toBe(409);
	});
});

describe("DELETE /tracker/projects/:id", () => {
	const releasedItems = [
		{
			id: 101,
			project_id: 3,
			phase_id: 9,
			version: 4,
			updated_at: "2026-08-01T00:00:00Z",
		},
		{
			id: 102,
			project_id: 3,
			phase_id: 10,
			version: 2,
			updated_at: "2026-08-01T00:00:00Z",
		},
	];
	const releasedCards = [
		{
			id: 201,
			title: "Board card A",
			project_id: 3,
			phase_id: 9,
		},
		{
			id: 202,
			title: "Board card B",
			project_id: 3,
			phase_id: null,
		},
	];

	beforeEach(() => {
		itemRows = releasedItems;
		cardRows = releasedCards;
		phaseRows = [{ id: 9 }, { id: 10 }];
		useTransactionalTrx();
	});

	it("soft-deletes the project and its phases and nulls project_id/phase_id on its tasks and cards", async () => {
		const res = await request(app).delete("/workspaces/7/tracker/projects/3").send({});
		expect(res.status).toBe(204);
		expect(
			updatedSets.find((u) => u.table === "tracker_projects")?.values.deleted_at,
		).toBeTruthy();
		expect(
			updatedSets.find((u) => u.table === "tracker_phases")?.values.deleted_at,
		).toBeTruthy();
		const itemRelease = updatedSets.find((u) => u.table === "tracker_items");
		expect(itemRelease?.values.project_id).toBeNull();
		expect(itemRelease?.values.phase_id).toBeNull();
		const cardRelease = updatedSets.find((u) => u.table === "cards");
		expect(cardRelease?.values.project_id).toBeNull();
		expect(cardRelease?.values.phase_id).toBeNull();
	});

	it("writes exactly one tracker_events row carrying the released (itemId, projectId, phaseId) triples", async () => {
		await request(app).delete("/workspaces/7/tracker/projects/3").send({});
		expect(recordTrackerActivity).toHaveBeenCalledTimes(1);
		const [, , , , opts] = vi.mocked(recordTrackerActivity).mock.calls[0] as any[];
		expect(opts.payload.released).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ itemId: 101, projectId: 3, phaseId: 9 }),
				expect.objectContaining({ itemId: 102, projectId: 3, phaseId: 10 }),
			]),
		);
	});

	it("publishes exactly one SSE event", async () => {
		await request(app).delete("/workspaces/7/tracker/projects/3").send({});
		expect(publishEvent).toHaveBeenCalledTimes(1);
	});

	it("leaves version and updated_at unchanged on released tasks", async () => {
		await request(app).delete("/workspaces/7/tracker/projects/3").send({});
		const itemRelease = updatedSets.find((u) => u.table === "tracker_items");
		expect(itemRelease?.values).not.toHaveProperty("version");
		expect(itemRelease?.values).not.toHaveProperty("updated_at");
	});

	it("records card activity for each released board card", async () => {
		await request(app).delete("/workspaces/7/tracker/projects/3").send({});
		expect(recordActivity).toHaveBeenCalledTimes(releasedCards.length);
		expect(recordActivity).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: 1 }),
			7,
			"update",
			expect.objectContaining({
				cardId: 201,
				payload: {
					cardTitle: "Board card A",
					changed: ["project", "phase"],
				},
			}),
		);
		expect(recordActivity).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: 1 }),
			7,
			"update",
			expect.objectContaining({
				cardId: 202,
				payload: {
					cardTitle: "Board card B",
					changed: ["project", "phase"],
				},
			}),
		);
	});

	it("leaves version unchanged on released cards", async () => {
		await request(app).delete("/workspaces/7/tracker/projects/3").send({});
		const cardRelease = updatedSets.find((u) => u.table === "cards");
		expect(cardRelease?.values).not.toHaveProperty("version");
	});
});

describe("GET /tracker/projects", () => {
	it("returns projects with phases nested by position, excluding soft-deleted rows", async () => {
		mockSelectFrom.mockImplementation((table: string) => {
			if (table === "tracker_projects") {
				return chainable([
					{ id: 1, name: "Rilis v2", position: 1024, version: 1 },
				]);
			}
			if (table === "tracker_phases") {
				return chainable([
					{ id: 9, project_id: 1, name: "Persiapan", position: 1024 },
				]);
			}
			return chainable([]);
		});
		const res = await request(app).get("/workspaces/7/tracker/projects");
		expect(res.status).toBe(200);
		expect(res.body).toHaveLength(1);
		expect(res.body[0].phases).toEqual([
			expect.objectContaining({ id: 9, name: "Persiapan" }),
		]);
	});
});
