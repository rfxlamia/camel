import { describe, expect, it, vi } from "vitest";
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

describe("getToolTrace (read-only replay)", () => {
  it("returns merged trace steps ordered by created_at, scoped to the board", async () => {
    const rows = [
      {
        column_slug: "research-specialist",
        tool_name: "web_search",
        input: { query: "fintech" },
        result: "started",
        error_code: null,
        attempt: 1,
        created_at: "2026-06-15T10:00:00Z",
      },
      {
        column_slug: "research-specialist",
        tool_name: "web_search",
        input: { query: "fintech", resultCount: 3 },
        result: "3",
        error_code: null,
        attempt: 1,
        created_at: "2026-06-15T10:00:01Z",
      },
    ];
    const fakeDb = { query: vi.fn(async () => ({ rows })) };

    const trace = await getToolTrace(fakeDb as any, 42);

    // scoped to the board id
    expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [42]);
    const sql = fakeDb.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/agent_tool_calls/i);
    expect(sql).toMatch(/board_id\s*=\s*\$1/i);
    expect(sql).toMatch(/order by\s+created_at/i);

    // merged logical step the client expects
    expect(trace).toEqual([
      expect.objectContaining({
        columnSlug: "research-specialist",
        toolName: "web_search",
        query: "fintech",
        resultCount: 3,
        attempt: 1,
        createdAt: "2026-06-15T10:00:01Z",
      }),
    ]);
  });

  it("reads legacy string input shape", async () => {
    const rows = [
      {
        column_slug: "research-specialist",
        tool_name: "web_search",
        input: "fintech",
        result: "2",
        error_code: null,
        attempt: 1,
        created_at: "2026-06-15T10:00:00Z",
      },
    ];
    const fakeDb = { query: vi.fn(async () => ({ rows })) };
    const trace = await getToolTrace(fakeDb as never, 42);
    expect(trace[0].query).toBe("fintech");
    expect(trace[0].resultCount).toBe(2);
  });

  it("is read-only — issues exactly one SELECT and executes no tool", async () => {
    const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
    const trace = await getToolTrace(fakeDb as any, 1);

    expect(trace).toEqual([]);
    expect(fakeDb.query).toHaveBeenCalledTimes(1);
    expect(
      (fakeDb.query.mock.calls[0][0] as string).toLowerCase(),
    ).not.toContain("insert");
  });
});

describe("insertColumns tools serialization", () => {
  it("passes a raw array for TEXT[] tools column, not a JSON string", async () => {
    const mockDb = { query: vi.fn(async () => ({})) };

    await runInsertColumns(mockDb as any, {
      boardId: 1,
      workspaceId: 1,
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

    expect(mockDb.query).toHaveBeenCalledTimes(1);
    const params = mockDb.query.mock.calls[0][1] as unknown[];
    const toolsArg = params[7]; // $8 is the tools parameter

    // Must be a raw array, NOT a JSON string
    expect(Array.isArray(toolsArg)).toBe(true);
    expect(toolsArg).toEqual(["web_search"]);
    expect(typeof toolsArg).not.toBe("string");
  });

  it("passes an empty array when tools is undefined", async () => {
    const mockDb = { query: vi.fn(async () => ({})) };

    await runInsertColumns(mockDb as any, {
      boardId: 1,
      workspaceId: 1,
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

    const params = mockDb.query.mock.calls[0][1] as unknown[];
    const toolsArg = params[7];

    expect(Array.isArray(toolsArg)).toBe(true);
    expect(toolsArg).toEqual([]);
  });
});

describe("artifact DB helpers", () => {
  it("insertArtifact upserts keyed on board_id", async () => {
    const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
    await realArtifactDeps.insertArtifact(fakeDb as never, {
      boardId: 7,
      workspaceId: 3,
      filename: "title.md",
      format: "md",
      content: "# Title\nBody",
    });
    const sql = (fakeDb.query.mock.calls[0][0] as string).toLowerCase();
    expect(sql).toContain("insert into agent_artifacts");
    expect(sql).toMatch(/on conflict\s*\(\s*board_id\s*\)\s*do update/i);
  });

  it("getArtifact issues a single board-scoped SELECT", async () => {
    const row = { filename: "title.md", format: "md", content: "# Title" };
    const fakeDb = { query: vi.fn(async () => ({ rows: [row] })) };
    const result = await realArtifactDeps.getArtifact(fakeDb as never, 7);
    expect(fakeDb.query).toHaveBeenCalledTimes(1);
    expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [7]);
    const sql = (fakeDb.query.mock.calls[0][0] as string).toLowerCase();
    expect(sql).toContain("from agent_artifacts");
    expect(sql).toMatch(/board_id\s*=\s*\$1/i);
    expect(result).toMatchObject({ filename: "title.md" });
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

describe("realDeps SQL wiring (fakeDb)", () => {
  it("selectConversationHistory queries agent_conversations scoped + ordered", async () => {
    const rows = [
      { role: "user", content: "What about subsidies?" },
      { role: "assistant", content: "Subsidies are..." },
    ];
    const fakeDb = { query: vi.fn(async () => ({ rows })) };

    const history = await selectConversationHistory(fakeDb as any, 42);

    expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [42]);
    const sql = fakeDb.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/from\s+agent_conversations/i);
    expect(sql).toMatch(/board_id\s*=\s*\$1/i);
    expect(sql).toMatch(/order by\s+created_at/i);
    expect(history).toEqual([
      { role: "user", content: "What about subsidies?" },
      { role: "assistant", content: "Subsidies are..." },
    ]);
  });

  it("deleteOutputsForBoard issues a scoped DELETE on agent_card_outputs", async () => {
    const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
    await deleteOutputsForBoard(fakeDb as any, 42);
    expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [42]);
    const sql = fakeDb.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/delete from\s+agent_card_outputs/i);
    expect(sql).toMatch(/board_id\s*=\s*\$1/i);
  });

  it("deleteCardsForBoard deletes cards via columns subquery", async () => {
    const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
    await deleteCardsForBoard(fakeDb as any, 42);
    expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [42]);
    const sql = fakeDb.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/delete from\s+cards/i);
    expect(sql).toMatch(
      /column_id\s+in\s*\(\s*select\s+id\s+from\s+columns\s+where\s+board_id\s*=\s*\$1/i,
    );
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
