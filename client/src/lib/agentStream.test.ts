import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../types";
import {
	deriveStreamedOutputForColumn,
	deriveThinkingForColumn,
	pickContent,
} from "./agentStream";

describe("deriveThinkingForColumn", () => {
	it("concatenates only agent.card.thinking tokens for the given board+slug, in order", () => {
		const events = [
			{
				type: "agent.card.thinking",
				boardId: 1,
				columnSlug: "analysis-specialist",
				token: "step 1 ",
			},
			{
				type: "agent.card.token",
				boardId: 1,
				columnSlug: "analysis-specialist",
				token: "OUTPUT not thinking",
			},
			{
				type: "agent.card.thinking",
				boardId: 1,
				columnSlug: "analysis-specialist",
				token: "step 2",
			},
		] as AgentEvent[];

		expect(
			deriveThinkingForColumn(events, 1, "analysis-specialist"),
		).toBe("step 1 step 2");
	});

	it("drops events missing columnSlug or boardId (no cross-column/board bleed)", () => {
		const events = [
			{ type: "agent.card.thinking", token: "no slug no board" },
			{ type: "agent.card.thinking", boardId: 1, token: "no slug" },
			{
				type: "agent.card.thinking",
				columnSlug: "analysis-specialist",
				token: "no board",
			},
			{
				type: "agent.card.thinking",
				boardId: 1,
				columnSlug: "analysis-specialist",
				token: "kept",
			},
		] as AgentEvent[];

		expect(
			deriveThinkingForColumn(events, 1, "analysis-specialist"),
		).toBe("kept");
	});

	it("does not mix two boards that reuse the same slug", () => {
		const events = [
			{
				type: "agent.card.thinking",
				boardId: 1,
				columnSlug: "analysis-specialist",
				token: "board1 ",
			},
			{
				type: "agent.card.thinking",
				boardId: 2,
				columnSlug: "analysis-specialist",
				token: "board2",
			},
		] as AgentEvent[];

		expect(deriveThinkingForColumn(events, 1, "analysis-specialist")).toBe(
			"board1 ",
		);
		expect(deriveThinkingForColumn(events, 2, "analysis-specialist")).toBe(
			"board2",
		);
	});
});

describe("deriveStreamedOutputForColumn", () => {
	it("concatenates only agent.card.token text for the given board+slug", () => {
		const events = [
			{
				type: "agent.card.thinking",
				boardId: 1,
				columnSlug: "research-specialist",
				token: "thinking not output",
			},
			{
				type: "agent.card.token",
				boardId: 1,
				columnSlug: "research-specialist",
				token: "Hello ",
			},
			{
				type: "agent.card.token",
				boardId: 1,
				columnSlug: "research-specialist",
				token: "world",
			},
		] as AgentEvent[];

		expect(
			deriveStreamedOutputForColumn(events, 1, "research-specialist"),
		).toBe("Hello world");
	});
});

describe("pickContent", () => {
	it("returns live when live is non-empty", () => {
		expect(pickContent("live text", "db text")).toBe("live text");
	});
	it("returns db when live is empty", () => {
		expect(pickContent("", "db text")).toBe("db text");
	});
});
