import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../types";
import { deriveColumnState } from "./agentColumnState";

const SLUG = "analysis-specialist";
const BOARD = 5;

function ev(
  type: AgentEvent["type"],
  columnSlug = SLUG,
  boardId = BOARD,
): AgentEvent {
  return { type, columnSlug, boardId } as AgentEvent;
}

describe("deriveColumnState", () => {
  it("returns 'active' when started but not done/failed", () => {
    expect(
      deriveColumnState([ev("agent.card.started")], BOARD, SLUG, "running"),
    ).toBe("active");
  });

  it("returns 'done' when the column emitted agent.card.done", () => {
    expect(
      deriveColumnState(
        [ev("agent.card.started"), ev("agent.card.done")],
        BOARD,
        SLUG,
        "running",
      ),
    ).toBe("done");
  });

  it("returns 'failed' for a failed column even when board executionStatus is 'done'", () => {
    expect(
      deriveColumnState(
        [ev("agent.card.started"), ev("agent.card.failed")],
        BOARD,
        SLUG,
        "done",
      ),
    ).toBe("failed");
  });

  it("returns 'pending' when no events exist for this slug while another column runs", () => {
    const eventsForOther = [ev("agent.card.started", "research-specialist")];
    expect(deriveColumnState(eventsForOther, BOARD, SLUG, "running")).toBe(
      "pending",
    );
  });

  it("does not bleed across boards (same slug, different boardId)", () => {
    const otherBoard = [ev("agent.card.started", SLUG, 99)];
    expect(deriveColumnState(otherBoard, BOARD, SLUG, "running")).toBe(
      "pending",
    );
  });

  it("returns done from persisted output when live events are gone (reload)", () => {
    expect(deriveColumnState([], BOARD, SLUG, "done", true)).toBe("done");
  });

  it("does not treat persisted output as done while the pipeline is still running", () => {
    expect(deriveColumnState([], BOARD, SLUG, "running", true)).toBe("pending");
  });

  it("returns failed over persisted output for the same column", () => {
    expect(
      deriveColumnState([ev("agent.card.failed")], BOARD, SLUG, "failed", true),
    ).toBe("failed");
  });
});

describe("deriveColumnState __notfirst__ filtering", () => {
  it("ignores events with columnSlug __notfirst__ when deriving state for a regular column", () => {
    const events: AgentEvent[] = [
      {
        type: "agent.card.started",
        columnSlug: "research-specialist",
        boardId: BOARD,
      } as AgentEvent,
      {
        type: "agent.card.token",
        columnSlug: "__notfirst__",
        boardId: BOARD,
        token: "follow-up text",
      } as AgentEvent,
      {
        type: "agent.card.done",
        columnSlug: "research-specialist",
        boardId: BOARD,
      } as AgentEvent,
    ];
    expect(
      deriveColumnState(events, BOARD, "research-specialist", "running"),
    ).toBe("done");
  });

  it("does not affect pending column state when only __notfirst__ events exist", () => {
    const events: AgentEvent[] = [
      {
        type: "agent.card.token",
        columnSlug: "__notfirst__",
        boardId: BOARD,
        token: "follow-up response",
      } as AgentEvent,
      {
        type: "agent.card.done",
        columnSlug: "__notfirst__",
        boardId: BOARD,
      } as AgentEvent,
    ];
    expect(deriveColumnState(events, BOARD, SLUG, "running")).toBe("pending");
  });

  it("treats __notfirst__ events as invisible to column state derivation", () => {
    const events: AgentEvent[] = [
      {
        type: "agent.card.started",
        columnSlug: "__notfirst__",
        boardId: BOARD,
      } as AgentEvent,
      {
        type: "agent.card.token",
        columnSlug: "__notfirst__",
        boardId: BOARD,
        token: "streaming...",
      } as AgentEvent,
    ];
    expect(deriveColumnState(events, BOARD, SLUG, "running")).toBe("pending");
  });
});
