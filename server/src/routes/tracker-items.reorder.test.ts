// server/src/routes/tracker-items.reorder.test.ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chainable(result: unknown) {
	const b: any = {};
	for (const m of [
		"where",
		"returning",
		"orderBy",
		"select",
		"$if",
		"forUpdate",
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

const updateCalls: Array<{ id: number; values: any }> = [];

function makeTrx(
	siblings: Array<{ id: number; key_number: number; position: number }>,
) {
	const trx: any = {};
	trx.selectFrom = vi.fn(() => chainable(siblings));
	trx.updateTable = vi.fn(() => ({
		set: vi.fn((values: any) => ({
			where: vi.fn((_col: string, _op: string, id: number) => {
				updateCalls.push({ id, values });
				return chainable(undefined);
			}),
		})),
	}));
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
vi.mock("../realtime.js", () => ({
	publishEvent: vi.fn(),
	clearPresence: vi.fn(),
}));
vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));

import { trackerItemsRouter } from "./tracker-items.js";
import { workItemsRouter } from "./work-items.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as any).user = { id: 1, displayName: "Bob" };
	next();
});
app.use("/workspaces/:workspaceId", trackerItemsRouter);

const workItemsApp = express();
workItemsApp.use(express.json());
workItemsApp.use((req, _res, next) => {
	(req as any).user = { id: 1, displayName: "Bob" };
	next();
});
workItemsApp.use("/workspaces/:workspaceId", workItemsRouter);

const itemC = {
	id: 3,
	key_number: 3,
	title: "C",
	description: "",
	version: 1,
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
	position: 3072,
};

function mockDbSelect() {
	mockSelectFrom.mockImplementation((table: string) => {
		if (table === "workspaces") return chainable({ name: "Camel Team" });
		if (table === "cards as c") return chainable(undefined);
		return chainable(itemC);
	});
}

beforeEach(() => {
	updateCalls.length = 0;
	mockSelectFrom.mockReset();
	mockTransaction.mockReset();
});

describe("PATCH /tracker/items/:key/position", () => {
	it("gives the moved item the midpoint position between its new neighbours", async () => {
		const siblings = [
			{ id: 1, key_number: 1, position: 1024 }, // A
			{ id: 2, key_number: 2, position: 2048 }, // B
			{ id: 3, key_number: 3, position: 3072 }, // C
		];
		mockTransaction.mockImplementation(() => ({
			execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx(siblings)),
		}));
		mockDbSelect();

		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-3/position")
			.send({ beforeKey: "CT-1", afterKey: "CT-2" });

		expect(res.status).toBe(200);
		const move = updateCalls.find((c) => c.id === 3);
		expect(move?.values.position).toBeCloseTo(1536);
	});

	it("leaves version and updated_at unchanged on a normal move", async () => {
		const siblings = [
			{ id: 1, key_number: 1, position: 1024 },
			{ id: 2, key_number: 2, position: 2048 },
			{ id: 3, key_number: 3, position: 3072 },
		];
		mockTransaction.mockImplementation(() => ({
			execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx(siblings)),
		}));
		mockDbSelect();

		await request(app)
			.patch("/workspaces/7/tracker/items/CT-3/position")
			.send({ beforeKey: "CT-1", afterKey: "CT-2" });

		const move = updateCalls.find((c) => c.id === 3);
		expect(move?.values).not.toHaveProperty("version");
		expect(move?.values).not.toHaveProperty("updated_at");
	});

	it("rebalances the bucket without bumping any sibling version when neighbours are too close", async () => {
		const tight = [
			{ id: 1, key_number: 1, position: 1 },
			{ id: 2, key_number: 2, position: 1 + 1e-12 },
			{ id: 3, key_number: 3, position: 2048 },
		];
		mockTransaction.mockImplementation(() => ({
			execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx(tight)),
		}));
		mockDbSelect();

		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-3/position")
			.send({ beforeKey: "CT-1", afterKey: "CT-2" });

		expect(res.status).toBe(200);
		expect(updateCalls.every((c) => !("version" in c.values))).toBe(true);
		// A rebalance rewrites more than just the moved item.
		expect(updateCalls.length).toBeGreaterThan(1);
	});

	it("rejects a malformed neighbor key", async () => {
		const siblings = [
			{ id: 1, key_number: 1, position: 1024 },
			{ id: 3, key_number: 3, position: 3072 },
		];
		mockTransaction.mockImplementation(() => ({
			execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx(siblings)),
		}));
		mockDbSelect();

		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-3/position")
			.send({ beforeKey: "not-a-key" });

		expect(res.status).toBe(400);
		expect(res.body.error).toBe("invalid neighbor key");
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("rejects a neighbor key with the wrong workspace prefix", async () => {
		mockDbSelect();

		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-3/position")
			.send({ beforeKey: "CA-1" });

		expect(res.status).toBe(400);
		expect(res.body.error).toBe("invalid neighbor key");
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("rejects afterKey with the wrong workspace prefix", async () => {
		mockDbSelect();

		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-3/position")
			.send({ afterKey: "CA-2" });

		expect(res.status).toBe(400);
		expect(res.body.error).toBe("invalid neighbor key");
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("rejects a valid neighbor key that is not in the bucket", async () => {
		const siblings = [
			{ id: 1, key_number: 1, position: 1024 },
			{ id: 3, key_number: 3, position: 3072 },
		];
		mockTransaction.mockImplementation(() => ({
			execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx(siblings)),
		}));
		mockDbSelect();

		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-3/position")
			.send({ beforeKey: "CT-99" });

		expect(res.status).toBe(400);
		expect(res.body.error).toBe("neighbor not in bucket");
	});

	it("reorders via canonical /work-items path", async () => {
		const siblings = [
			{ id: 1, key_number: 1, position: 1024 },
			{ id: 2, key_number: 2, position: 2048 },
			{ id: 3, key_number: 3, position: 3072 },
		];
		mockTransaction.mockImplementation(() => ({
			execute: async (cb: (trx: unknown) => unknown) => cb(makeTrx(siblings)),
		}));
		mockDbSelect();

		const res = await request(workItemsApp)
			.patch("/workspaces/7/work-items/CT-3/position")
			.send({ beforeKey: "CT-1" });

		expect(res.status).toBe(200);
		const move = updateCalls.find((c) => c.id === 3);
		expect(move?.values.position).toBeDefined();
	});

	it("rejects a reorder targeting an item in another workspace without a 500", async () => {
		mockSelectFrom.mockReturnValue(chainable(undefined));
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-999/position")
			.send({ beforeKey: "CT-1", afterKey: "CT-2" });
		expect([400, 404]).toContain(res.status);
	});

	it("rejects a cross-bucket move", async () => {
		mockDbSelect();
		const res = await request(app)
			.patch("/workspaces/7/tracker/items/CT-3/position")
			.send({ projectId: 99, phaseId: 1 });
		expect(res.status).toBe(400);
	});
});
