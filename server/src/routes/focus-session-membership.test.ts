import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../auth.js";
import type { FocusSessionRepo, FocusSessionRow } from "./focus-session-repo.js";
import { finishActiveFocusSessionForRemoval } from "./focus-session-membership.js";

const T0 = new Date("2026-09-04T10:00:00.000Z");
const NOW = new Date(T0.getTime() + 120_000);

const ADMIN: AuthUser = {
	id: 2,
	username: "admin",
	displayName: "Admin",
	email: null,
	emailVerified: true,
	needsUsername: false,
};

function makeRunningRow(): FocusSessionRow {
	return {
		id: 99,
		user_id: 7,
		workspace_id: 3,
		task_source: "board",
		task_id: 481,
		task_key: "CA-42",
		return_path: "/board/card/481",
		state: "running",
		accumulated_seconds: 300,
		running_since: T0,
		version: 4,
		created_at: T0,
		updated_at: T0,
		finished_at: null,
	};
}

describe("finishActiveFocusSessionForRemoval", () => {
	it("finishes running session with accrued time and audits membership_removed", async () => {
		const row = makeRunningRow();
		const update = vi.fn(async () => ({
			...row,
			state: "finished" as const,
			accumulated_seconds: 420,
			running_since: null,
			finished_at: NOW,
			version: 5,
		}));
		const findActive = vi.fn(async () => row);
		const repo = { findActive, update } as unknown as FocusSessionRepo;
		const recordFocusActivity = vi.fn(async () => undefined);

		const result = await finishActiveFocusSessionForRemoval({
			repo,
			actor: ADMIN,
			userId: 7,
			workspaceId: 3,
			now: NOW,
			recordFocusActivity,
		});

		expect(result).toBe(true);
		expect(findActive).toHaveBeenCalledWith(7, 3);
		expect(update).toHaveBeenCalledWith(
			99,
			{
				state: "finished",
				accumulated_seconds: 420,
				running_since: null,
				finished_at: NOW,
			},
			4,
		);
		expect(recordFocusActivity).toHaveBeenCalledWith({
			actor: ADMIN,
			workspaceId: 3,
			sessionId: 99,
			action: "membership_removed",
		});
	});

	it("returns false when no active session exists", async () => {
		const findActive = vi.fn(async () => null);
		const update = vi.fn();
		const repo = { findActive, update } as unknown as FocusSessionRepo;
		const recordFocusActivity = vi.fn(async () => undefined);

		const result = await finishActiveFocusSessionForRemoval({
			repo,
			actor: ADMIN,
			userId: 7,
			workspaceId: 3,
			now: NOW,
			recordFocusActivity,
		});

		expect(result).toBe(false);
		expect(update).not.toHaveBeenCalled();
		expect(recordFocusActivity).not.toHaveBeenCalled();
	});
});
