import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../auth.js";
import type { FocusSessionRow } from "./focus-session-repo.js";

const FIXED_DATE = new Date("2026-09-04T12:00:00.000Z");
const T0 = new Date("2026-09-04T10:00:00.000Z");
const T0_PLUS_90S = new Date("2026-09-04T10:01:30.000Z");

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
		accumulated_seconds: 1200,
		running_since: T0,
		version: 4,
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

beforeEach(() => {
	mockConfig.FOCUS_MODE_ENABLED = "true";
	mockRequireWorkspaceMember.mockReset();
	mockRequireWorkspaceMember.mockImplementation(
		(_req: unknown, _res: unknown, next: () => void) => next(),
	);
});

describe("GET /focus-session", () => {
	it("returns 200 { session: null } when no active session", async () => {
		const repo = createFakeRepo();
		const { app } = createApp({ repo });

		const res = await request(app).get("/workspaces/3/focus-session");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ session: null });
		expect(repo.findActive).toHaveBeenCalledWith(7, 3);
	});

	it("returns 404 for non-members", async () => {
		mockRequireWorkspaceMember.mockImplementation(
			(
				_req: unknown,
				res: { status: (n: number) => { json: (b: unknown) => void } },
			) => {
				res.status(404).json({ error: "Not found" });
			},
		);
		const repo = createFakeRepo();
		const { app } = createApp({ repo });

		const res = await request(app).get("/workspaces/3/focus-session");

		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Not found" });
	});

	it("returns the active session when FOCUS_MODE_ENABLED=false", async () => {
		mockConfig.FOCUS_MODE_ENABLED = "false";
		const session = makeRunningSession();
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(session);
		repo.findTask.mockResolvedValue({
			id: 481,
			keyNumber: 42,
			title: "Board card",
			workspaceName: "Camel Alpha",
		});
		const { app } = createApp({ repo });

		const res = await request(app).get("/workspaces/3/focus-session");

		expect(res.status).toBe(200);
		expect(res.body.session).toMatchObject({ id: 1, state: "running" });
	});

	it("rejects POST when FOCUS_MODE_ENABLED=false", async () => {
		mockConfig.FOCUS_MODE_ENABLED = "false";
		const repo = createFakeRepo();
		const { app } = createApp({ repo });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "focus", source: "board", taskId: 481 });

		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Not found" });
		expect(repo.findActive).not.toHaveBeenCalled();
		expect(repo.insert).not.toHaveBeenCalled();
	});

	it("returns running session DTO with stored accumulatedSeconds and runningSince", async () => {
		const session = makeRunningSession();
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(session);
		repo.findTask.mockResolvedValue({
			id: 481,
			keyNumber: 42,
			title: "Board card",
			workspaceName: "Camel Alpha",
		});
		const { app } = createApp({ repo, now: () => T0_PLUS_90S });

		const res = await request(app).get("/workspaces/3/focus-session");

		expect(res.status).toBe(200);
		expect(res.body.session).toEqual({
			id: 1,
			state: "running",
			accumulatedSeconds: 1200,
			runningSince: T0.toISOString(),
			version: 4,
			source: "board",
			taskId: 481,
			taskKey: "CA-42",
			returnPath: "/board/card/481",
			finishedAt: null,
		});
	});

	it("auto-finishes session when task no longer resolves", async () => {
		const session = makeRunningSession();
		const finishedRow = makeRunningSession({
			state: "finished",
			accumulated_seconds: 1290,
			running_since: null,
			version: 5,
			finished_at: T0_PLUS_90S,
		});
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(session);
		repo.findTask.mockResolvedValue(null);
		repo.update.mockResolvedValue(finishedRow);
		const publish = vi.fn();
		const recordFocusActivity = vi.fn();
		const { app } = createApp({
			repo,
			now: () => T0_PLUS_90S,
			publish,
			recordFocusActivity,
		});

		const res = await request(app).get("/workspaces/3/focus-session");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			session: null,
			autoFinished: { reason: "task_missing", taskKey: "CA-42" },
		});
		expect(repo.update).toHaveBeenCalledWith(
			1,
			{
				state: "finished",
				accumulated_seconds: 1290,
				running_since: null,
				finished_at: T0_PLUS_90S,
			},
			4,
		);
		expect(publish).toHaveBeenCalledWith(3, {
			type: "focus_session.updated",
			userId: 7,
			workspaceId: 3,
			payload: { session: null },
		});
		expect(recordFocusActivity).toHaveBeenCalledWith({
			actor: ACTOR,
			workspaceId: 3,
			sessionId: 1,
			action: "auto_finish",
		});
	});

	it("returns 200 { session: null } when auto-finish update loses version guard", async () => {
		const session = makeRunningSession();
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(session);
		repo.findTask.mockResolvedValue(null);
		repo.update.mockResolvedValue(null);
		const publish = vi.fn();
		const recordFocusActivity = vi.fn();
		const { app } = createApp({ repo, publish, recordFocusActivity });

		const res = await request(app).get("/workspaces/3/focus-session");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ session: null });
		expect(publish).not.toHaveBeenCalled();
		expect(recordFocusActivity).not.toHaveBeenCalled();
	});
});

describe("POST /focus-session", () => {
	it("creates ready board session with publish and audit", async () => {
		const inserted = makeReadySession({ id: 10, version: 1 });
		const repo = createFakeRepo();
		repo.findTask.mockResolvedValue({
			id: 481,
			keyNumber: 42,
			title: "Board card",
			workspaceName: "Camel Alpha",
		});
		repo.insert.mockResolvedValue(inserted);
		const publish = vi.fn();
		const recordFocusActivity = vi.fn();
		const { app } = createApp({ repo, publish, recordFocusActivity });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "focus", source: "board", taskId: 481 });

		expect(res.status).toBe(201);
		expect(res.body.session).toMatchObject({
			state: "ready",
			accumulatedSeconds: 0,
			runningSince: null,
			version: 1,
			source: "board",
			taskId: 481,
		});
		expect(repo.insert).toHaveBeenCalledWith({
			user_id: 7,
			workspace_id: 3,
			task_source: "board",
			task_id: 481,
			task_key: "CA-42",
			return_path: "/board/card/481",
			state: "ready",
			accumulated_seconds: 0,
			running_since: null,
		});
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
			action: "focus",
		});
	});

	it("creates ready tracker session with /tracker/CA-42 return path", async () => {
		const inserted = makeReadySession({
			id: 11,
			task_source: "tracker",
			task_id: 77,
			return_path: "/tracker/CA-42",
		});
		const repo = createFakeRepo();
		repo.findTask.mockResolvedValue({
			id: 77,
			keyNumber: 42,
			title: "Tracker item",
			workspaceName: "Camel Alpha",
		});
		repo.insert.mockResolvedValue(inserted);
		const { app } = createApp({ repo });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "focus", source: "tracker", taskId: 77 });

		expect(res.status).toBe(201);
		expect(res.body.session).toMatchObject({
			source: "tracker",
			taskId: 77,
			returnPath: "/tracker/CA-42",
		});
		expect(repo.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				task_source: "tracker",
				task_id: 77,
				task_key: "CA-42",
				return_path: "/tracker/CA-42",
			}),
		);
	});

	it("returns 404 when task does not resolve", async () => {
		const repo = createFakeRepo();
		repo.findTask.mockResolvedValue(null);
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "focus", source: "board", taskId: 999 });

		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Not found" });
		expect(repo.insert).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});

	it("creates new ready session after previous finished session", async () => {
		const inserted = makeReadySession({ id: 12, version: 1 });
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(null);
		repo.findTask.mockResolvedValue({
			id: 481,
			keyNumber: 42,
			title: "Board card",
			workspaceName: "Camel Alpha",
		});
		repo.insert.mockResolvedValue(inserted);
		const { app } = createApp({ repo });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "focus", source: "board", taskId: 481 });

		expect(res.status).toBe(201);
		expect(res.body.session).toMatchObject({
			state: "ready",
			accumulatedSeconds: 0,
			version: 1,
		});
		expect(repo.insert).toHaveBeenCalled();
	});

	it("returns existing session unchanged on idempotent re-focus", async () => {
		const existing = makeReadySession({
			id: 5,
			version: 2,
			accumulated_seconds: 0,
		});
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(existing);
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "focus", source: "board", taskId: 481 });

		expect(res.status).toBe(201);
		expect(res.body.session).toMatchObject({
			id: 5,
			version: 2,
			state: "ready",
			accumulatedSeconds: 0,
		});
		expect(repo.insert).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});

	it("returns 409 session_active when focusing a different task", async () => {
		const existing = makeReadySession({ task_id: 481 });
		const repo = createFakeRepo();
		repo.findActive.mockResolvedValue(existing);
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		const res = await request(app)
			.post("/workspaces/3/focus-session")
			.send({ action: "focus", source: "board", taskId: 999 });

		expect(res.status).toBe(409);
		expect(res.body.code).toBe("session_active");
		expect(res.body.session.taskId).toBe(481);
		expect(repo.insert).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});

	it("returns 400 for invalid POST body without side effects", async () => {
		const repo = createFakeRepo();
		const publish = vi.fn();
		const { app } = createApp({ repo, publish });

		for (const body of [
			{ action: "start", source: "board", taskId: 1 },
			{ action: "focus", source: "invalid", taskId: 1 },
			{ action: "focus", source: "board", taskId: "nope" },
		]) {
			const res = await request(app)
				.post("/workspaces/3/focus-session")
				.send(body);

			expect(res.status).toBe(400);
		}

		expect(repo.findTask).not.toHaveBeenCalled();
		expect(repo.insert).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});
});
