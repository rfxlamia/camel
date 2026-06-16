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
});
