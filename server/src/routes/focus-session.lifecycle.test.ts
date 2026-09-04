import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../auth.js";
import type { FocusSessionRow } from "./focus-session-repo.js";

const FIXED_DATE = new Date("2026-09-04T12:00:00.000Z");
const T0 = new Date("2026-09-04T10:00:00.000Z");
const T1 = new Date("2026-09-04T11:00:00.000Z");

const { mockConfig } = vi.hoisted(() => ({
	mockConfig: { FOCUS_MODE_ENABLED: "true" as string },
}));

const mockRequireWorkspaceMember = vi.hoisted(() =>
	vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
);

vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: (...args: unknown[]) =>
		mockRequireWorkspaceMember(...args),
}));

import { createFocusSessionRouter } from "./focus-session.js";

const ACTOR: AuthUser = {
	id: 7,
	username: "ana",
	displayName: "Ana",
	email: null,
	emailVerified: true,
	needsUsername: false,
};

function makeReadySession(
	overrides: Partial<FocusSessionRow> = {},
): FocusSessionRow {
	return {
		id: 2,
		user_id: 7,
		workspace_id: 3,
		state: "ready",
		accumulated_seconds: 0,
		running_since: null,
		version: 1,
		task_source: "board",
		task_id: 481,
		task_key: "CA-42",
		return_path: "/board/card/481",
		finished_at: null,
		created_at: FIXED_DATE,
		updated_at: FIXED_DATE,
		...overrides,
	};
}

function makeRunningSession(
	overrides: Partial<FocusSessionRow> = {},
): FocusSessionRow {
	return {
		id: 1,
		user_id: 7,
		workspace_id: 3,
		state: "running",
		accumulated_seconds: 0,
		running_since: T0,
		version: 2,
		task_source: "board",
		task_id: 481,
		task_key: "CA-42",
		return_path: "/board/card/481",
		finished_at: null,
		created_at: FIXED_DATE,
		updated_at: FIXED_DATE,
		...overrides,
	};
}

function makePausedSession(
	overrides: Partial<FocusSessionRow> = {},
): FocusSessionRow {
	return {
		id: 3,
		user_id: 7,
		workspace_id: 3,
		state: "paused",
		accumulated_seconds: 600,
		running_since: null,
		version: 3,
		task_source: "board",
		task_id: 481,
		task_key: "CA-42",
		return_path: "/board/card/481",
		finished_at: null,
		created_at: FIXED_DATE,
		updated_at: FIXED_DATE,
		...overrides,
	};
}

function createFakeRepo() {
	return {
		findActive: vi.fn().mockResolvedValue(null),
		insert: vi.fn(),
		update: vi.fn(),
		findTask: vi.fn(),
	};
}

type RouterDeps = {
	repo: ReturnType<typeof createFakeRepo>;
	now?: () => Date;
	publish?: ReturnType<typeof vi.fn>;
	recordFocusActivity?: ReturnType<typeof vi.fn>;
};

function createApp(deps: RouterDeps) {
	const publish = deps.publish ?? vi.fn();
	const recordFocusActivity = deps.recordFocusActivity ?? vi.fn();
	const router = createFocusSessionRouter({
		repo: deps.repo,
		now: deps.now ?? (() => FIXED_DATE),
		publish,
		recordFocusActivity,
	});

	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = ACTOR;
		req.workspace = { workspaceId: 3, role: "member" };
		next();
	});
	app.use("/workspaces/:workspaceId", router);
	return { app, publish, recordFocusActivity };
}

function mergeUpdateRow(
	row: FocusSessionRow,
	patch: Partial<FocusSessionRow>,
	expectedVersion: number,
): FocusSessionRow {
	return {
		...row,
		...patch,
		version: expectedVersion + 1,
	};
}

beforeEach(() => {
	mockConfig.FOCUS_MODE_ENABLED = "true";
	mockRequireWorkspaceMember.mockReset();
	mockRequireWorkspaceMember.mockImplementation(
		(_req: unknown, _res: unknown, next: () => void) => next(),
	);
});

describe("PATCH /focus-session lifecycle", () => {
	it("starts a ready session with runningSince set", async () => {
		const ready = makeReadySession();
		const running = makeRunningSession({
			id: 2,
			version: 2,
			running_since: T0,
		});
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(ready);
		repo.update.mockResolvedValue(running);
		const publish = vi.fn();
		const recordFocusActivity = vi.fn();
		const { app } = createApp({
			repo,
			now: () => T0,
			publish,
			recordFocusActivity,
		});

		const res = await request(app)
			.patch("/workspaces/3/focus-session")
			.send({ action: "start", version: 1 });

		expect(res.status).toBe(200);
		expect(res.body.session).toMatchObject({
			state: "running",
			runningSince: T0.toISOString(),
			accumulatedSeconds: 0,
		});
		expect(repo.update).toHaveBeenCalledWith(
			2,
			{
				state: "running",
				accumulated_seconds: 0,
				running_since: T0,
			},
			1,
		);
		expect(publish).toHaveBeenCalledWith(3, {
			type: "focus_session.updated",
			userId: 7,
			workspaceId: 3,
			payload: { session: res.body.session },
		});
		expect(recordFocusActivity).toHaveBeenCalledOnce();
		expect(recordFocusActivity).toHaveBeenCalledWith({
			actor: ACTOR,
			workspaceId: 3,
			sessionId: 2,
			action: "start",
		});
	});

	it("pauses a running session after 10 minutes with 600 accumulated seconds", async () => {
		const T0_PLUS_600S = new Date("2026-09-04T10:10:00.000Z");
		const clockNow = T0_PLUS_600S;
		const running = makeRunningSession({ version: 2 });
		const paused = makePausedSession({
			id: 1,
			version: 3,
			accumulated_seconds: 600,
		});
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(running);
		repo.update.mockResolvedValue(paused);
		const recordFocusActivity = vi.fn();
		const { app } = createApp({
			repo,
			now: () => clockNow,
			recordFocusActivity,
		});

		const res = await request(app)
			.patch("/workspaces/3/focus-session")
			.send({ action: "pause", version: 2 });

		expect(res.status).toBe(200);
		expect(res.body.session).toMatchObject({
			state: "paused",
			accumulatedSeconds: 600,
			runningSince: null,
		});
		expect(recordFocusActivity).toHaveBeenCalledOnce();
		expect(recordFocusActivity).toHaveBeenCalledWith({
			actor: ACTOR,
			workspaceId: 3,
			sessionId: 1,
			action: "pause",
		});
	});

	it("resumes then pauses to accrue 900 accumulated seconds", async () => {
		const T1_PLUS_300S = new Date("2026-09-04T11:05:00.000Z");
		let clockNow = T1;
		let current = makePausedSession({ version: 3 });
		const repo = createFakeRepo();
		repo.findActive.mockImplementation(async () => current);
		repo.update.mockImplementation(async (_id, patch, expectedVersion) => {
			current = mergeUpdateRow(current, patch, expectedVersion);
			return current;
		});
		const recordFocusActivity = vi.fn();
		const { app } = createApp({
			repo,
			now: () => clockNow,
			recordFocusActivity,
		});

		const resumeRes = await request(app)
			.patch("/workspaces/3/focus-session")
			.send({ action: "resume", version: 3 });

		expect(resumeRes.status).toBe(200);
		expect(resumeRes.body.session).toMatchObject({
			state: "running",
			accumulatedSeconds: 600,
			runningSince: T1.toISOString(),
		});
		expect(recordFocusActivity).toHaveBeenCalledWith({
			actor: ACTOR,
			workspaceId: 3,
			sessionId: 3,
			action: "resume",
		});

		clockNow = T1_PLUS_300S;

		const pauseRes = await request(app)
			.patch("/workspaces/3/focus-session")
			.send({ action: "pause", version: 4 });

		expect(pauseRes.status).toBe(200);
		expect(pauseRes.body.session).toMatchObject({
			state: "paused",
			accumulatedSeconds: 900,
			runningSince: null,
		});
		expect(recordFocusActivity).toHaveBeenCalledTimes(2);
		expect(recordFocusActivity).toHaveBeenLastCalledWith({
			actor: ACTOR,
			workspaceId: 3,
			sessionId: 3,
			action: "pause",
		});
	});

	it("finishes a running session without mutating the task and publishes null session", async () => {
		const T0_PLUS_120S = new Date("2026-09-04T10:02:00.000Z");
		const running = makeRunningSession({
			accumulated_seconds: 300,
			version: 5,
		});
		const finished = makeRunningSession({
			state: "finished",
			accumulated_seconds: 420,
			running_since: null,
			version: 6,
			finished_at: T0_PLUS_120S,
		});
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(running);
		repo.update.mockResolvedValue(finished);
		const publish = vi.fn();
		const recordFocusActivity = vi.fn();
		const { app } = createApp({
			repo,
			now: () => T0_PLUS_120S,
			publish,
			recordFocusActivity,
		});

		const res = await request(app)
			.patch("/workspaces/3/focus-session")
			.send({ action: "finish", version: 5 });

		expect(res.status).toBe(200);
		expect(res.body.session).toMatchObject({
			state: "finished",
			accumulatedSeconds: 420,
			returnPath: "/board/card/481",
		});
		expect(repo.update).toHaveBeenCalledWith(
			1,
			{
				state: "finished",
				accumulated_seconds: 420,
				running_since: null,
				finished_at: T0_PLUS_120S,
			},
			5,
		);
		expect(publish).toHaveBeenCalledWith(3, {
			type: "focus_session.updated",
			userId: 7,
			workspaceId: 3,
			payload: { session: null },
		});
		expect(recordFocusActivity).toHaveBeenCalledOnce();
		expect(recordFocusActivity).toHaveBeenCalledWith({
			actor: ACTOR,
			workspaceId: 3,
			sessionId: 1,
			action: "finish",
		});
		expect(repo.findTask).not.toHaveBeenCalled();
		expect(repo.insert).not.toHaveBeenCalled();
	});

	it("returns 409 version_conflict with current session when update loses version guard", async () => {
		const currentRow = makePausedSession({ version: 4 });
		const repo = createFakeRepo();
		repo.findActive
			.mockResolvedValueOnce(currentRow)
			.mockResolvedValueOnce(currentRow);
		repo.update.mockResolvedValue(null);
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app)
			.patch("/workspaces/3/focus-session")
			.send({ action: "resume", version: 3 });

		expect(res.status).toBe(409);
		expect(res.body).toEqual({
			code: "version_conflict",
			session: {
				id: 3,
				state: "paused",
				accumulatedSeconds: 600,
				runningSince: null,
				version: 4,
				source: "board",
				taskId: 481,
				taskKey: "CA-42",
				returnPath: "/board/card/481",
				finishedAt: null,
			},
		});
		expect(publish).not.toHaveBeenCalled();
	});

	it("returns 409 invalid_transition without update or publish for illegal start on running", async () => {
		const running = makeRunningSession({ version: 2 });
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(running);
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app)
			.patch("/workspaces/3/focus-session")
			.send({ action: "start", version: 2 });

		expect(res.status).toBe(409);
		expect(res.body.code).toBe("invalid_transition");
		expect(res.body.session).toMatchObject({
			state: "running",
			version: 2,
		});
		expect(repo.update).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});

	it("returns 400 for unsupported PATCH action without side effects", async () => {
		const ready = makeReadySession();
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(ready);
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app)
			.patch("/workspaces/3/focus-session")
			.send({ action: "switch", version: 1 });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "Invalid request body" });
		expect(repo.update).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});

	it("returns 404 when no active session exists", async () => {
		const repo = createFakeRepo();
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app)
			.patch("/workspaces/3/focus-session")
			.send({ action: "start", version: 1 });

		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Not found" });
		expect(repo.update).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});
});
