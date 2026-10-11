import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../types";
import { shouldRefetchBoardOnSyncEvent } from "./agentBoardSync";

describe("shouldRefetchBoardOnSyncEvent", () => {
	it("fetches once per new terminal event", () => {
		const failed = {
			type: "agent.card.failed",
			boardId: 1,
			columnSlug: "analysis-specialist",
			reason: "boom",
		} as AgentEvent;

		const first = shouldRefetchBoardOnSyncEvent([failed], -1);
		expect(first).toEqual({ shouldFetch: true, eventIndex: 0 });

		const repeat = shouldRefetchBoardOnSyncEvent([failed], first.eventIndex);
		expect(repeat).toEqual({ shouldFetch: false, eventIndex: 0 });
	});

	it("fetches when board-level startup recovery marks an interrupted run failed", () => {
		const recovered = {
			type: "agent.board.failed",
			boardId: 1,
		} as AgentEvent;
		expect(shouldRefetchBoardOnSyncEvent([recovered], -1)).toEqual({
			shouldFetch: true,
			eventIndex: 0,
		});
	});

	it("fetches when pipeline execution completes", () => {
		const events = [
			{ type: "agent.card.done", boardId: 1, columnSlug: "qa-guardian" },
			{ type: "agent.execution.done", boardId: 1 },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnSyncEvent(events, -1)).toEqual({
			shouldFetch: true,
			eventIndex: 1,
		});
	});

	it("fetches the active board when the SSE connection reopens", () => {
		const reconnect = {
			type: "agent.connection.opened",
		} as AgentEvent;
		expect(shouldRefetchBoardOnSyncEvent([reconnect], -1)).toEqual({
			shouldFetch: true,
			eventIndex: 0,
		});
	});

	it("fetches when artifact becomes ready after execution completes", () => {
		const events = [
			{ type: "agent.execution.done", boardId: 1 },
			{ type: "agent.artifact.ready", boardId: 1 },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnSyncEvent(events, 0)).toEqual({
			shouldFetch: true,
			eventIndex: 1,
		});
	});

	it("ignores non-terminal tail events", () => {
		const events = [
			{ type: "agent.card.thinking", boardId: 1, token: "x" },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnSyncEvent(events, -1)).toEqual({
			shouldFetch: false,
			eventIndex: -1,
		});
	});

	it("does not refetch on per-column done alone (waits for execution.done)", () => {
		const events = [
			{ type: "agent.card.done", boardId: 1, columnSlug: "col-a" },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnSyncEvent(events, -1)).toEqual({
			shouldFetch: false,
			eventIndex: -1,
		});
	});

	it("fetches for the latest terminal tail event only", () => {
		const events = [
			{ type: "agent.card.failed", boardId: 1, columnSlug: "col-a" },
			{ type: "agent.card.failed", boardId: 1, columnSlug: "col-b" },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnSyncEvent(events, -1)).toEqual({
			shouldFetch: true,
			eventIndex: 1,
		});
		expect(shouldRefetchBoardOnSyncEvent(events, 1)).toEqual({
			shouldFetch: false,
			eventIndex: 1,
		});
	});
});
