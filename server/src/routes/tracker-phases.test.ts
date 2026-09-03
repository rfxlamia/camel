// server/src/routes/tracker-phases.test.ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POSITION_GAP } from "../core/position.js";

const orchestrationLog: string[] = [];

function chainable(result: unknown, table?: string) {
	const b: any = {};
	let locked = false;
	for (const m of ["where", "returning", "orderBy", "select", "innerJoin", "$if"]) {
		b[m] = vi.fn(() => b);
	}
	b.forUpdate = vi.fn(() => {
		locked = true;
		if (table) orchestrationLog.push(`lock:${table}`);
		return b;
	});
	const isArray = Array.isArray(result);
	b.execute = vi.fn().mockImplementation(async () => {
		if (table && !locked && (table === "tracker_items" || table === "cards")) {
			orchestrationLog.push(`scan:${table}`);
		}
		return isArray ? result : [result];
	});
	b.executeTakeFirst = vi.fn().mockImplementation(async () => {
		if (table && !locked && table === "tracker_phases as tp") {
			orchestrationLog.push(`lookup:${table}`);
		}
		return isArray ? result[0] : result;
	});
	b.executeTakeFirstOrThrow = b.executeTakeFirst;
	return b;
}

const insertedValues: Array<{ table: string; values: any }> = [];
const updatedSets: Array<{ table: string; values: any; where?: any }> = [];
let phaseMaxPosition: number | null = null;
let phaseItems: Array<{
	id: number;
	project_id: number;
	phase_id: number;
	position: number;
	version: number;
	updated_at: string;
}> = [];
let noPhaseMaxPosition: number | null = null;
let projectExists = true;
let cardRows: Array<{ id: number; title: string; project_id: number; phase_id: number }> =
	[];

function makeTrx() {
	const trx: any = {};
	trx.selectFrom = vi.fn((table: string) => {
		if (table === "workspaces") {
			return chainable({ id: 7 }, table);
		}
		if (table === "tracker_projects" || table === "tracker_projects as tpr") {
			return chainable(projectExists ? { id: 3 } : undefined, table);
		}
		if (table === "tracker_phases as tp") {
			return chainable({ id: 11, project_id: 3 }, table);
		}
		if (table === "tracker_phases") {
			return chainable({ max_position: phaseMaxPosition }, table);
		}
		if (table === "cards") {
			return chainable(cardRows, table);
		}
		if (table === "tracker_items") {
			const b = chainable(phaseItems, table);
			b.orderBy = vi.fn(() => {
				const ordered = chainable(phaseItems, table);
				ordered.execute = vi.fn().mockImplementation(async () => {
					orchestrationLog.push("scan:tracker_items");
					return phaseItems;
				});
				return ordered;
			});
			b.execute = vi.fn().mockImplementation(async () => {
				orchestrationLog.push("scan:tracker_items");
				return phaseItems;
			});
			b.executeTakeFirst = vi.fn().mockResolvedValue({
				max_position: noPhaseMaxPosition,
			});
			return b;
		}
		return chainable([], table);
	});
	trx.insertInto = vi.fn((table: string) => ({
		values: vi.fn((values: unknown) => {
			insertedValues.push({ table, values });
			return chainable({
				id: 11,
				project_id: 3,
				version: 1,
				created_at: "2026-08-01T00:00:00Z",
				updated_at: "2026-08-01T00:00:00Z",
				...(values as object),
			});
		}),
	}));
	trx.updateTable = vi.fn((table: string) => ({
		set: vi.fn((values: unknown) => {
			updatedSets.push({ table, values });
			return chainable(
				table === "tracker_phases"
					? {
							id: 11,
							project_id: 3,
							name: "Persiapan",
							subtitle: "",
							version: 2,
							created_at: "2026-08-01T00:00:00Z",
							updated_at: "2026-08-01T00:00:00Z",
						}
					: undefined,
			);
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
vi.mock("../realtime.js", () => ({
	publishEvent: vi.fn(),
	clearPresence: vi.fn(),
}));
vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));
vi.mock("./helpers.js", () => ({ recordActivity: vi.fn() }));

import { publishEvent } from "../realtime.js";
import { recordActivity } from "./helpers.js";
import { recordTrackerActivity } from "./tracker-activity.js";
import { trackerPhasesRouter } from "./tracker-phases.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as any).user = { id: 1, displayName: "Bob" };
	next();
});
app.use("/workspaces/:workspaceId", trackerPhasesRouter);

function useTransactionalTrx() {
	mockTransaction.mockImplementation(() => ({
		execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx()),
	}));
}

beforeEach(() => {
	insertedValues.length = 0;
	updatedSets.length = 0;
	phaseMaxPosition = 2048;
	phaseItems = [];
	noPhaseMaxPosition = null;
	projectExists = true;
	cardRows = [];
	orchestrationLog.length = 0;
	mockSelectFrom.mockReset();
	mockUpdateTable.mockReset();
	mockTransaction.mockReset();
	vi.mocked(publishEvent).mockReset();
	vi.mocked(recordTrackerActivity).mockReset();
	vi.mocked(recordActivity).mockReset();
});

describe("POST /tracker/projects/:projectId/phases", () => {
	beforeEach(() => useTransactionalTrx());

	it("creates a phase at the end of the project's list and returns 201", async () => {
		const res = await request(app)
			.post("/workspaces/7/tracker/projects/3/phases")
			.send({ name: "Persiapan" });
		expect(res.status).toBe(201);
		expect(res.body.name).toBe("Persiapan");
		expect(res.body.projectId).toBe(3);
		const created = insertedValues.find((v) => v.table === "tracker_phases");
		expect(created?.values.position).toBe(phaseMaxPosition! + POSITION_GAP);
	});

	it("persists optional subtitle and dates", async () => {
		const res = await request(app)
			.post("/workspaces/7/tracker/projects/3/phases")
			.send({
				name: "Persiapan",
				subtitle: "Week 1",
				startDate: "2026-09-01",
				endDate: "2026-09-30",
			});
		expect(res.status).toBe(201);
		const created = insertedValues.find((v) => v.table === "tracker_phases");
		expect(created?.values.subtitle).toBe("Week 1");
		expect(created?.values.start_date).toBe("2026-09-01");
		expect(created?.values.end_date).toBe("2026-09-30");
	});

	it("rejects a whitespace-only name with 400 and opens no transaction", async () => {
		const res = await request(app)
			.post("/workspaces/7/tracker/projects/3/phases")
			.send({ name: "   " });
		expect(res.status).toBe(400);
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("returns 400 for an inverted date range", async () => {
		const res = await request(app)
			.post("/workspaces/7/tracker/projects/3/phases")
			.send({
				name: "Persiapan",
				startDate: "2026-09-30",
				endDate: "2026-09-01",
			});
		expect(res.status).toBe(400);
		expect(insertedValues).toHaveLength(0);
	});

	it("returns 404 when the project is missing or from another workspace", async () => {
		projectExists = false;
		const res = await request(app)
			.post("/workspaces/7/tracker/projects/3/phases")
			.send({ name: "Persiapan" });
		expect(res.status).toBe(404);
	});
});

describe("PATCH /tracker/phases/:id", () => {
	it("renames the phase when the version matches", async () => {
		mockUpdateTable.mockImplementation((table: string) => ({
			set: vi.fn((values: unknown) => {
				updatedSets.push({ table, values });
				return chainable({
					id: 11,
					project_id: 3,
					name: "Eksekusi",
					subtitle: "",
					position: 1024,
					version: 2,
					start_date: null,
					end_date: null,
					created_at: "2026-08-01T00:00:00Z",
					updated_at: "2026-08-01T00:00:00Z",
				});
			}),
		}));
		mockSelectFrom.mockImplementation((table: string) => {
			if (table === "tracker_phases as tp") {
				return chainable({ id: 11, project_id: 3 });
			}
			return chainable([]);
		});
		const res = await request(app)
			.patch("/workspaces/7/tracker/phases/11")
			.send({ name: "Eksekusi", version: 1 });
		expect(res.status).toBe(200);
		expect(res.body.name).toBe("Eksekusi");
	});

	it("returns 409 for a stale version on rename", async () => {
		mockUpdateTable.mockImplementation((table: string) => ({
			set: vi.fn((values: unknown) => {
				updatedSets.push({ table, values });
				return chainable(undefined);
			}),
		}));
		mockSelectFrom.mockImplementation((table: string) => {
			if (table === "tracker_phases as tp") {
				return chainable({ id: 11, version: 5 });
			}
			return chainable([]);
		});
		const res = await request(app)
			.patch("/workspaces/7/tracker/phases/11")
			.send({ name: "Eksekusi", version: 1 });
		expect(res.status).toBe(409);
	});

	it("updates explicit dates when provided", async () => {
		mockUpdateTable.mockImplementation((table: string) => ({
			set: vi.fn((values: unknown) => {
				updatedSets.push({ table, values });
				return chainable({
					id: 11,
					project_id: 3,
					name: "Persiapan",
					subtitle: "",
					position: 1024,
					version: 2,
					start_date: "2026-09-01",
					end_date: "2026-09-30",
					created_at: "2026-08-01T00:00:00Z",
					updated_at: "2026-08-01T00:00:00Z",
				});
			}),
		}));
		mockSelectFrom.mockImplementation((table: string) => {
			if (table === "tracker_phases as tp") {
				return chainable({ id: 11, project_id: 3 });
			}
			return chainable([]);
		});
		const res = await request(app)
			.patch("/workspaces/7/tracker/phases/11")
			.send({
				name: "Persiapan",
				version: 1,
				startDate: "2026-09-01",
				endDate: "2026-09-30",
			});
		expect(res.status).toBe(200);
		const phaseUpdate = updatedSets.find((u) => u.table === "tracker_phases");
		expect(phaseUpdate?.values.start_date).toBe("2026-09-01");
		expect(phaseUpdate?.values.end_date).toBe("2026-09-30");
	});

	it("returns 400 for an inverted date range on patch", async () => {
		mockSelectFrom.mockImplementation((table: string) => {
			if (table === "tracker_phases as tp") {
				return chainable({ id: 11, project_id: 3 });
			}
			return chainable([]);
		});
		const res = await request(app)
			.patch("/workspaces/7/tracker/phases/11")
			.send({
				name: "Persiapan",
				version: 1,
				startDate: "2026-09-30",
				endDate: "2026-09-01",
			});
		expect(res.status).toBe(400);
	});
});

describe("DELETE /tracker/phases/:id", () => {
	const releasedItems = [
		{
			id: 101,
			project_id: 3,
			phase_id: 11,
			position: 1024,
			version: 4,
			updated_at: "2026-08-01T00:00:00Z",
		},
		{
			id: 102,
			project_id: 3,
			phase_id: 11,
			position: 2048,
			version: 2,
			updated_at: "2026-08-01T00:00:00Z",
		},
	];

	beforeEach(() => {
		phaseItems = [...releasedItems];
		noPhaseMaxPosition = 4096;
		useTransactionalTrx();
	});

	it("soft-deletes the phase and nulls phase_id while keeping project_id on its tasks", async () => {
		const res = await request(app).delete("/workspaces/7/tracker/phases/11");
		expect(res.status).toBe(204);
		expect(
			updatedSets.find((u) => u.table === "tracker_phases")?.values.deleted_at,
		).toBeTruthy();
		const itemUpdates = updatedSets.filter((u) => u.table === "tracker_items");
		expect(itemUpdates.length).toBeGreaterThan(0);
		for (const update of itemUpdates) {
			expect(update.values.phase_id).toBeNull();
			expect(update.values).not.toHaveProperty("project_id");
		}
	});

	it("writes exactly one tracker_events row carrying the released (itemId, projectId, phaseId) triples", async () => {
		await request(app).delete("/workspaces/7/tracker/phases/11");
		expect(recordTrackerActivity).toHaveBeenCalledTimes(1);
		const [, , , , opts] = vi.mocked(recordTrackerActivity).mock.calls[0] as any[];
		expect(opts.payload.released).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ itemId: 101, projectId: 3, phaseId: 11 }),
				expect.objectContaining({ itemId: 102, projectId: 3, phaseId: 11 }),
			]),
		);
	});

	it("publishes exactly one SSE event", async () => {
		await request(app).delete("/workspaces/7/tracker/phases/11");
		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith(7, {
			type: "tracker.phase.deleted",
			actor: expect.objectContaining({ id: 1 }),
		});
	});

	it("leaves version and updated_at unchanged on released tasks", async () => {
		await request(app).delete("/workspaces/7/tracker/phases/11");
		const itemUpdates = updatedSets.filter((u) => u.table === "tracker_items");
		for (const update of itemUpdates) {
			expect(update.values).not.toHaveProperty("version");
			expect(update.values).not.toHaveProperty("updated_at");
		}
	});

	it("locks phase removal before dependent scans", async () => {
		cardRows = [
			{ id: 201, title: "Board card", project_id: 3, phase_id: 11 },
		];
		await request(app).delete("/workspaces/7/tracker/phases/11");

		const workspaceLock = orchestrationLog.indexOf("lock:workspaces");
		const projectLock = Math.max(
			orchestrationLog.indexOf("lock:tracker_projects"),
			orchestrationLog.indexOf("lock:tracker_projects as tpr"),
		);
		const phaseLock = orchestrationLog.indexOf("lock:tracker_phases as tp");
		const dependentScan = Math.min(
			orchestrationLog.indexOf("scan:tracker_items") === -1
				? Number.POSITIVE_INFINITY
				: orchestrationLog.indexOf("scan:tracker_items"),
			orchestrationLog.indexOf("scan:cards") === -1
				? Number.POSITIVE_INFINITY
				: orchestrationLog.indexOf("scan:cards"),
		);

		expect(workspaceLock).toBeGreaterThanOrEqual(0);
		expect(projectLock).toBeGreaterThan(workspaceLock);
		expect(phaseLock).toBeGreaterThan(projectLock);
		expect(phaseLock).toBeLessThan(dependentScan);
	});

	it("assigns end-of-bucket positions after existing no-phase tasks in old-position order", async () => {
		phaseItems = [
			{ ...releasedItems[0], id: 103, position: 3000 },
			{ ...releasedItems[0], id: 101, position: 1000 },
			{ ...releasedItems[0], id: 102, position: 2000 },
		];
		await request(app).delete("/workspaces/7/tracker/phases/11");
		const positions = updatedSets
			.filter((u) => u.table === "tracker_items")
			.map((u) => u.values.position);
		expect(positions).toEqual([
			noPhaseMaxPosition! + POSITION_GAP,
			noPhaseMaxPosition! + POSITION_GAP * 2,
			noPhaseMaxPosition! + POSITION_GAP * 3,
		]);
	});
});
