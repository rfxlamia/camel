import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool, ToolEvent } from "./tools/types.js";

const mockCreate = vi.fn();
const mockStream = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
	return {
		default: class MockAnthropic {
			messages = {
				create: mockCreate,
				stream: mockStream,
			};
		},
	};
});

vi.mock("./templates.js", () => ({
	renderSystemPrompt: (tpl: string, vars: Record<string, string>) =>
		tpl.replace(/\{(\w+)\}/g, (_m: string, key: string) =>
			key in vars ? vars[key] : `{${key}}`,
		),
}));

describe("classifyIntent", () => {
	beforeEach(() => {
		mockCreate.mockReset();
	});

	it("returns templateId when LLM matches intent", async () => {
		mockCreate.mockResolvedValueOnce({
			content: [
				{
					type: "text",
					text: '{"templateId":"research-report","explanation":"Matched!"}',
				},
			],
		});
		const { classifyIntent } = await import("./llm.js");
		const result = await classifyIntent("riset kompetitor fintech");
		expect(result.templateId).toBe("research-report");
		expect(result.explanation).toBe("Matched!");
	});

	it("returns null templateId when LLM cannot match", async () => {
		mockCreate.mockResolvedValueOnce({
			content: [
				{
					type: "text",
					text: '{"templateId":null,"explanation":"Not supported."}',
				},
			],
		});
		const { classifyIntent } = await import("./llm.js");
		const result = await classifyIntent("build a rocket");
		expect(result.templateId).toBeNull();
		expect(result.explanation).toBe("Not supported.");
	});

	it("parses JSON from markdown code blocks", async () => {
		mockCreate.mockResolvedValueOnce({
			content: [
				{
					type: "text",
					text: '```json\n{"templateId":"research-report","explanation":"Research task detected"}\n```',
				},
			],
		});
		const { classifyIntent } = await import("./llm.js");
		const result = await classifyIntent("analyze competitor pricing");
		expect(result.templateId).toBe("research-report");
		expect(result.explanation).toBe("Research task detected");
	});

	it("parses JSON embedded in text", async () => {
		mockCreate.mockResolvedValueOnce({
			content: [
				{
					type: "text",
					text: 'Here is my analysis: {"templateId":null,"explanation":"Not a research task"} Hope this helps!',
				},
			],
		});
		const { classifyIntent } = await import("./llm.js");
		const result = await classifyIntent("create a fish image");
		expect(result.templateId).toBeNull();
		expect(result.explanation).toBe("Not a research task");
	});

	it("handles completely unparseable response gracefully after all retries", async () => {
		// All 3 attempts return unparseable text → final fallback message
		const unparseable = {
			content: [
				{
					type: "text",
					text: "I cannot classify this intent. It does not match any template.",
				},
			],
		};
		mockCreate
			.mockResolvedValueOnce(unparseable)
			.mockResolvedValueOnce(unparseable)
			.mockResolvedValueOnce(unparseable);
		const { classifyIntent } = await import("./llm.js");
		const result = await classifyIntent("buat gambar ikan");
		expect(result.templateId).toBeNull();
		expect(result.explanation).toBe(
			"Intent could not be classified. Please try a research-related request.",
		);
		expect(mockCreate).toHaveBeenCalledTimes(3);
	});

	it("succeeds on retry after initial parse failure", async () => {
		// First attempt returns garbage, second returns valid JSON
		mockCreate
			.mockResolvedValueOnce({
				content: [{ type: "text", text: "Maaf, saya tidak bisa memproses." }],
			})
			.mockResolvedValueOnce({
				content: [
					{
						type: "text",
						text: '{"templateId":"research-report","explanation":"Research on coffee limits detected."}',
					},
				],
			});
		const { classifyIntent } = await import("./llm.js");
		const result = await classifyIntent(
			"lakukan riset tentang jumlah maksimum minum kopi sehari",
		);
		expect(result.templateId).toBe("research-report");
		expect(mockCreate).toHaveBeenCalledTimes(2);
	});

	it("does NOT retry when LLM returns null with a real explanation (semantic no-match)", async () => {
		// LLM confidently says null — no retry needed
		mockCreate.mockResolvedValueOnce({
			content: [
				{
					type: "text",
					text: '{"templateId":null,"explanation":"This is a rocket-building request, not supported."}',
				},
			],
		});
		const { classifyIntent } = await import("./llm.js");
		const result = await classifyIntent("build me a rocket ship");
		expect(result.templateId).toBeNull();
		expect(result.explanation).toBe(
			"This is a rocket-building request, not supported.",
		);
		expect(mockCreate).toHaveBeenCalledTimes(1);
	});

	it("parses the text block even when a thinking block comes first", async () => {
		// Reasoning models (e.g. MiMo) can emit content as [thinking, text].
		// Reading only content[0] would yield "" and fail every parse attempt.
		mockCreate.mockResolvedValueOnce({
			content: [
				{ type: "thinking", thinking: "Let me classify this request." },
				{
					type: "text",
					text: '{"templateId":"research-report","explanation":"Research task detected"}',
				},
			],
		});
		const { classifyIntent } = await import("./llm.js");
		const result = await classifyIntent("riset pasar air mineral");
		expect(result.templateId).toBe("research-report");
		expect(result.explanation).toBe("Research task detected");
		expect(mockCreate).toHaveBeenCalledTimes(1);
	});

	it("requests a token budget large enough for reasoning models", async () => {
		// Root cause of the live 422: max_tokens=256 truncated the JSON before
		// the model's thinking block finished. Guard against regressing to a
		// budget too tight for a reasoning model.
		mockCreate.mockResolvedValueOnce({
			content: [
				{
					type: "text",
					text: '{"templateId":"research-report","explanation":"ok"}',
				},
			],
		});
		const { classifyIntent } = await import("./llm.js");
		await classifyIntent("riset apa saja");
		expect(mockCreate.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(1024);
	});

	it("Strategy 3 regex handles explanation containing } character", async () => {
		// Old regex \{[^}]*\} would truncate this JSON — new [\s\S]* handles it
		mockCreate.mockResolvedValueOnce({
			content: [
				{
					type: "text",
					text: 'Here: {"templateId":"research-report","explanation":"Research about {coffee} limits"} done.',
				},
			],
		});
		const { classifyIntent } = await import("./llm.js");
		const result = await classifyIntent("riset batas konsumsi kopi");
		expect(result.templateId).toBe("research-report");
	});
});

describe("executeCard", () => {
	beforeEach(() => {
		mockStream.mockReset();
	});

	it("substitutes {original_intent} in system prompt before calling LLM", async () => {
		const mockStreamObj = {
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: "content_block_delta",
					delta: { type: "text_delta", text: "output" },
				};
			},
			finalMessage: vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "output" }],
			}),
		};
		mockStream.mockReturnValueOnce(mockStreamObj);

		const { executeCard } = await import("./llm.js");
		const onToken = vi.fn();
		await executeCard(
			"User intent: {original_intent}",
			"riset fintech",
			[],
			false,
			onToken,
		);

		expect(mockStream).toHaveBeenCalledWith(
			expect.objectContaining({
				system: expect.anything(),
			}),
		);

		// Verify the system prompt was substituted
		const callArgs = mockStream.mock.calls[0][0];
		expect(callArgs.system).not.toContain("{original_intent}");
		expect(callArgs.system).toContain("riset fintech");
	});

	it("streams tokens via onToken callback", async () => {
		const mockStreamObj = {
			[Symbol.asyncIterator]: async function* () {
				yield {
					type: "content_block_delta",
					delta: { type: "text_delta", text: "Hello" },
				};
				yield {
					type: "content_block_delta",
					delta: { type: "text_delta", text: " world" },
				};
			},
			finalMessage: vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Hello world" }],
			}),
		};
		mockStream.mockReturnValueOnce(mockStreamObj);

		const { executeCard } = await import("./llm.js");
		const onToken = vi.fn();
		const result = await executeCard("prompt", "intent", [], false, onToken);

		expect(onToken).toHaveBeenCalledTimes(2);
		expect(onToken).toHaveBeenCalledWith("Hello");
		expect(onToken).toHaveBeenCalledWith(" world");
		expect(result.output).toBe("Hello world");
	});
});

function makeTurn(opts: {
	text?: string;
	stopReason: "tool_use" | "end_turn";
	toolUse?: { id: string; name: string; input: Record<string, unknown> };
}) {
	const content: unknown[] = [];
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

describe("executeCard tool loop", () => {
	beforeEach(() => {
		mockStream.mockReset();
	});

	it("executes a tool then returns ONLY the final turn's text (R4)", async () => {
		mockStream
			.mockReturnValueOnce(
				makeTurn({
					text: "let me search",
					stopReason: "tool_use",
					toolUse: { id: "tu_1", name: "web_search", input: { query: "x" } },
				}),
			)
			.mockReturnValueOnce(
				makeTurn({ text: "Final answer.", stopReason: "end_turn" }),
			);

		const execute = vi.fn(async () => ({ ok: true, content: "search hit" }));
		const events: ToolEvent[] = [];
		const { executeCard } = await import("./llm.js");

		const result = await executeCard(
			"prompt",
			"intent",
			[],
			false,
			vi.fn(),
			[mockTool(execute)],
			3,
			(e: ToolEvent) => events.push(e),
		);

		expect(execute).toHaveBeenCalledTimes(1);
		expect(events.map((e) => e.phase)).toEqual(
			expect.arrayContaining(["started", "result"]),
		);
		expect(result.output).toBe("Final answer.");
		expect(result.output).not.toContain("let me search");
	});

	it("refuses tool calls past the budget but still produces a final answer (R2)", async () => {
		mockStream
			.mockReturnValueOnce(
				makeTurn({
					stopReason: "tool_use",
					toolUse: { id: "tu_1", name: "web_search", input: { query: "a" } },
				}),
			)
			.mockReturnValueOnce(
				makeTurn({
					stopReason: "tool_use",
					toolUse: { id: "tu_2", name: "web_search", input: { query: "b" } },
				}),
			)
			.mockReturnValueOnce(
				makeTurn({ text: "Done within budget.", stopReason: "end_turn" }),
			);

		const execute = vi.fn(async () => ({ ok: true, content: "hit" }));
		const { executeCard } = await import("./llm.js");

		const result = await executeCard(
			"prompt",
			"intent",
			[],
			false,
			vi.fn(),
			[mockTool(execute)],
			1,
			vi.fn(),
		);

		expect(execute).toHaveBeenCalledTimes(1);
		expect(result.output).toBe("Done within budget.");
	});

	it("feeds a structured tool error back and finishes without throwing (R3)", async () => {
		mockStream
			.mockReturnValueOnce(
				makeTurn({
					stopReason: "tool_use",
					toolUse: { id: "tu_1", name: "web_search", input: { query: "x" } },
				}),
			)
			.mockReturnValueOnce(
				makeTurn({ text: "Recovered.", stopReason: "end_turn" }),
			);

		const execute = vi.fn(async () => ({
			ok: false,
			content: "rate limited",
			errorCode: "RATE_LIMIT",
		}));
		const events: ToolEvent[] = [];
		const { executeCard } = await import("./llm.js");

		const result = await executeCard(
			"prompt",
			"intent",
			[],
			false,
			vi.fn(),
			[mockTool(execute)],
			3,
			(e: ToolEvent) => events.push(e),
		);

		expect(
			events.some((e) => e.phase === "failed" && e.errorCode === "RATE_LIMIT"),
		).toBe(true);
		expect(result.output).toBe("Recovered.");
	});

	it("degrades to the single-shot path when tools are empty (R1)", async () => {
		mockStream.mockReturnValueOnce(
			makeTurn({ text: "Plain answer.", stopReason: "end_turn" }),
		);
		const { executeCard } = await import("./llm.js");
		const onToken = vi.fn();

		const result = await executeCard("prompt", "intent", [], false, onToken);

		expect(mockStream).toHaveBeenCalledTimes(1);
		expect(mockStream.mock.calls[0][0]).not.toHaveProperty("tools");
		expect(result.output).toBe("Plain answer.");
		expect(onToken).toHaveBeenCalledWith("Plain answer.");
	});

	it("includes resultCount on successful tool result events (R2)", async () => {
		mockStream
			.mockReturnValueOnce(
				makeTurn({
					stopReason: "tool_use",
					toolUse: { id: "tu_1", name: "web_search", input: { query: "x" } },
				}),
			)
			.mockReturnValueOnce(makeTurn({ text: "Done.", stopReason: "end_turn" }));

		const execute = vi.fn(async () => ({
			ok: true,
			content:
				"1. A\n   https://a.com\n   snip\n\n2. B\n   https://b.com\n   snip",
		}));
		const events: ToolEvent[] = [];
		const { executeCard } = await import("./llm.js");

		await executeCard(
			"prompt",
			"intent",
			[],
			false,
			vi.fn(),
			[mockTool(execute)],
			3,
			(e: ToolEvent) => events.push(e),
		);

		const resultEvent = events.find((e) => e.phase === "result");
		expect(resultEvent?.resultCount).toBe(2);
	});

	it("emits BUDGET_EXCEEDED when search budget is exhausted (R2)", async () => {
		mockStream
			.mockReturnValueOnce(
				makeTurn({
					stopReason: "tool_use",
					toolUse: { id: "tu_1", name: "web_search", input: { query: "a" } },
				}),
			)
			.mockReturnValueOnce(
				makeTurn({
					stopReason: "tool_use",
					toolUse: { id: "tu_2", name: "web_search", input: { query: "b" } },
				}),
			)
			.mockReturnValueOnce(makeTurn({ text: "Done.", stopReason: "end_turn" }));

		const execute = vi.fn(async () => ({ ok: true, content: "hit" }));
		const events: ToolEvent[] = [];
		const { executeCard } = await import("./llm.js");

		await executeCard(
			"prompt",
			"intent",
			[],
			false,
			vi.fn(),
			[mockTool(execute)],
			1,
			(e: ToolEvent) => events.push(e),
		);

		expect(
			events.some(
				(e) => e.phase === "failed" && e.errorCode === "BUDGET_EXCEEDED",
			),
		).toBe(true);
		expect(execute).toHaveBeenCalledTimes(1);
	});
});
