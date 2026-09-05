import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../auth.js";
import type { FocusSessionRow } from "./focus-session-repo.js";

const FIXED_DATE = new Date("2026-09-04T12:00:00.000Z");
const T0 = new Date("2026-09-04T10:00:00.000Z");
const T0_PLUS_60S = new Date("2026-09-04T10:01:00.000Z");

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

function makeRunningSession(
	overrides: Partial<FocusSessionRow> = {},
): FocusSessionRow {
	return {
		id: 1,
		user_id: 7,
		workspace_id: 3,
		state: "running",
		accumulated_seconds: 300,
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
		task_id: 999,
		task_key: "CA-99",
		return_path: "/board/card/999",
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
		switchSession: vi.fn(),
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

beforeEach(() => {
	mockConfig.FOCUS_MODE_ENABLED = "true";
	mockRequireWorkspaceMember.mockReset();
	mockRequireWorkspaceMember.mockImplementation(
		(_req: unknown, _res: unknown, next: () => void) => next(),
	);
});

describe("POST /focus-session switch", () => {
	it("finishes A and creates ready session on B with publish and audit", async () => {
		const active = makeRunningSession();
		const created = makeReadySession({ id: 10, version: 1 });
		const finished = makeRunningSession({
			state: "finished",
			accumulated_seconds: 360,
			running_since: null,
			version: 3,
			finished_at: T0_PLUS_60S,
		});
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(active);
		repo.findTask.mockResolvedValue({
			id: 999,
			keyNumber: 99,
			title: "Target card",
			workspaceName: "Camel Alpha",
		});
		repo.switchSession.mockResolvedValue({ finished, created });
		const publish = vi.fn();
		const recordFocusActivity = vi.fn();
		const { app } = createApp({
			repo,
			now: () => T0_PLUS_60S,
			publish,
			recordFocusActivity,
		});

		const res = await request(app).post("/workspaces/3/focus-session").send({
			action: "switch",
			source: "board",
			taskId: 999,
			version: 2,
			sessionId: 1,
		});

		expect(res.status).toBe(201);
		expect(res.body.session).toMatchObject({
			id: 10,
			state: "ready",
			accumulatedSeconds: 0,
			runningSince: null,
			version: 1,
			source: "board",
			taskId: 999,
		});
		expect(repo.switchSession).toHaveBeenCalledTimes(1);
		expect(repo.switchSession).toHaveBeenCalledWith(
			{
				id: 1,
				patch: {
					state: "finished",
					accumulated_seconds: 360,
					running_since: null,
					finished_at: T0_PLUS_60S,
				},
				expectedVersion: 2,
			},
			{
				user_id: 7,
				workspace_id: 3,
				task_source: "board",
				task_id: 999,
				task_key: "CA-99",
				return_path: "/board/card/999",
				state: "ready",
				accumulated_seconds: 0,
				running_since: null,
			},
		);
		expect(publish).toHaveBeenCalledWith(3, {
			type: "focus_session.updated",
			userId: 7,
			workspaceId: 3,
			payload: { session: res.body.session },
		});
		expect(recordFocusActivity).toHaveBeenCalledWith({
			actor: ACTOR,
			workspaceId: 3,
			sessionId: 10,
			action: "switch",
		});
	});

	it("falls back to plain focus when no active session exists", async () => {
		const inserted = makeReadySession({
			id: 11,
			version: 1,
			task_id: 77,
			task_source: "tracker",
			return_path: "/tracker/CA-42",
		});
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(null);
		repo.findTask.mockResolvedValue({
			id: 77,
			keyNumber: 42,
			title: "Tracker item",
			workspaceName: "Camel Alpha",
		});
		repo.insert.mockResolvedValue(inserted);
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "switch", source: "tracker", taskId: 77 });

		expect(res.status).toBe(201);
		expect(res.body.session).toMatchObject({
			state: "ready",
			source: "tracker",
			taskId: 77,
		});
		expect(repo.insert).toHaveBeenCalled();
		expect(repo.switchSession).not.toHaveBeenCalled();
	});

	it("returns 409 version_conflict on stale version without side effects", async () => {
		const active = makeRunningSession({ version: 4 });
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValueOnce(active).mockResolvedValueOnce(active);
		repo.findTask.mockResolvedValue({
			id: 999,
			keyNumber: 99,
			title: "Target card",
			workspaceName: "Camel Alpha",
		});
		repo.switchSession.mockResolvedValue(null);
		const publish = vi.fn();
		const recordFocusActivity = vi.fn();
		const { app } = createApp({ repo, publish, recordFocusActivity });

		const res = await request(app).post("/workspaces/3/focus-session").send({
			action: "switch",
			source: "board",
			taskId: 999,
			version: 2,
			sessionId: 1,
		});

		expect(res.status).toBe(409);
		expect(res.body.code).toBe("version_conflict");
		expect(res.body.session.taskId).toBe(481);
		expect(publish).not.toHaveBeenCalled();
		expect(recordFocusActivity).not.toHaveBeenCalled();
	});

	it("returns existing session unchanged when switching to the same task", async () => {
		const active = makeRunningSession();
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(active);
		const publish = vi.fn();
		const recordFocusActivity = vi.fn();
		const { app } = createApp({ repo, publish, recordFocusActivity });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "switch", source: "board", taskId: 481 });

		expect(res.status).toBe(201);
		expect(res.body.session).toMatchObject({
			id: 1,
			version: 2,
			state: "running",
			accumulatedSeconds: 300,
		});
		expect(repo.switchSession).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
		expect(recordFocusActivity).not.toHaveBeenCalled();
	});

	it("returns 400 when switch omits sessionId while an active session exists", async () => {
		const active = makeRunningSession();
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(active);
		repo.findTask.mockResolvedValue({
			id: 999,
			keyNumber: 99,
			title: "Target card",
			workspaceName: "Camel Alpha",
		});
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "switch", source: "board", taskId: 999, version: 2 });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "Invalid request body" });
		expect(repo.switchSession).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});

	it("returns 409 when switch sessionId does not match the active row", async () => {
		const replacement = makeReadySession({ id: 10, version: 1, task_id: 999 });
		const repo = createFakeRepo();
		repo.findActive
			.mockResolvedValueOnce(replacement)
			.mockResolvedValueOnce(replacement);
		repo.findTask.mockResolvedValue({
			id: 888,
			keyNumber: 88,
			title: "Other card",
			workspaceName: "Camel Alpha",
		});
		const publish = vi.fn();
		const recordFocusActivity = vi.fn();
		const { app } = createApp({ repo, publish, recordFocusActivity });

		const res = await request(app).post("/workspaces/3/focus-session").send({
			action: "switch",
			source: "board",
			taskId: 888,
			version: 1,
			sessionId: 1,
		});

		expect(res.status).toBe(409);
		expect(res.body.code).toBe("version_conflict");
		expect(res.body.session.id).toBe(10);
		expect(repo.switchSession).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
		expect(recordFocusActivity).not.toHaveBeenCalled();
	});

	it("returns 404 when target task does not resolve without calling switchSession", async () => {
		const active = makeRunningSession();
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(active);
		repo.findTask.mockResolvedValue(null);
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app).post("/workspaces/3/focus-session").send({
			action: "switch",
			source: "board",
			taskId: 999,
			version: 2,
			sessionId: 1,
		});

		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Not found" });
		expect(repo.switchSession).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});
});
