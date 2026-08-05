import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
	const builder: any = {};
	for (const m of ["innerJoin", "leftJoin", "select", "where", "orderBy", "$if"]) {
		builder[m] = vi.fn(() => builder);
	}
	const isArray = Array.isArray(result);
	builder.execute = vi.fn().mockResolvedValue(isArray ? result : [result]);
	builder.executeTakeFirst = vi
		.fn()
		.mockResolvedValue(isArray ? result[0] : result);
	builder.executeTakeFirstOrThrow = builder.executeTakeFirst;
	return builder;
}

const mockSelectFrom = vi.fn();
vi.mock("../db/kysely.js", () => ({
	db: { selectFrom: (...args: unknown[]) => mockSelectFrom(...args) },
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
	heartbeat: vi.fn(),
	onlineUsers: vi.fn().mockResolvedValue([]),
	sseHandler: vi.fn(),
	createRealtimeHub: vi.fn(),
	initRealtime: vi.fn(),
	workspaceEventChannel: vi.fn(),
	workspacePresenceKey: vi.fn(),
	workspacePresencePattern: vi.fn(),
}));
vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));

import { trackerItemsRouter } from "./tracker-items.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as any).user = { id: 1, displayName: "Bob" };
	next();
});
app.use("/workspaces/:workspaceId", trackerItemsRouter);

const baseRow = {
	id: 1,
	key_number: 42,
	title: "Ship WBS",
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
	start_date: "2026-09-01",
	end_date: "2026-09-30",
	completed_at: null,
	position: 1024,
};

describe("GET /tracker/items — serialization", () => {
	beforeEach(() => mockSelectFrom.mockReset());

	it("carries projectId, phaseId, dates, position and status.category", async () => {
		mockSelectFrom
			.mockReturnValueOnce(chain({ name: "Camel Team" }))
			.mockReturnValueOnce(chain([baseRow]))
			.mockReturnValueOnce(chain([]));

		const res = await request(app).get("/workspaces/7/tracker/items");
		expect(res.status).toBe(200);
		const [item] = res.body;
		expect(item.projectId).toBe(5);
		expect(item.phaseId).toBe(9);
		expect(item.startDate).toBe("2026-09-01");
		expect(item.endDate).toBe("2026-09-30");
		expect(item.completedAt).toBeNull();
		expect(item.position).toBe(1024);
		expect(item.status.category).toBe("started");
	});

	it("serializes a null project and phase as null, not omitted", async () => {
		const unassigned = { ...baseRow, project_id: null, phase_id: null };
		mockSelectFrom
			.mockReturnValueOnce(chain({ name: "Camel Team" }))
			.mockReturnValueOnce(chain([unassigned]))
			.mockReturnValueOnce(chain([]));

		const res = await request(app).get("/workspaces/7/tracker/items");
		const [item] = res.body;
		expect(item).toHaveProperty("projectId", null);
		expect(item).toHaveProperty("phaseId", null);
	});

	it("never embeds a project/phase name or a rollup/progress/overdue field", async () => {
		mockSelectFrom
			.mockReturnValueOnce(chain({ name: "Camel Team" }))
			.mockReturnValueOnce(chain([baseRow]))
			.mockReturnValueOnce(chain([]));

		const res = await request(app).get("/workspaces/7/tracker/items");
		const [item] = res.body;
		expect(item).not.toHaveProperty("projectName");
		expect(item).not.toHaveProperty("phaseName");
		expect(item).not.toHaveProperty("progress");
		expect(item).not.toHaveProperty("rollup");
		expect(item).not.toHaveProperty("overdue");
	});
});
