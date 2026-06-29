import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { domainBus, EVENTS } from "../events.js";

const { mockClientQuery, mockClientRelease } = vi.hoisted(() => ({
	mockClientQuery: vi.fn(),
	mockClientRelease: vi.fn(),
}));

vi.mock("../db/pool.js", () => ({
	pool: {
		query: vi.fn(),
		connect: vi.fn().mockResolvedValue({
			query: mockClientQuery,
			release: mockClientRelease,
		}),
	},
}));
vi.mock("./helpers.js", () => ({
	checkInviteeCap: vi.fn(),
	countUserMemberships: vi.fn(),
}));

import { pool } from "../db/pool.js";
import { checkInviteeCap, countUserMemberships } from "./helpers.js";
import { invitesRouter } from "./invites.js";

const mockQuery = vi.mocked(pool.query);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as Record<string, unknown>).user = {
		id: 5,
		username: "charlie",
		displayName: "Charlie",
	};
	next();
});
app.use("/workspaces/:workspaceId", invitesRouter);

afterEach(() => {
	domainBus.removeAllListeners();
});

describe("invites route — MEMBER_JOINED event emission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(countUserMemberships).mockResolvedValue(0);
		vi.mocked(checkInviteeCap).mockReturnValue({ ok: true } as never);
	});

	it("emits MEMBER_JOINED after successful invite accept", async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [{ id: 20, workspace_id: 1, username: "charlie", role: "member" }],
			rowCount: 1,
		} as never);

		mockClientQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({
				rows: [{ user_id: 1 }, { user_id: 2 }],
				rowCount: 2,
			} as never)
			.mockResolvedValueOnce({
				rows: [{ name: "Team Alpha" }],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({ rows: [{ user_id: 5 }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({
				rows: [{ id: 1, name: "Team Alpha", is_personal: false }],
				rowCount: 1,
			} as never);

		const received: unknown[] = [];
		domainBus.once(EVENTS.MEMBER_JOINED, (e) => received.push(e));

		await request(app).post("/workspaces/1/invites/20/accept");

		expect(received).toHaveLength(1);
		const event = received[0] as {
			payload: {
				newMemberId: number;
				existingMemberIds: number[];
				workspaceName: string;
				newMemberDisplayName: string;
			};
		};
		expect(event.payload.newMemberId).toBe(5);
		expect(event.payload.newMemberDisplayName).toBe("Charlie");
		expect(event.payload.existingMemberIds).toEqual([1, 2]);
		expect(event.payload.workspaceName).toBe("Team Alpha");
	});
});
