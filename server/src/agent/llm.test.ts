import { describe, it, expect, vi, beforeEach } from "vitest";

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
