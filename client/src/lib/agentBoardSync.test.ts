import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../types";
import { shouldRefetchBoardOnTerminalEvent } from "./agentBoardSync";

describe("shouldRefetchBoardOnTerminalEvent", () => {
	it("fetches once per new terminal event", () => {
		const failed = {
			type: "agent.card.failed",
			boardId: 1,
			columnSlug: "analysis-specialist",
			reason: "boom",
		} as AgentEvent;

		const first = shouldRefetchBoardOnTerminalEvent([failed], -1);
		expect(first).toEqual({ shouldFetch: true, eventIndex: 0 });

		const repeat = shouldRefetchBoardOnTerminalEvent([failed], first.eventIndex);
		expect(repeat).toEqual({ shouldFetch: false, eventIndex: 0 });
	});

	it("fetches when pipeline execution completes", () => {
		const events = [
			{ type: "agent.card.done", boardId: 1, columnSlug: "qa-guardian" },
			{ type: "agent.execution.done", boardId: 1 },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnTerminalEvent(events, -1)).toEqual({
			shouldFetch: true,
			eventIndex: 1,
		});
	});

	it("fetches when artifact becomes ready after execution completes", () => {
		const events = [
			{ type: "agent.execution.done", boardId: 1 },
			{ type: "agent.artifact.ready", boardId: 1 },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnTerminalEvent(events, 0)).toEqual({
			shouldFetch: true,
			eventIndex: 1,
		});
	});

	it("ignores non-terminal tail events", () => {
		const events = [
			{ type: "agent.card.thinking", boardId: 1, token: "x" },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnTerminalEvent(events, -1)).toEqual({
			shouldFetch: false,
			eventIndex: -1,
		});
	});

	it("does not refetch on per-column done alone (waits for execution.done)", () => {
		const events = [
			{ type: "agent.card.done", boardId: 1, columnSlug: "col-a" },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnTerminalEvent(events, -1)).toEqual({
			shouldFetch: false,
			eventIndex: -1,
		});
	});

	it("fetches for the latest terminal tail event only", () => {
		const events = [
			{ type: "agent.card.failed", boardId: 1, columnSlug: "col-a" },
			{ type: "agent.card.failed", boardId: 1, columnSlug: "col-b" },
		] as AgentEvent[];

		expect(shouldRefetchBoardOnTerminalEvent(events, -1)).toEqual({
			shouldFetch: true,
			eventIndex: 1,
		});
		expect(shouldRefetchBoardOnTerminalEvent(events, 1)).toEqual({
			shouldFetch: false,
			eventIndex: 1,
		});
	});
});
