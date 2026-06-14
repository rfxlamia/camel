import { describe, it, expect, vi } from "vitest";
import { getHumanColumns } from "../routes.js";
import { createAgentBoardService } from "./service.js";

// ---- T1 scaffold: board isolation ----

describe("board isolation", () => {
  it("getHumanColumns filters agent columns via board_id IS NULL", async () => {
    const calls: string[] = [];
    const fakeDb = {
      query: vi.fn(async (sql: string, _params: unknown[]) => {
        calls.push(sql);
        return { rows: [] };
      }),
    };

    await getHumanColumns(fakeDb as any, 1);

    expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [1]);
    expect(calls[0]).toMatch(/board_id IS NULL/i);
    expect(calls[0]).not.toMatch(/board_id IS NOT NULL/i);
  });
});

// ---- T3: Agent Board Service ----

describe("intent classification", () => {
  it("returns 422 when LLM cannot match intent to template", async () => {
    const service = createAgentBoardService({
      classifyIntent: vi.fn(async () => ({
        templateId: null,
        explanation: "This request isn't supported yet.",
      })),
      insertBoard: vi.fn(),
      insertConversation: vi.fn(),
      insertColumns: vi.fn(),
      publishEvent: vi.fn(),
    });
    const result = await service.createBoard({ workspaceId: 1, userId: 1, intent: "build a rocket" });
    expect(result).toMatchObject({ status: 422, message: expect.stringContaining("supported") });
  });

  it("creates board with pending status on successful classification", async () => {
    const insertBoard = vi.fn(async () => ({ id: 42 }));
    const insertConversation = vi.fn(async () => {});
    const service = createAgentBoardService({
      classifyIntent: vi.fn(async () => ({
        templateId: "research-report",
        explanation: "I made a Research & Report board for you.",
      })),
      insertBoard,
      insertConversation,
      insertColumns: vi.fn(async () => []),
      publishEvent: vi.fn(),
    });
    const result = await service.createBoard({ workspaceId: 1, userId: 1, intent: "riset kompetitor fintech" });
    expect(result).toMatchObject({ boardId: 42, explanation: expect.any(String) });
    expect(insertBoard).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 1, userId: 1, status: "pending",
    }));
  });
});

describe("approval", () => {
  it("sets status=approved and execution_status=running on approve", async () => {
    const updateBoard = vi.fn(async () => {});
    const publishEvent = vi.fn(async () => {});
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => ({ id: 1, status: "pending", workspaceId: 1, userId: 1, originalIntent: "riset" })),
      updateBoard,
      triggerExecution: vi.fn(async () => {}),
      publishEvent,
    });
    await service.approveBoard({ boardId: 1, userId: 1, workspaceId: 1 });
    expect(updateBoard).toHaveBeenCalledWith(1, { status: "approved", execution_status: "running" });
  });

  it("returns 403 when user tries to approve board they do not own", async () => {
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => ({ id: 1, status: "pending", workspaceId: 1, userId: 99, originalIntent: "riset" })),
    });
    const result = await service.approveBoard({ boardId: 1, userId: 1, workspaceId: 1 });
    expect(result).toMatchObject({ status: 403 });
  });

  it("returns 409 when board is already approved", async () => {
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => ({ id: 1, status: "approved", workspaceId: 1, userId: 1, originalIntent: "riset" })),
    });
    const result = await service.approveBoard({ boardId: 1, userId: 1, workspaceId: 1 });
    expect(result).toMatchObject({ status: 409 });
  });
});

describe("triggerExecution", () => {
  it("calls executeCard, persists output, publishes done event", async () => {
    const insertOutput = vi.fn(async () => {});
    const updateBoard = vi.fn(async () => {});
    const publishEvent = vi.fn(async () => {});
    const executeCard = vi.fn(
      async (
        _sys: string,
        _intent: string,
        _prev: string[],
        _reasoning: boolean,
        onToken: (token: string) => void,
      ) => {
        onToken("hello");
        return { output: "Research output here", thinking: undefined };
      },
    );
    const service = createAgentBoardService({
      executeCard,
      insertOutput,
      updateBoard,
      publishEvent,
      getBoard: vi.fn(async () => ({
        id: 1,
        status: "approved",
        workspaceId: 1,
        userId: 1,
        originalIntent: "riset kompetitor fintech lokal",
      })),
      getFirstCard: vi.fn(async () => ({
        columnSlug: "research-specialist",
        systemPrompt: "You are a Research Specialist...",
        reasoning: false,
      })),
    });
    await service.triggerExecution({ boardId: 1, workspaceId: 1 });

    expect(publishEvent).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "agent.card.started" }),
    );
    expect(executeCard).toHaveBeenCalledWith(
      expect.any(String),
      "riset kompetitor fintech lokal",
      [],
      false,
      expect.any(Function),
    );
    expect(insertOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 1,
        columnSlug: "research-specialist",
        cardIndex: 0,
        output: "Research output here",
      }),
    );
    expect(updateBoard).toHaveBeenCalledWith(1, { execution_status: "done" });
    expect(publishEvent).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "agent.card.done" }),
    );
  });

  it("sets execution_status=failed and publishes failed event on LLM error", async () => {
    const updateBoard = vi.fn(async () => {});
    const publishEvent = vi.fn(async () => {});
    const service = createAgentBoardService({
      executeCard: vi.fn(async () => {
        throw new Error("LLM timeout");
      }),
      updateBoard,
      publishEvent,
      getBoard: vi.fn(async () => ({
        id: 1,
        status: "approved",
        workspaceId: 1,
        userId: 1,
        originalIntent: "riset",
      })),
      getFirstCard: vi.fn(async () => ({
        columnSlug: "research-specialist",
        systemPrompt: "You are...",
        reasoning: false,
      })),
      insertOutput: vi.fn(),
    });
    await service.triggerExecution({ boardId: 1, workspaceId: 1 });

    expect(updateBoard).toHaveBeenCalledWith(1, { execution_status: "failed" });
    expect(publishEvent).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "agent.card.failed" }),
    );
  });
});

describe("card output retrieval", () => {
  it("getCardOutput returns stored output for columnSlug", async () => {
    const getOutput = vi.fn(async () => ({ output: "Research output", thinking: null }));
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => ({
        id: 1,
        status: "approved",
        workspaceId: 1,
        userId: 1,
        originalIntent: "riset",
      })),
      getOutput,
    });
    const result = await service.getCardOutput({
      boardId: 1,
      columnSlug: "research-specialist",
      workspaceId: 1,
    });
    expect(result).toMatchObject({ output: "Research output" });
  });

  it("getCardOutput returns 404 when no output exists", async () => {
    const getOutput = vi.fn(async () => null);
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => ({
        id: 1,
        status: "approved",
        workspaceId: 1,
        userId: 1,
        originalIntent: "riset",
      })),
      getOutput,
    });
    const result = await service.getCardOutput({
      boardId: 1,
      columnSlug: "research-specialist",
      workspaceId: 1,
    });
    expect(result).toMatchObject({ status: 404 });
  });

  it("getCardOutput returns 404 (no leak) when board belongs to another workspace", async () => {
    // Regression: cross-workspace data leakage. A member of workspace 1
    // must NOT read agent outputs for a board owned by workspace 2, even
    // if output rows exist for that board_id + column_slug.
    const getOutput = vi.fn(async () => ({
      output: "secret cross-workspace output",
      thinking: null,
    }));
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => ({
        id: 1,
        status: "approved",
        workspaceId: 2, // board lives in a DIFFERENT workspace
        userId: 1,
        originalIntent: "riset",
      })),
      getOutput,
    });
    const result = await service.getCardOutput({
      boardId: 1,
      columnSlug: "research-specialist",
      workspaceId: 1, // caller is in workspace 1
    });
    expect(result).toMatchObject({ status: 404 });
    expect(result).not.toHaveProperty("output");
    // Must not even query the output store once ownership fails.
    expect(getOutput).not.toHaveBeenCalled();
  });

  it("getCardOutput returns 404 when board does not exist", async () => {
    const getOutput = vi.fn(async () => ({ output: "x", thinking: null }));
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => null),
      getOutput,
    });
    const result = await service.getCardOutput({
      boardId: 999,
      columnSlug: "research-specialist",
      workspaceId: 1,
    });
    expect(result).toMatchObject({ status: 404 });
    expect(getOutput).not.toHaveBeenCalled();
  });
});

describe("sendMessage", () => {
  it("stores user message and returns clarification question for pending board", async () => {
    const insertConversation = vi.fn(async () => {});
    const generateClarificationQuestion = vi.fn(async () => "What specific competitors?");
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => ({
        id: 1,
        status: "pending",
        workspaceId: 1,
        userId: 1,
        originalIntent: "riset",
      })),
      insertConversation,
      generateClarificationQuestion,
    });
    const result = await service.sendMessage({
      boardId: 1,
      userId: 1,
      workspaceId: 1,
      message: "fintech lokal",
    });
    expect(insertConversation).toHaveBeenCalledWith({
      boardId: 1,
      role: "user",
      content: "fintech lokal",
    });
    expect(result).toMatchObject({
      explanation: "What specific competitors?",
      boardUpdated: false,
    });
  });

  it("returns 403 when user does not own board", async () => {
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => ({
        id: 1,
        status: "pending",
        workspaceId: 1,
        userId: 99,
        originalIntent: "riset",
      })),
    });
    const result = await service.sendMessage({
      boardId: 1,
      userId: 1,
      workspaceId: 1,
      message: "hi",
    });
    expect(result).toMatchObject({ status: 403 });
  });

  it("returns 404 when board belongs to another workspace", async () => {
    // Regression: workspace isolation — a board in workspace 2 must not be
    // reachable via a workspace-1-scoped request, even by its owner.
    const insertConversation = vi.fn(async () => {});
    const service = createAgentBoardService({
      getBoard: vi.fn(async () => ({
        id: 1,
        status: "pending",
        workspaceId: 2, // board lives in a DIFFERENT workspace
        userId: 1,
        originalIntent: "riset",
      })),
      insertConversation,
    });
    const result = await service.sendMessage({
      boardId: 1,
      userId: 1,
      workspaceId: 1, // caller is in workspace 1
      message: "hi",
    });
    expect(result).toMatchObject({ status: 404 });
    expect(insertConversation).not.toHaveBeenCalled();
  });
});

describe("getBoards", () => {
  it("returns list of boards for workspace", async () => {
    const listBoards = vi.fn(async () => [
      {
        id: 2,
        originalIntent: "analisis pasar",
        status: "approved",
        executionStatus: "done",
        createdAt: "2026-06-14T11:00:00Z",
      },
      {
        id: 1,
        originalIntent: "riset fintech",
        status: "approved",
        executionStatus: "done",
        createdAt: "2026-06-14T10:00:00Z",
      },
    ]);
    const service = createAgentBoardService({ listBoards });
    const result = await service.getBoards({ workspaceId: 1 });
    expect(result).toHaveLength(2);
    expect(listBoards).toHaveBeenCalledWith(1);
  });
});
