import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import {
	buildArtifactDownload,
	defaultToolRegistry,
	deleteCardsForBoard,
	deleteOutputsForBoard,
	getToolTrace,
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
		});
	},
);
