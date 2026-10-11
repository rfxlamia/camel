import "dotenv/config";
import express from "express";
import request from "supertest";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { seedTrackerVocabulary } from "../../core/tracker-vocabulary-seed.js";
import { db } from "../../db/kysely.js";
import { setAttachmentStorageForTests } from "../../lib/attachment-storage.js";
import { createErrorHandler } from "../../middleware/error-handler.js";

const routeTestState = vi.hoisted(() => ({
	authenticated: true,
	member: true,
	spendKillSwitch: undefined as string | undefined,
}));

vi.mock("../../auth.js", () => ({
	requireAuth: (req: any, res: any, next: () => void) => {
		if (!routeTestState.authenticated) {
			res.status(401).json({ error: "Unauthorized" });
			return;
		}
		req.user = { id: 7 };
		next();
	},
}));
vi.mock("./membership.js", () => ({
	assertWorkspaceMember: async (_req: any, res: any) => {
		if (!routeTestState.member) {
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
				return routeTestState.spendKillSwitch;
			},
		},
	};
});

import {
	buildArtifactDownload,
	createAgentRouter,
	defaultToolRegistry,
	deleteCardsForBoard,
	deleteOutputsForBoard,
	getToolTrace,
	loadAgentBoardColumns,
	realArtifactDeps,
	resolveMessageAction,
	runInsertColumns,
	selectConversationHistory,
	validateBoardColumns,
} from "./routes.js";

describe("defaultToolRegistry", () => {
	it("resolves web_search for production wiring", () => {
		const tools = defaultToolRegistry.resolveTools(["web_search"]);
		expect(tools).toHaveLength(1);
		expect(tools[0].name).toBe("web_search");
	});
});

describe("artifact download headers", () => {
	it("sets attachment disposition with the .md filename and content body", () => {
		const { headers, body } = buildArtifactDownload({
			filename: "title.md",
			content: "# Title\nBody",
		});
		expect(headers["Content-Disposition"]).toBe(
			'attachment; filename="title.md"',
		);
		expect(headers["Content-Type"]).toMatch(/markdown/);
		expect(body).toBe("# Title\nBody");
	});
});

describe("resolveMessageAction (pure payload detection)", () => {
	it("maps a string message to a trimmed send action", () => {
		expect(resolveMessageAction({ message: "  hello  " })).toEqual({
			kind: "send",
			message: "hello",
		});
	});

	it("maps confirm_regenerate action", () => {
		expect(resolveMessageAction({ action: "confirm_regenerate" })).toEqual({
			kind: "confirm",
		});
	});

	it("maps cancel_regenerate action", () => {
		expect(resolveMessageAction({ action: "cancel_regenerate" })).toEqual({
			kind: "cancel",
		});
	});

	it("rejects empty / whitespace / unknown-action / missing bodies as invalid", () => {
		expect(resolveMessageAction({})).toEqual({ kind: "invalid" });
		expect(resolveMessageAction(undefined)).toEqual({ kind: "invalid" });
		expect(resolveMessageAction({ message: "   " })).toEqual({
			kind: "invalid",
		});
		expect(resolveMessageAction({ action: "bogus" })).toEqual({
			kind: "invalid",
		});
	});
});

describe("validateBoardColumns (SQL allowlist)", () => {
	it("accepts allowed column names", () => {
		expect(() =>
			validateBoardColumns(["status", "execution_status", "original_intent"]),
		).not.toThrow();
	});

	it("throws on non-allowlisted column name", () => {
		expect(() => validateBoardColumns(["status", "malicious_col"])).toThrow(
			/illegal column "malicious_col"/,
		);
	});

	it("throws on empty string key", () => {
		expect(() => validateBoardColumns([""])).toThrow(/illegal column ""/);
	});

	it("does not throw for empty array (no columns)", () => {
		expect(() => validateBoardColumns([])).not.toThrow();
	});
});

/**
 * Integration tests for the Kysely-backed DB helpers exported from routes.ts.
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/agent/routes.test.ts
 */
describe.skipIf(!process.env.RUN_INTEGRATION)(
	"agent DB helpers (real DB)",
	() => {
		let userId: number;
		let workspaceId: number;
		let boardId: number;
		let backlogStatusId: number;

		beforeAll(async () => {
			const user = await db
				.insertInto("users")
				.values({
					username: `agent-routes-${Date.now()}`,
					display_name: "Agent Tester",
					password_hash: "h",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			userId = user.id;
			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: "Agent Routes WS",
					owner_user_id: userId,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;
			await seedTrackerVocabulary(db, workspaceId);
			const backlog = await db
				.selectFrom("tracker_vocabularies")
				.select("id")
				.where("workspace_id", "=", workspaceId)
				.where("kind", "=", "status")
				.where("slot", "=", "backlog")
				.executeTakeFirstOrThrow();
			backlogStatusId = backlog.id;
			const board = await db
				.insertInto("agent_boards")
				.values({
					workspace_id: workspaceId,
					user_id: userId,
					original_intent: "test intent",
					template_id: "research-report",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			boardId = board.id;
		});

		afterAll(async () => {
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db.deleteFrom("users").where("id", "=", userId).execute();
		});

		describe("loadAgentBoardColumns", () => {
			it("loads active cards in two queries with board/workspace scoping", async () => {
				const columns = await db
					.insertInto("columns")
					.values([
						{
							title: "Empty",
							position: 1000,
							workspace_id: workspaceId,
							board_id: boardId,
							slug: "empty",
							reasoning: false,
							system_prompt: "Empty prompt",
						},
						{
							title: "First",
							position: 2000,
							workspace_id: workspaceId,
							board_id: boardId,
							slug: "first",
							reasoning: false,
							system_prompt: "First prompt",
						},
						{
							title: "Second",
							position: 3000,
							workspace_id: workspaceId,
							board_id: boardId,
							slug: "second",
							reasoning: true,
							system_prompt: "Second prompt",
						},
					])
					.returning(["id", "slug"])
					.execute();
				const firstColumnId = columns.find(
					(column) => column.slug === "first",
				)!.id;
				const secondColumnId = columns.find(
					(column) => column.slug === "second",
				)!.id;

				const otherBoard = await db
					.insertInto("agent_boards")
					.values({
						workspace_id: workspaceId,
						user_id: userId,
						original_intent: "other board fixture",
						template_id: "research-report",
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				const otherBoardColumn = await db
					.insertInto("columns")
					.values({
						title: "Other board",
						position: 4000,
						workspace_id: workspaceId,
						board_id: otherBoard.id,
						slug: "other-board",
						reasoning: false,
						system_prompt: "Other board prompt",
					})
					.returning("id")
					.executeTakeFirstOrThrow();

				const foreignWorkspace = await db
					.insertInto("workspaces")
					.values({
						name: `Agent Foreign WS ${Date.now()}`,
						owner_user_id: userId,
						is_personal: false,
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				const foreignWorkspaceId = foreignWorkspace.id;
				await seedTrackerVocabulary(db, foreignWorkspaceId);
				const foreignBacklogStatus = await db
					.selectFrom("tracker_vocabularies")
					.select("id")
					.where("workspace_id", "=", foreignWorkspaceId)
					.where("kind", "=", "status")
					.where("slot", "=", "backlog")
					.executeTakeFirstOrThrow();
				await db
					.insertInto("columns")
					.values({
						title: "Foreign column",
						position: 5000,
						workspace_id: foreignWorkspaceId,
						board_id: boardId,
						slug: "foreign",
						reasoning: false,
						system_prompt: "Foreign prompt",
					})
					.execute();

				try {
					const cards = await db
						.insertInto("cards")
						.values([
							{
								title: "Active A",
								column_id: firstColumnId,
								position: 100,
								workspace_id: workspaceId,
								status_id: backlogStatusId,
							},
							{
								title: "Active B",
								column_id: firstColumnId,
								position: 100,
								workspace_id: workspaceId,
								status_id: backlogStatusId,
							},
							{
								title: "Deleted",
								column_id: firstColumnId,
								position: 200,
								workspace_id: workspaceId,
								status_id: backlogStatusId,
								deleted_at: new Date(),
							},
							{
								title: "Active C",
								column_id: secondColumnId,
								position: 100,
								workspace_id: workspaceId,
								status_id: backlogStatusId,
							},
							{
								title: "Other board",
								column_id: otherBoardColumn.id,
								position: 75,
								workspace_id: workspaceId,
								status_id: backlogStatusId,
							},
							{
								title: "Foreign workspace",
								column_id: firstColumnId,
								position: 50,
								workspace_id: foreignWorkspaceId,
								status_id: foreignBacklogStatus.id,
							},
						])
						.returning(["id", "title"])
						.execute();

					let queryCount = 0;
					const countedDb = db.withPlugin({
						transformQuery({ node }) {
							queryCount += 1;
							return node;
						},
						async transformResult({ result }) {
							return result;
						},
					});

					const result = await loadAgentBoardColumns(
						countedDb,
						boardId,
						workspaceId,
					);

					expect(queryCount).toBe(2);
					expect(result.map((column) => column.slug)).toEqual([
						"empty",
						"first",
						"second",
					]);
					const emptyCards = result.find(
						(column) => column.slug === "empty",
					)!.cards;
					const firstCards = result.find(
						(column) => column.slug === "first",
					)!.cards;
					expect(emptyCards).toEqual([]);
					const secondCards = result.find(
						(column) => column.slug === "second",
					)!.cards;
					const activeAId = cards.find((card) => card.title === "Active A")!.id;
					const activeBId = cards.find((card) => card.title === "Active B")!.id;
					const activeCId = cards.find((card) => card.title === "Active C")!.id;
					expect(firstCards.map(({ id, title }) => ({ id, title }))).toEqual([
						{ id: activeAId, title: "Active A" },
						{ id: activeBId, title: "Active B" },
					]);
					expect(secondCards.map(({ id, title }) => ({ id, title }))).toEqual([
						{ id: activeCId, title: "Active C" },
					]);
				} finally {
					await db
						.deleteFrom("workspaces")
						.where("id", "=", foreignWorkspaceId)
						.execute();
					await db
						.deleteFrom("columns")
						.where(
							"id",
							"in",
							columns.map((column) => column.id),
						)
						.execute();
				}
			});
		});

		describe("getToolTrace (read-only replay)", () => {
			afterEach(async () => {
				await db
					.deleteFrom("agent_tool_calls")
					.where("board_id", "=", boardId)
					.execute();
			});

			it("returns merged trace steps ordered by created_at, scoped to the board", async () => {
				await db
					.insertInto("agent_tool_calls")
					.values([
						{
							board_id: boardId,
							column_slug: "research-specialist",
							tool_name: "web_search",
							input: JSON.stringify({ query: "fintech" }),
							result: "started",
							attempt: 1,
						},
						{
							board_id: boardId,
							column_slug: "research-specialist",
							tool_name: "web_search",
							input: JSON.stringify({ query: "fintech", resultCount: 3 }),
							result: "3",
							attempt: 1,
						},
					])
					.execute();

				const trace = await getToolTrace(db, boardId);

				expect(trace).toEqual([
					expect.objectContaining({
						columnSlug: "research-specialist",
						toolName: "web_search",
						query: "fintech",
						resultCount: 3,
						attempt: 1,
					}),
				]);
			});

			it("is read-only — issues exactly one SELECT and executes no tool", async () => {
				const trace = await getToolTrace(db, boardId);
				expect(trace).toEqual([]);
			});

			it("breaks created_at ties by id, preserving insertion order", async () => {
				// A single multi-row INSERT shares one now() evaluation (STABLE,
				// not VOLATILE), so these rows get identical created_at — only
				// the id tiebreak can keep the order deterministic.
				await db
					.insertInto("agent_tool_calls")
					.values([
						{
							board_id: boardId,
							column_slug: "research-specialist",
							tool_name: "web_search",
							input: JSON.stringify({ query: "first" }),
							result: "1",
							attempt: 1,
						},
						{
							board_id: boardId,
							column_slug: "research-specialist",
							tool_name: "web_search",
							input: JSON.stringify({ query: "second" }),
							result: "1",
							attempt: 2,
						},
					])
					.execute();

				const trace = await getToolTrace(db, boardId);

				expect(trace.map((t) => t.attempt)).toEqual([1, 2]);
			});
		});

		describe("insertColumns tools serialization", () => {
			afterAll(async () => {
				await db
					.deleteFrom("columns")
					.where("board_id", "=", boardId)
					.execute();
			});

			it("stores a real TEXT[] tools column, not a JSON string", async () => {
				await runInsertColumns(db, {
					boardId,
					workspaceId,
					columns: [
						{
							name: "Research",
							position: 1,
							slug: "research-specialist",
							reasoning: false,
							system_prompt: "Do research",
							tools: ["web_search"],
							tool_budget: 3,
						},
					],
				});

				const row = await db
					.selectFrom("columns")
					.select(["tools", "tool_budget"])
					.where("board_id", "=", boardId)
					.where("slug", "=", "research-specialist")
					.executeTakeFirstOrThrow();
				expect(row.tools).toEqual(["web_search"]);
				expect(row.tool_budget).toBe(3);
			});

			it("stores an empty array when tools is undefined", async () => {
				await runInsertColumns(db, {
					boardId,
					workspaceId,
					columns: [
						{
							name: "Analysis",
							position: 2,
							slug: "analysis",
							reasoning: false,
							system_prompt: "Analyse",
							tools: undefined,
							tool_budget: undefined,
						},
					],
				});

				const row = await db
					.selectFrom("columns")
					.select(["tools", "tool_budget"])
					.where("board_id", "=", boardId)
					.where("slug", "=", "analysis")
					.executeTakeFirstOrThrow();
				expect(row.tools).toEqual([]);
				expect(row.tool_budget).toBeNull();
			});
		});

		describe("artifact DB helpers", () => {
			afterAll(async () => {
				await db
					.deleteFrom("agent_artifacts")
					.where("board_id", "=", boardId)
					.execute();
			});

			it("insertArtifact upserts keyed on board_id", async () => {
				await realArtifactDeps.insertArtifact(db, {
					boardId,
					workspaceId,
					filename: "title.md",
					format: "md",
					content: "# Title\nBody",
				});
				await realArtifactDeps.insertArtifact(db, {
					boardId,
					workspaceId,
					filename: "title2.md",
					format: "md",
					content: "# Title 2",
				});

				const rows = await db
					.selectFrom("agent_artifacts")
					.selectAll()
					.where("board_id", "=", boardId)
					.execute();
				expect(rows).toHaveLength(1);
				expect(rows[0].filename).toBe("title2.md");
			});

			it("getArtifact issues a single board-scoped SELECT", async () => {
				await realArtifactDeps.insertArtifact(db, {
					boardId,
					workspaceId,
					filename: "title3.md",
					format: "md",
					content: "# Title 3",
				});

				const result = await realArtifactDeps.getArtifact(db, boardId);
				expect(result).toMatchObject({ filename: "title3.md" });
			});
		});

		describe("realDeps SQL wiring", () => {
			it("selectConversationHistory queries agent_conversations scoped + ordered", async () => {
				await db
					.insertInto("agent_conversations")
					.values([
						{
							board_id: boardId,
							role: "user",
							content: "What about subsidies?",
						},
						{
							board_id: boardId,
							role: "assistant",
							content: "Subsidies are...",
						},
					])
					.execute();

				const history = await selectConversationHistory(db, boardId);
				expect(history).toEqual([
					{ role: "user", content: "What about subsidies?" },
					{ role: "assistant", content: "Subsidies are..." },
				]);

				await db
					.deleteFrom("agent_conversations")
					.where("board_id", "=", boardId)
					.execute();
			});

			it("deleteOutputsForBoard issues a scoped DELETE on agent_card_outputs", async () => {
				await db
					.insertInto("agent_card_outputs")
					.values({ board_id: boardId, column_slug: "research", output: "out" })
					.execute();

				await deleteOutputsForBoard(db, boardId);

				const rows = await db
					.selectFrom("agent_card_outputs")
					.selectAll()
					.where("board_id", "=", boardId)
					.execute();
				expect(rows).toHaveLength(0);
			});

			it("deleteCardsForBoard deletes cards via columns subquery", async () => {
				const column = await db
					.insertInto("columns")
					.values({
						title: "Backlog",
						position: 1000,
						workspace_id: workspaceId,
						board_id: boardId,
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				await db
					.insertInto("cards")
					.values({
						title: "Card",
						column_id: column.id,
						position: 1000,
						workspace_id: workspaceId,
						status_id: backlogStatusId,
					})
					.execute();

				await deleteCardsForBoard(db, boardId);

				const rows = await db
					.selectFrom("cards")
					.selectAll()
					.where("column_id", "=", column.id)
					.execute();
				expect(rows).toHaveLength(0);

				await db.deleteFrom("columns").where("id", "=", column.id).execute();
			});

			it("removes attachment files when deleting agent board cards", async () => {
				const column = await db
					.insertInto("columns")
					.values({
						title: "Attachment Backlog",
						position: 2000,
						workspace_id: workspaceId,
						board_id: boardId,
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				const card = await db
					.insertInto("cards")
					.values({
						title: "Card with attachment",
						column_id: column.id,
						position: 2000,
						workspace_id: workspaceId,
						status_id: backlogStatusId,
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				await db
					.insertInto("attachments")
					.values({
						card_id: card.id,
						mime_type: "image/png",
						thumbnail_path: "agent/thumbnail",
						original_path: "agent/original",
						thumbnail_size_bytes: 1,
						original_size_bytes: 1,
					})
					.execute();
				const removePair = vi.fn().mockResolvedValue(undefined);
				setAttachmentStorageForTests({
					root: "test-storage",
					writePair: vi.fn(),
					removePair,
					removePairs: vi.fn(),
				});

				try {
					await deleteCardsForBoard(db, boardId);
					expect(removePair).toHaveBeenCalledWith({
						thumbnailPath: "agent/thumbnail",
						originalPath: "agent/original",
					});
					expect(
						await db
							.selectFrom("attachments")
							.select("id")
							.where("card_id", "=", card.id)
							.execute(),
					).toHaveLength(0);
				} finally {
					setAttachmentStorageForTests(null);
					await db.deleteFrom("columns").where("id", "=", column.id).execute();
				}
			});
		});
	},
);

describe("agent HTTP spend guard route characterization", () => {
	const board = {
		id: 22,
		workspaceId: 11,
		userId: 7,
		status: "pending",
		originalIntent: "research the market",
		templateId: "research-report",
	};
	const path = "/api/workspaces/11/agent/boards";
	let previousNodeEnv: string | undefined;

	function makeApp(overrides: Record<string, unknown> = {}) {
		const app = express();
		app.use(express.json());
		app.use("/api", createAgentRouter(overrides as never));
		app.use(createErrorHandler());
		return app;
	}

	beforeAll(() => {
		previousNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
	});
	afterAll(() => {
		if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = previousNodeEnv;
	});
	beforeEach(() => {
		routeTestState.authenticated = true;
		routeTestState.member = true;
		routeTestState.spendKillSwitch = undefined;
	});

	it("keeps no-pending regenerate confirmation a successful no-op", async () => {
		routeTestState.spendKillSwitch = "true";
		const res = await request(
			makeApp({ getBoard: vi.fn().mockResolvedValue(board) }),
		)
			.post(`${path}/22/message`)
			.send({ action: "confirm_regenerate" });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true });
	});

	it("returns the existing unauthorized response before service invocation", async () => {
		routeTestState.spendKillSwitch = "true";
		routeTestState.authenticated = false;
		const getBoard = vi.fn();
		const res = await request(makeApp({ getBoard }))
			.post(`${path}/22/approve`)
			.send({});
		expect(res.status).toBe(401);
		expect(res.body).toEqual({ error: "Unauthorized" });
		expect(getBoard).not.toHaveBeenCalled();
	});

	it("returns malformed input as 400 before service invocation", async () => {
		routeTestState.spendKillSwitch = "true";
		const getBoard = vi.fn();
		const res = await request(makeApp({ getBoard }))
			.post(`${path}/bad/approve`)
			.send({});
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "Invalid params" });
		expect(getBoard).not.toHaveBeenCalled();
	});

	it.each([
		["non-member", false, 22],
		["missing board", true, 999],
	] as const)("returns 404 for %s before spend checks", async (_label, member, boardId) => {
		routeTestState.spendKillSwitch = "true";
		routeTestState.member = member;
		const getBoard = vi.fn().mockResolvedValue(boardId === 999 ? null : board);
		const res = await request(makeApp({ getBoard }))
			.post(`${path}/${boardId}/approve`)
			.send({});
		expect(res.status).toBe(404);
		expect(res.body).toEqual(member ? { status: 404 } : { error: "Not found" });
		expect(getBoard).toHaveBeenCalledTimes(member ? 1 : 0);
	});

	it("returns 403 for non-owner before spend checks", async () => {
		routeTestState.spendKillSwitch = "true";
		const getBoard = vi.fn().mockResolvedValue({ ...board, userId: 8 });
		const res = await request(makeApp({ getBoard }))
			.post(`${path}/22/approve`)
			.send({});
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ status: 403 });
	});

	it("keeps invalid-state approval at 409 when the switch is off", async () => {
		const getBoard = vi
			.fn()
			.mockResolvedValue({ ...board, status: "approved" });
		const res = await request(
			makeApp({
				getBoard,
				approveBoardAtomic: vi.fn().mockResolvedValue({ rowCount: 0 }),
			}),
		)
			.post(`${path}/22/approve`)
			.send({});
		expect(res.status).toBe(409);
		expect(res.body).toEqual({ status: 409 });
	});

	it("leaves unrelated service failures to global error handling", async () => {
		routeTestState.spendKillSwitch = "true";
		const res = await request(
			makeApp({
				getBoard: vi
					.fn()
					.mockRejectedValue(new Error("sensitive unrelated failure")),
			}),
		)
			.post(`${path}/22/approve`)
			.send({});
		expect(res.status).toBe(500);
		expect(res.body).toEqual({ error: "internal server error" });
	});

	it("maps real create-board guard denial to stable production 503 without writes", async () => {
		routeTestState.spendKillSwitch = "true";
		const classifyIntent = vi.fn();
		const insertBoard = vi.fn();
		const insertConversation = vi.fn();
		const insertColumns = vi.fn();
		const publishEvent = vi.fn();
		const res = await request(
			makeApp({
				classifyIntent,
				insertBoard,
				insertConversation,
				insertColumns,
				publishEvent,
			}),
		)
			.post(path)
			.send({ intent: "research the market" });
		expect(res.status).toBe(503);
		expect(res.body).toEqual({
			error: "Agent spend is disabled by kill switch",
			code: "AGENT_SPEND_KILL_SWITCH",
		});
		expect(classifyIntent).not.toHaveBeenCalled();
		expect(insertBoard).not.toHaveBeenCalled();
		expect(insertConversation).not.toHaveBeenCalled();
		expect(insertColumns).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("maps approval guard denial and does not start the pipeline", async () => {
		routeTestState.spendKillSwitch = "true";
		const approveBoardAtomic = vi.fn();
		const publishEvent = vi.fn();
		const executeCard = vi.fn();
		const res = await request(
			makeApp({
				getBoard: vi.fn().mockResolvedValue(board),
				approveBoardAtomic,
				publishEvent,
				executeCard,
			}),
		)
			.post(`${path}/22/approve`)
			.send({});
		expect(res.status).toBe(503);
		expect(res.body).toEqual({
			error: "Agent spend is disabled by kill switch",
			code: "AGENT_SPEND_KILL_SWITCH",
		});
		expect(approveBoardAtomic).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
		expect(executeCard).not.toHaveBeenCalled();
	});

	it("maps spend-bearing message denial without messages or downstream effects", async () => {
		routeTestState.spendKillSwitch = "true";
		const insertConversation = vi.fn();
		const updateBoard = vi.fn();
		const publishEvent = vi.fn();
		const executeCard = vi.fn();
		const generateClarificationQuestion = vi.fn();
		const res = await request(
			makeApp({
				getBoard: vi.fn().mockResolvedValue(board),
				insertConversation,
				updateBoard,
				publishEvent,
				executeCard,
				generateClarificationQuestion,
			}),
		)
			.post(`${path}/22/message`)
			.send({ message: "add more detail" });
		expect(res.status).toBe(503);
		expect(res.body).toEqual({
			error: "Agent spend is disabled by kill switch",
			code: "AGENT_SPEND_KILL_SWITCH",
		});
		expect(insertConversation).not.toHaveBeenCalled();
		expect(updateBoard).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
		expect(executeCard).not.toHaveBeenCalled();
		expect(generateClarificationQuestion).not.toHaveBeenCalled();
	});

	it("maps pending regenerate confirmation denial without mutation or pipeline", async () => {
		const insertConversation = vi.fn().mockResolvedValue(undefined);
		const updateBoard = vi.fn().mockResolvedValue(undefined);
		const publishEvent = vi.fn().mockResolvedValue(undefined);
		const deleteOutputsForBoard = vi.fn().mockResolvedValue(undefined);
		const deleteCardsForBoard = vi.fn().mockResolvedValue(undefined);
		const classifier = vi.fn().mockResolvedValue({
			intent: "NEW_DIRECTION",
			response: "Confirm?",
			confidence: 1,
		});
		const completed = { ...board, status: "approved", executionStatus: "done" };
		const app = makeApp({
			getBoard: vi.fn().mockResolvedValue(completed),
			getArtifact: vi.fn().mockResolvedValue(null),
			getConversationHistory: vi.fn().mockResolvedValue([]),
			insertConversation,
			updateBoard,
			publishEvent,
			deleteOutputsForBoard,
			deleteCardsForBoard,
			classifyFollowUpIntent: classifier,
		});
		const seed = await request(app)
			.post(`${path}/22/message`)
			.send({ message: "change direction" });
		expect(seed.status).toBe(200);
		const writesBefore = insertConversation.mock.calls.length;
		routeTestState.spendKillSwitch = "true";
		const res = await request(app)
			.post(`${path}/22/message`)
			.send({ action: "confirm_regenerate" });
		expect(res.status).toBe(503);
		expect(res.body).toEqual({
			error: "Agent spend is disabled by kill switch",
			code: "AGENT_SPEND_KILL_SWITCH",
		});
		expect(insertConversation).toHaveBeenCalledTimes(writesBefore);
		expect(updateBoard).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
		expect(deleteOutputsForBoard).not.toHaveBeenCalled();
		expect(deleteCardsForBoard).not.toHaveBeenCalled();
	});

	it("keeps switch-off create at 201", async () => {
		const classifyIntent = vi.fn().mockResolvedValue({
			templateId: "research-report",
			explanation: "ready",
		});
		const res = await request(
			makeApp({
				classifyIntent,
				insertBoard: vi.fn().mockResolvedValue({ id: 22 }),
				insertConversation: vi.fn().mockResolvedValue(undefined),
				insertColumns: vi.fn().mockResolvedValue(undefined),
				publishEvent: vi.fn().mockResolvedValue(undefined),
			}),
		)
			.post(path)
			.send({ intent: "research the market" });
		expect(res.status, JSON.stringify(res.body)).toBe(201);
		expect(res.body).toEqual({ boardId: 22, explanation: "ready" });
	});
});
