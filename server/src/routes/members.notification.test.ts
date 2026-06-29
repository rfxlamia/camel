import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { domainBus, EVENTS } from "../events.js";

vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));
vi.mock("./helpers.js", () => ({
	lookupMembership: vi.fn(),
	checkActorCanManage: vi.fn(),
	countUserMemberships: vi.fn(),
	checkInviteeCap: vi.fn(),
	workspaceAccessService: vi.fn(),
	parseWorkspaceId: vi.fn((id: string) => Number(id)),
	recordActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: (_req: unknown, _res: unknown, next: () => void) =>
		next(),
}));

import { pool } from "../db/pool.js";
import {
	lookupMembership,
	checkActorCanManage,
	countUserMemberships,
	checkInviteeCap,
} from "./helpers.js";
import { membersRouter } from "./members.js";

const mockQuery = vi.mocked(pool.query);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as Record<string, unknown>).user = { id: 99, displayName: "Admin" };
	next();
});
app.use("/workspaces/:workspaceId", membersRouter);

afterEach(() => {
	domainBus.removeAllListeners();
});

describe("members route — MEMBER_JOINED event emission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(lookupMembership)
			.mockResolvedValueOnce("admin")
			.mockResolvedValueOnce(null);
		vi.mocked(checkActorCanManage).mockReturnValue({ allowed: true } as never);
		vi.mocked(countUserMemberships).mockResolvedValue(0);
		vi.mocked(checkInviteeCap).mockReturnValue({ ok: true } as never);
	});

	it("emits MEMBER_JOINED after successful member insert with existingMemberIds", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ id: 5, username: "charlie", display_name: "Charlie" }],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({
				rows: [{ user_id: 1 }, { user_id: 2 }],
				rowCount: 2,
			} as never)
			.mockResolvedValueOnce({
				rows: [{ name: "Team Alpha" }],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
			.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		const received: unknown[] = [];
		domainBus.once(EVENTS.MEMBER_JOINED, (e) => received.push(e));

		await request(app)
			.post("/workspaces/1/members")
			.send({ username: "charlie" });

		expect(received).toHaveLength(1);
		const event = received[0] as {
			payload: {
				newMemberId: number;
				existingMemberIds: number[];
				workspaceName: string;
			};
		};
		expect(event.payload.newMemberId).toBe(5);
		expect(event.payload.existingMemberIds).toEqual([1, 2]);
		expect(event.payload.workspaceName).toBe("Team Alpha");
	});
});
