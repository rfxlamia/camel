import "dotenv/config";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateCardIdentity } from "../../core/allocate-card-identity.js";
import { seedTrackerVocabulary } from "../../core/tracker-vocabulary-seed.js";
import { db } from "../../db/kysely.js";
import { pool } from "../../db/pool.js";
import {
	LocalAttachmentStorage,
	setAttachmentStorageForTests,
} from "../../lib/attachment-storage.js";
import { createErrorHandler } from "../../middleware/error-handler.js";

const state = vi.hoisted(() => ({
	userId: 0,
	authenticated: true,
	member: true,
	spend: undefined as string | undefined,
}));
vi.mock("../../auth.js", () => ({
	requireAuth: (req: any, res: any, next: () => void) => {
		if (!state.authenticated)
			return res.status(401).json({ error: "Unauthorized" });
		req.user = { id: state.userId };
		next();
	},
}));
vi.mock("./membership.js", () => ({
	assertWorkspaceMember: async (_req: any, res: any) => {
		if (!state.member) {
			res.status(404).json({ error: "Not found" });
			return false;
		}
		return true;
	},
}));
vi.mock("../../config.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../config.js")>();
	return {
		...actual,
		config: {
			...actual.config,
			get AGENT_SPEND_KILL_SWITCH() {
				return state.spend;
			},
		},
	};
});

import { retryDeps } from "./retry-db.js";
import { createAgentRouter } from "./routes.js";
import { boardDeps } from "./service-deps-board.js";
import type { AgentBoardServiceDeps } from "./service-types.js";
import { recoverInterruptedAgentBoards } from "./startup-recovery.js";

const enabled =
	process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
describe.skipIf(!enabled)("preservation-safe retry (real PostgreSQL)", () => {
	let workspaceId: number;
	let sourceId: number;
	let cardId: number;
	let root: string;
	let pair: { thumbnailPath: string; originalPath: string };
	const args = () => ({ workspaceId, boardId: sourceId, userId: state.userId });
	const path = (boardId = sourceId, wid = workspaceId) =>
		`/workspaces/${wid}/agent/boards/${boardId}/retry`;
	const app = (overrides: Partial<AgentBoardServiceDeps> = {}) => {
		const result = express();
		result.use(express.json());
		result.use(createAgentRouter(overrides));
		result.use(createErrorHandler());
		return result;
	};
	async function snapshot(boardId = sourceId) {
		const columns = await db
			.selectFrom("columns")
			.selectAll()
			.where("board_id", "=", boardId)
			.orderBy("id")
			.execute();
		const cards = columns.length
			? await db
					.selectFrom("cards")
					.selectAll()
					.where(
						"column_id",
						"in",
						columns.map((c) => c.id),
					)
					.execute()
			: [];
		return {
			board: await db
				.selectFrom("agent_boards")
				.selectAll()
				.where("id", "=", boardId)
				.executeTakeFirstOrThrow(),
			columns,
			conversations: await db
				.selectFrom("agent_conversations")
				.selectAll()
				.where("board_id", "=", boardId)
				.orderBy("created_at")
				.orderBy("id")
				.execute(),
			outputs: await db
				.selectFrom("agent_card_outputs")
				.selectAll()
				.where("board_id", "=", boardId)
				.execute(),
			traces: await db
				.selectFrom("agent_tool_calls")
				.selectAll()
				.where("board_id", "=", boardId)
				.execute(),
			artifacts: await db
				.selectFrom("agent_artifacts")
				.selectAll()
				.where("board_id", "=", boardId)
				.execute(),
			cards,
			attachments: cards.length
				? await db
						.selectFrom("attachments")
						.selectAll()
						.where(
							"card_id",
							"in",
							cards.map((c) => c.id),
						)
						.execute()
				: [],
		};
	}
	beforeEach(async () => {
		state.authenticated = true;
		state.member = true;
		state.spend = undefined;
		const user = await db
			.insertInto("users")
			.values({
				username: `retry-${crypto.randomUUID()}`,
				display_name: "Retry",
				password_hash: "test",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		state.userId = user.id;
		const ws = await db
			.insertInto("workspaces")
			.values({
				name: "Retry tests",
				owner_user_id: user.id,
				is_personal: false,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		workspaceId = ws.id;
		await seedTrackerVocabulary(db, workspaceId);
		await db
			.insertInto("workspace_members")
			.values({ workspace_id: workspaceId, user_id: user.id, role: "owner" })
			.execute();
		const board = await db
			.insertInto("agent_boards")
			.values({
				workspace_id: workspaceId,
				user_id: user.id,
				original_intent: "Keep original intent",
				template_id: "research-report",
				status: "approved",
				execution_status: "failed",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		sourceId = board.id;
		// Deliberately insert out of execution order and copy every setting.
		const cols = await db
			.insertInto("columns")
			.values([
				{
					workspace_id: workspaceId,
					board_id: sourceId,
					title: "Write",
					slug: "write",
					position: 1.25,
					reasoning: true,
					system_prompt: "Write it",
					tools: ["web_search"],
					tool_budget: 7,
				},
				{
					workspace_id: workspaceId,
					board_id: sourceId,
					title: "Research",
					slug: "research",
					position: 0.25,
					reasoning: false,
					system_prompt: "Research it",
					tools: [],
					tool_budget: null,
				},
			])
			.returning("id")
			.execute();
		await db
			.insertInto("agent_conversations")
			.values([
				{
					board_id: sourceId,
					role: "assistant",
					content: "Second",
					created_at: new Date("2026-01-02"),
				},
				{
					board_id: sourceId,
					role: "user",
					content: "First",
					created_at: new Date("2026-01-01"),
				},
				{
					board_id: sourceId,
					role: "user",
					content: "Third",
					created_at: new Date("2026-01-02"),
				},
			])
			.execute();
		await db
			.insertInto("agent_card_outputs")
			.values({
				board_id: sourceId,
				column_slug: "research",
				output: "Precious output",
				thinking: "Thinking",
			})
			.execute();
		await db
			.insertInto("agent_tool_calls")
			.values({
				board_id: sourceId,
				column_slug: "research",
				tool_name: "web_search",
				result: "trace",
			})
			.execute();
		await db
			.insertInto("agent_artifacts")
			.values({
				board_id: sourceId,
				workspace_id: workspaceId,
				filename: "partial.md",
				content: "Partial artifact",
			})
			.execute();
		const card = await db.transaction().execute(async (trx) => {
			const identity = await allocateCardIdentity(trx, {
				workspaceId,
				columnId: cols[0].id,
			});
			return trx
				.insertInto("cards")
				.values({
					workspace_id: workspaceId,
					column_id: cols[0].id,
					title: "Human content",
					position: 0.5,
					key_number: identity.keyNumber,
					status_id: identity.statusId,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
		});
		cardId = card.id;
		root = await mkdtemp(join(tmpdir(), "camel-retry-"));
		const storage = new LocalAttachmentStorage(root);
		setAttachmentStorageForTests(storage);
		pair = await storage.writePair(
			Buffer.from("thumbnail bytes"),
			Buffer.from("original bytes"),
		);
		await db
			.insertInto("attachments")
			.values({
				card_id: cardId,
				mime_type: "image/png",
				thumbnail_path: pair.thumbnailPath,
				original_path: pair.originalPath,
				thumbnail_size_bytes: 15,
				original_size_bytes: 14,
			})
			.execute();
	});
	afterEach(async () => {
		// The owner can be changed by access tests; restore via persisted workspace owner.
		const ws = await db
			.selectFrom("workspaces")
			.select("owner_user_id")
			.where("id", "=", workspaceId)
			.executeTakeFirst();
		if (ws) {
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db.deleteFrom("users").where("id", "=", ws.owner_user_id).execute();
		}
		setAttachmentStorageForTests(null);
		if (root) await rm(root, { recursive: true, force: true });
	});
	it("preserves source/card/attachment bytes and copies only ordered intent/history/execution settings", async () => {
		const before = await snapshot();
		const result = await retryDeps.retryBoardAtomic!(args());
		expect(result).toMatchObject({ created: true });
		if (!("boardId" in result)) throw new Error("retry failed");
		const child = await snapshot(result.boardId);
		expect(await snapshot()).toEqual(before);
		expect(await readFile(join(root, pair.thumbnailPath), "utf8")).toBe(
			"thumbnail bytes",
		);
		expect(await readFile(join(root, pair.originalPath), "utf8")).toBe(
			"original bytes",
		);
		expect(child.board).toMatchObject({
			status: "approved",
			execution_status: "running",
			retry_of_board_id: sourceId,
			original_intent: before.board.original_intent,
			template_id: before.board.template_id,
		});
		const settings = (c: any) => ({
			title: c.title,
			position: c.position,
			slug: c.slug,
			reasoning: c.reasoning,
			system_prompt: c.system_prompt,
			tools: c.tools,
			tool_budget: c.tool_budget,
		});
		expect(child.columns.map(settings)).toEqual(
			[...before.columns].sort((a, b) => a.position - b.position).map(settings),
		);
		expect(
			child.conversations.map(({ role, content }) => ({ role, content })),
		).toEqual(
			before.conversations.map(({ role, content }) => ({ role, content })),
		);
		expect(child.outputs).toEqual([]);
		expect(child.traces).toEqual([]);
		expect(child.artifacts).toEqual([]);
		expect(child.cards).toEqual([]);
		expect(child.attachments).toEqual([]);
		expect(await boardDeps.getBoard!(result.boardId)).toMatchObject({
			retryOfBoardId: sourceId,
		});
		expect(await boardDeps.listBoards!(workspaceId)).toContainEqual(
			expect.objectContaining({ id: result.boardId, retryOfBoardId: sourceId }),
		);
		const detail = await request(app()).get(
			`/workspaces/${workspaceId}/agent/boards/${result.boardId}`,
		);
		expect(detail.status).toBe(200);
		expect(detail.body.retryOfBoardId).toBe(sourceId);
	});
	it("concurrent POSTs return one direct child and start pipeline exactly once; replay is read-only with spend disabled", async () => {
		// Pipeline entry is counted without calling an LLM or writing results.
		const starts = vi.fn(async () => null);
		const server = app({ getBoard: starts });
		const responses = await Promise.all(
			Array.from({ length: 8 }, () => request(server).post(path())),
		);
		expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
		const ids = new Set(responses.map((r) => r.body.boardId));
		expect(ids.size).toBe(1);
		await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1));
		const boardId = responses[0].body.boardId;
		const before = await snapshot(boardId);
		const sourceBefore = await snapshot();
		state.spend = "true";
		const replay = await request(server).post(path());
		expect(replay.body).toEqual({ boardId });
		expect(replay.status).toBe(200);
		expect(starts).toHaveBeenCalledTimes(1);
		expect(await snapshot(boardId)).toEqual(before);
		expect(await snapshot()).toEqual(sourceBefore);
		const children = await db
			.selectFrom("agent_boards")
			.select("id")
			.where("retry_of_board_id", "=", sourceId)
			.execute();
		expect(children).toHaveLength(1);
	});
	it("retries a failed child into a chain while original replay returns its direct child", async () => {
		const first = await retryDeps.retryBoardAtomic!(args());
		if (!("boardId" in first)) throw new Error("failed");
		await db
			.updateTable("agent_boards")
			.set({ execution_status: "failed" })
			.where("id", "=", first.boardId)
			.execute();
		const next = await retryDeps.retryBoardAtomic!({
			...args(),
			boardId: first.boardId,
		});
		expect(next).toMatchObject({ created: true });
		if (!("boardId" in next)) throw new Error("failed");
		expect(next.boardId).not.toBe(first.boardId);
		expect(await boardDeps.getBoard!(next.boardId)).toMatchObject({
			retryOfBoardId: first.boardId,
		});
		expect(await retryDeps.retryBoardAtomic!(args())).toEqual({
			boardId: first.boardId,
			created: false,
		});
	});
	it.each([
		"pending",
		"running",
		"done",
		"idle",
	])("rejects invalid source state %s before writing", async (stateName) => {
		await db
			.updateTable("agent_boards")
			.set(
				stateName === "pending"
					? { status: "pending" }
					: { execution_status: stateName },
			)
			.where("id", "=", sourceId)
			.execute();
		const before = await snapshot();
		const response = await request(app()).post(path());
		expect(response.status).toBe(409);
		expect(await snapshot()).toEqual(before);
	});
	it.each([
		"zero",
		"slug",
		"prompt",
		"position",
		"duplicate",
		"budget",
	])("rejects invalid %s configuration without a child", async (kind) => {
		if (kind === "zero")
			await db.deleteFrom("columns").where("board_id", "=", sourceId).execute();
		else
			await db
				.updateTable("columns")
				.set(
					kind === "slug"
						? { slug: "" }
						: kind === "prompt"
							? { system_prompt: null }
							: kind === "position"
								? { position: Infinity }
								: kind === "duplicate"
									? { slug: "duplicate" }
									: { tool_budget: -1 },
				)
				.where("board_id", "=", sourceId)
				.execute();
		const response = await request(app()).post(path());
		expect(response.status).toBe(409);
		expect(
			await db
				.selectFrom("agent_boards")
				.select("id")
				.where("retry_of_board_id", "=", sourceId)
				.execute(),
		).toEqual([]);
	});
	it("enforces authentication, membership, workspace, and ownership before existing-child disclosure", async () => {
		await retryDeps.retryBoardAtomic!(args());
		state.spend = "true";
		state.authenticated = false;
		expect((await request(app()).post(path())).status).toBe(401);
		state.authenticated = true;
		state.member = false;
		expect((await request(app()).post(path())).status).toBe(404);
		state.member = true;
		expect(
			(await request(app()).post(path(sourceId, workspaceId + 100000))).status,
		).toBe(404);
		state.userId += 100000;
		expect((await request(app()).post(path())).status).toBe(403);
		expect((await request(app()).post(path(sourceId + 100000))).status).toBe(
			404,
		);
	});
	it("denied spend creates nothing and preserves the failed source", async () => {
		const before = await snapshot();
		state.spend = "true";
		const response = await request(app()).post(path());
		expect(response.status).toBe(503);
		expect(response.body.code).toBe("AGENT_SPEND_KILL_SWITCH");
		expect(await snapshot()).toEqual(before);
		expect(
			await db
				.selectFrom("agent_boards")
				.select("id")
				.where("retry_of_board_id", "=", sourceId)
				.execute(),
		).toEqual([]);
	});
	it("rolls back board/columns when conversation copy fails, preserves source, and does not launch", async () => {
		const before = await snapshot();
		const starts = vi.fn(async () => null);
		// Trigger only rejects inserts for this source's child, never source data.
		await pool.query(
			`CREATE FUNCTION retry_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM agent_boards WHERE id = NEW.board_id AND retry_of_board_id = ${sourceId}) THEN RAISE EXCEPTION 'copy rejected'; END IF; RETURN NEW; END $$`,
		);
		await pool.query(
			"CREATE TRIGGER retry_test_reject BEFORE INSERT ON agent_conversations FOR EACH ROW EXECUTE FUNCTION retry_test_reject()",
		);
		try {
			expect(
				(await request(app({ getBoard: starts })).post(path())).status,
			).toBe(500);
			expect(starts).not.toHaveBeenCalled();
			expect(await snapshot()).toEqual(before);
			expect(
				await db
					.selectFrom("agent_boards")
					.select("id")
					.where("retry_of_board_id", "=", sourceId)
					.execute(),
			).toEqual([]);
		} finally {
			await pool.query(
				"DROP TRIGGER retry_test_reject ON agent_conversations; DROP FUNCTION retry_test_reject()",
			);
		}
	});
	it.each([
		"pre-handler",
		"spend",
		"done",
	])("catches launch rejection (%s), conditionally fails and emits terminal event", async (mode) => {
		const publishEvent = vi.fn(async () => {});
		const getColumns = vi.fn(async (boardId: number) => {
			if (mode === "done")
				await db
					.updateTable("agent_boards")
					.set({ execution_status: "done" })
					.where("id", "=", boardId)
					.execute();
			throw new Error("pre-handler failure");
		});
		const atomic = async (
			data: Parameters<
				NonNullable<AgentBoardServiceDeps["retryBoardAtomic"]>
			>[0],
		) => {
			const result = await retryDeps.retryBoardAtomic!(data);
			if (mode === "spend") state.spend = "true";
			return result;
		};
		const response = await request(
			app({ retryBoardAtomic: atomic, getColumns, publishEvent }),
		).post(path());
		expect(response.status).toBe(200);
		await vi.waitFor(async () =>
			expect(await boardDeps.getBoard!(response.body.boardId)).toMatchObject({
				executionStatus: mode === "done" ? "done" : "failed",
			}),
		);
		if (mode === "done") expect(publishEvent).not.toHaveBeenCalled();
		else
			await vi.waitFor(() =>
				expect(publishEvent).toHaveBeenCalledWith(workspaceId, {
					type: "agent.board.failed",
					boardId: response.body.boardId,
				}),
			);
		if (mode === "spend") expect(getColumns).not.toHaveBeenCalled();
	});
	it("startup recovers only running boards, preserves results, and recovers a committed unlaunched retry", async () => {
		const before = await snapshot();
		const child = await retryDeps.retryBoardAtomic!(args());
		if (!("boardId" in child)) throw new Error("failed");
		const ids: Record<string, number> = {};
		for (const execution_status of ["idle", "done", "failed", "running"]) {
			const b = await db
				.insertInto("agent_boards")
				.values({
					workspace_id: workspaceId,
					user_id: state.userId,
					original_intent: "recovery",
					execution_status,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			ids[execution_status] = b.id;
			await db
				.insertInto("agent_card_outputs")
				.values({ board_id: b.id, column_slug: "partial", output: "retained" })
				.execute();
		}
		const nonRunning = await Promise.all(
			["idle", "done", "failed"].map((s) => snapshot(ids[s])),
		);
		const recovered = await recoverInterruptedAgentBoards();
		expect(recovered).toContainEqual({ boardId: child.boardId, workspaceId });
		expect(recovered).toContainEqual({ boardId: ids.running, workspaceId });
		for (const s of ["idle", "done", "failed"])
			expect(recovered.some((r) => r.boardId === ids[s])).toBe(false);
		expect(
			await Promise.all(
				["idle", "done", "failed"].map((s) => snapshot(ids[s])),
			),
		).toEqual(nonRunning);
		expect((await snapshot(ids.running)).outputs[0].output).toBe("retained");
		expect(await snapshot()).toEqual(before);
		expect(await recoverInterruptedAgentBoards()).toEqual([]);
	});
});
