import { describe, expect, it } from "vitest";
import type { AgentEvent, ToolTraceItem } from "../types";
import {
  deriveToolTrace,
  hasLiveToolActivityForColumn,
  pickToolTraceForColumn,
} from "./toolTrace";

describe("deriveToolTrace", () => {
  it("merges started + result into one logical step", () => {
    const agentEvents = [
      {
        type: "agent.tool.started",
        boardId: 1,
        columnSlug: "research-specialist",
        toolName: "web_search",
        query: "fintech trends",
      },
      {
        type: "agent.tool.result",
        boardId: 1,
        columnSlug: "research-specialist",
        toolName: "web_search",
        resultCount: 5,
      },
    ] as AgentEvent[];

    const toolItems = deriveToolTrace(agentEvents, 1);

    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]).toMatchObject({
      columnSlug: "research-specialist",
      toolName: "web_search",
      query: "fintech trends",
      resultCount: 5,
    });
  });

  it("does not mix tool events from two boards with the same slug (EC3)", () => {
    const agentEvents = [
      {
        type: "agent.tool.started",
        boardId: 1,
        columnSlug: "research-specialist",
        toolName: "web_search",
        query: "board one",
      },
      {
        type: "agent.tool.started",
        boardId: 2,
        columnSlug: "research-specialist",
        toolName: "web_search",
        query: "board two",
      },
    ] as AgentEvent[];

    expect(deriveToolTrace(agentEvents, 1)).toHaveLength(1);
    expect(deriveToolTrace(agentEvents, 1)[0].query).toBe("board one");
    expect(deriveToolTrace(agentEvents, 2)).toHaveLength(1);
    expect(deriveToolTrace(agentEvents, 2)[0].query).toBe("board two");
  });

  it("includes agent.tool.failed on merged or standalone steps", () => {
    const agentEvents = [
      {
        type: "agent.tool.failed",
        columnSlug: "col-a",
        toolName: "web_search",
        errorCode: "RATE_LIMIT",
      },
    ] as AgentEvent[];

    expect(deriveToolTrace(agentEvents)[0]).toMatchObject({
      errorCode: "RATE_LIMIT",
    });
  });
});

describe("pickToolTraceForColumn", () => {
  const stored: ToolTraceItem[] = [
    { columnSlug: "research-specialist", toolName: "web_search", query: "a" },
    { columnSlug: "writer", toolName: "web_search", query: "b" },
  ];

  it("scopes to the requested column", () => {
    const live = deriveToolTrace(
      [
        {
          type: "agent.tool.started",
          boardId: 1,
          columnSlug: "research-specialist",
          toolName: "web_search",
          query: "live",
        },
        {
          type: "agent.tool.result",
          boardId: 1,
          columnSlug: "research-specialist",
          toolName: "web_search",
          resultCount: 2,
        },
      ] as AgentEvent[],
      1,
    );

    const picked = pickToolTraceForColumn(stored, live, "research-specialist");
    expect(picked).toHaveLength(1);
    expect(picked[0].query).toBe("live");
    expect(picked[0].resultCount).toBe(2);
  });
});

describe("hasLiveToolActivityForColumn", () => {
  it("is true when scoped tool events exist for the column", () => {
    const events = [
      {
        type: "agent.tool.started",
        boardId: 1,
        columnSlug: "research-specialist",
        toolName: "web_search",
      },
    ] as AgentEvent[];

    expect(hasLiveToolActivityForColumn(events, 1, "research-specialist")).toBe(
      true,
    );
    expect(hasLiveToolActivityForColumn(events, 2, "research-specialist")).toBe(
      false,
    );
  });
});
