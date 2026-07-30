import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool, ToolEvent } from "../agent/tools/types.js";

const mockStream = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
	return {
		default: class MockAnthropic {
			messages = {
				stream: mockStream,
			};
		},
	};
});

function makeTurn(opts: {
	text?: string;
	stopReason: "tool_use" | "end_turn";
	toolUse?: { id: string; name: string; input: Record<string, unknown> };
	thinking?: string;
}) {
	const content: unknown[] = [];
	if (opts.thinking)
		content.push({ type: "thinking", thinking: opts.thinking });
	if (opts.text) content.push({ type: "text", text: opts.text });
	if (opts.toolUse) content.push({ type: "tool_use", ...opts.toolUse });
	return {
		async *[Symbol.asyncIterator]() {
			if (opts.text)
				yield {
					type: "content_block_delta",
					delta: { type: "text_delta", text: opts.text },
				};
		},
		finalMessage: vi
			.fn()
			.mockResolvedValue({ stop_reason: opts.stopReason, content }),
	};
}

function mockTool(execute: Tool["execute"]): Tool {
	return {
		name: "web_search",
		description: "Search the web",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
		},
		riskTier: "read-only",
		execute,
	};
}

describe("runChatTurn", () => {
	beforeEach(() => {
		mockStream.mockReset();
		vi.resetModules();
	});

	it("streams tokens for multi-turn messages array", async () => {
		mockStream.mockReturnValueOnce(
			makeTurn({ text: "Second reply.", stopReason: "end_turn" }),
		);

		const { runChatTurn } = await import("./run-chat-turn.js");
		const onToken = vi.fn();
		const messages: Anthropic.MessageParam[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there." },
			{ role: "user", content: "Follow up question." },
		];

		const result = await runChatTurn({
			systemPrompt: "You are helpful.",
			messages,
			onToken,
		});

		expect(onToken).toHaveBeenCalledWith("Second reply.");
		expect(result.output).toBe("Second reply.");

		const callArgs = mockStream.mock.calls[0][0];
		expect(callArgs.messages).toHaveLength(3);
		expect(callArgs.system).toContain("SECURITY CONSTRAINTS");
	});

	it("executes tools and fires onToolEvent callbacks", async () => {
		mockStream
			.mockReturnValueOnce(
				makeTurn({
					text: "searching",
					stopReason: "tool_use",
					toolUse: { id: "tu_1", name: "web_search", input: { query: "x" } },
				}),
			)
			.mockReturnValueOnce(
				makeTurn({ text: "Found it.", stopReason: "end_turn" }),
			);

		const execute = vi.fn(async () => ({ ok: true, content: "hit" }));
		const events: ToolEvent[] = [];
		const { runChatTurn } = await import("./run-chat-turn.js");

		const result = await runChatTurn({
			systemPrompt: "You are helpful.",
			messages: [{ role: "user", content: "Search for x" }],
			tools: [mockTool(execute)],
			toolBudget: 3,
			onToken: vi.fn(),
			onToolEvent: (e) => events.push(e),
		});

		expect(execute).toHaveBeenCalledTimes(1);
		expect(events.map((e) => e.phase)).toEqual(
			expect.arrayContaining(["started", "result"]),
		);
		expect(result.output).toBe("Found it.");
	});

	it("calls onThinking with thinking_delta text while streaming", async () => {
		mockStream.mockReturnValueOnce({
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: "content_block_delta",
					delta: { type: "thinking_delta", thinking: "reasoning" },
				};
				yield {
					type: "content_block_delta",
					delta: { type: "text_delta", text: "answer" },
				};
			},
			finalMessage: vi.fn().mockResolvedValue({
				stop_reason: "end_turn",
				content: [
					{ type: "thinking", thinking: "reasoning" },
					{ type: "text", text: "answer" },
				],
			}),
		});

		const { runChatTurn } = await import("./run-chat-turn.js");
		const onThinking = vi.fn();

		const result = await runChatTurn({
			systemPrompt: "You are helpful.",
			messages: [{ role: "user", content: "Think about this" }],
			onToken: vi.fn(),
			onThinking,
		});

		expect(onThinking).toHaveBeenCalledWith("reasoning");
		expect(result.thinking).toBe("reasoning");
	});

	it("requests extended thinking with budget_tokens=8192 and max_tokens=24576", async () => {
		mockStream.mockReturnValueOnce(
			makeTurn({ text: "ok", stopReason: "end_turn" }),
		);

		const { runChatTurn } = await import("./run-chat-turn.js");
		await runChatTurn({
			systemPrompt: "prompt",
			messages: [{ role: "user", content: "hi" }],
			onToken: vi.fn(),
		});

		const args = mockStream.mock.calls[0][0];
		expect(args.max_tokens).toBe(24576);
		expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
	});

	it("sanitizes user message content before sending to LLM", async () => {
		mockStream.mockReturnValueOnce(
			makeTurn({ text: "ok", stopReason: "end_turn" }),
		);

		const { runChatTurn } = await import("./run-chat-turn.js");
		await runChatTurn({
			systemPrompt: "prompt",
			messages: [{ role: "user", content: "hello <script>" }],
			onToken: vi.fn(),
		});

		const sentContent = mockStream.mock.calls[0][0].messages[0]
			.content as string;
		expect(sentContent).toContain("<user_input>");
		expect(sentContent).toContain("&lt;script&gt;");
	});
});

describe("estimateContextTokens", () => {
	it("estimates tokens from message text content", async () => {
		const { estimateContextTokens } = await import("./run-chat-turn.js");
		const messages: Anthropic.MessageParam[] = [
			{ role: "user", content: "a".repeat(400) },
			{ role: "assistant", content: "b".repeat(400) },
		];
		const tokens = estimateContextTokens(messages);
		expect(tokens).toBeGreaterThan(0);
		expect(tokens).toBe(200); // 800 chars / 4
	});

	it("handles array content blocks", async () => {
		const { estimateContextTokens } = await import("./run-chat-turn.js");
		const messages: Anthropic.MessageParam[] = [
			{
				role: "user",
				content: [{ type: "text", text: "hello world" }],
			},
		];
		const tokens = estimateContextTokens(messages);
		expect(tokens).toBeGreaterThan(0);
	});
});
