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

describe("classifyFollowUpIntent", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns ASK intent when message questions existing artifact", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '{"intent":"ASK","response":"The research found three key consumer preferences: price sensitivity under 300M IDR, charging infrastructure as top concern, and preference for local brands with government subsidies.","confidence":0.92}',
        },
      ],
    });
    const { classifyFollowUpIntent } = await import("./llm.js");
    const result = await classifyFollowUpIntent(
      "Market research for EV in Indonesia",
      "# EV Market Research\n\nConsumer preferences...",
      [
        {
          role: "user",
          content: "What were the key findings about consumer preferences?",
        },
      ],
      "What were the key findings about consumer preferences?",
    );
    expect(result.intent).toBe("ASK");
    expect(result.response).toContain("consumer preferences");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("returns REFINE intent when message requests modification within scope", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '{"intent":"REFINE","response":"I will update the research to include a dedicated section on government regulations and subsidies for electric vehicles in Indonesia.","confidence":0.88}',
        },
      ],
    });
    const { classifyFollowUpIntent } = await import("./llm.js");
    const result = await classifyFollowUpIntent(
      "Market research for EV in Indonesia",
      "# EV Market Research\n\n...",
      [
        {
          role: "user",
          content: "Add a section about government regulations and subsidies",
        },
      ],
      "Add a section about government regulations and subsidies",
    );
    expect(result.intent).toBe("REFINE");
    expect(result.response).toContain("regulations");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("returns NEW_DIRECTION intent when message requests fundamentally different topic", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '{"intent":"NEW_DIRECTION","response":"This is a different research topic from the current board (electric vehicles → electric scooters). I will regenerate the board with this new focus.","confidence":0.95}',
        },
      ],
    });
    const { classifyFollowUpIntent } = await import("./llm.js");
    const result = await classifyFollowUpIntent(
      "Market research for EV in Indonesia",
      "# EV Market Research\n\n...",
      [],
      "Now research the competitor landscape for electric scooters",
    );
    expect(result.intent).toBe("NEW_DIRECTION");
    expect(result.response).toContain("regenerate");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("returns OFF_TOPIC intent when message is clearly unrelated", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '{"intent":"OFF_TOPIC","response":"I can help with research and analysis for your board, but writing code is outside my scope. If you would like to research EV pricing data, I can include that in the current board — or you can create a new board for a different task.","confidence":0.97}',
        },
      ],
    });
    const { classifyFollowUpIntent } = await import("./llm.js");
    const result = await classifyFollowUpIntent(
      "Market research for EV in Indonesia",
      "# EV Market Research\n\n...",
      [],
      "Write me a Python script to scrape EV prices",
    );
    expect(result.intent).toBe("OFF_TOPIC");
    expect(result.response).toContain("outside my scope");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("parses JSON from markdown code blocks", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '```json\n{"intent":"ASK","response":"The analysis found...","confidence":0.85}\n```',
        },
      ],
    });
    const { classifyFollowUpIntent } = await import("./llm.js");
    const result = await classifyFollowUpIntent(
      "riset",
      null,
      [],
      "What did the analysis find?",
    );
    expect(result.intent).toBe("ASK");
    expect(result.response).toBe("The analysis found...");
  });

  it("parses JSON embedded in preamble text via greedy match", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: 'Based on the context provided, here is my classification: {"intent":"REFINE","response":"I will add that section.","confidence":0.82} Hope this helps!',
        },
      ],
    });
    const { classifyFollowUpIntent } = await import("./llm.js");
    const result = await classifyFollowUpIntent(
      "riset",
      null,
      [],
      "Add more data about 2025 trends",
    );
    expect(result.intent).toBe("REFINE");
    expect(result.response).toBe("I will add that section.");
  });

  it("retries on parse failure and succeeds on second attempt", async () => {
    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "I cannot classify this." }],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: '{"intent":"ASK","response":"Here is the answer.","confidence":0.8}',
          },
        ],
      });
    const { classifyFollowUpIntent } = await import("./llm.js");
    const result = await classifyFollowUpIntent(
      "riset",
      null,
      [],
      "Tell me more",
    );
    expect(result.intent).toBe("ASK");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("returns OFF_TOPIC fallback after all retries fail", async () => {
    const unparseable = {
      content: [{ type: "text", text: "Cannot process." }],
    };
    mockCreate
      .mockResolvedValueOnce(unparseable)
      .mockResolvedValueOnce(unparseable)
      .mockResolvedValueOnce(unparseable);
    const { classifyFollowUpIntent } = await import("./llm.js");
    const result = await classifyFollowUpIntent("riset", null, [], "hello");
    expect(result.intent).toBe("OFF_TOPIC");
    expect(result.response).toContain("could not be processed");
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("passes originalIntent, artifact, and conversation history in context", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '{"intent":"ASK","response":"ok","confidence":0.8}',
        },
      ],
    });
    const { classifyFollowUpIntent } = await import("./llm.js");
    await classifyFollowUpIntent(
      "EV market research",
      "# EV Research\nKey findings...",
      [
        { role: "user", content: "What about subsidies?" },
        { role: "assistant", content: "Subsidies are..." },
      ],
      "Tell me more about subsidies",
    );
    const userMsg = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(userMsg).toContain("EV market research");
    expect(userMsg).toContain("EV Research");
    expect(userMsg).toContain("What about subsidies?");
    expect(userMsg).toContain("Subsidies are...");
    expect(userMsg).toContain("Tell me more about subsidies");
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

  it("requests a token budget large enough that reports are not truncated", async () => {
    // Research reports + the model's thinking block exceeded max_tokens=4096
    // (stop_reason=max_tokens), cutting output mid-sentence. Guard the budget.
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
    await executeCard("prompt", "intent", [], false, vi.fn());

    expect(mockStream.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(8192);
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

describe("executeCard extended thinking + live streaming", () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  it("requests thinking enabled with budget_tokens=8192 and max_tokens=24576 (single-shot)", async () => {
    mockStream.mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "out" },
        };
      },
      finalMessage: vi.fn().mockResolvedValue({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "out" }],
      }),
    });

    const { executeCard } = await import("./llm.js");
    await executeCard("prompt", "intent", [], false, vi.fn());

    const args = mockStream.mock.calls[0][0];
    expect(args.max_tokens).toBe(24576);
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });

  it("requests thinking enabled + max_tokens=24576 on the tools path too", async () => {
    mockStream.mockReturnValueOnce(
      makeTurn({ text: "Final.", stopReason: "end_turn" }),
    );
    const { executeCard } = await import("./llm.js");
    await executeCard(
      "prompt",
      "intent",
      [],
      false,
      vi.fn(),
      [mockTool(vi.fn(async () => ({ ok: true, content: "hit" })))],
      3,
      vi.fn(),
    );

    const args = mockStream.mock.calls[0][0];
    expect(args.max_tokens).toBe(24576);
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });

  it("calls onThinking with thinking_delta text while streaming", async () => {
    mockStream.mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "step 1" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: " step 2" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "answer" },
        };
      },
      finalMessage: vi.fn().mockResolvedValue({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "answer" }],
      }),
    });

    const { executeCard } = await import("./llm.js");
    const onThinking = vi.fn();
    // onThinking is the LAST positional arg (after onToolEvent).
    await executeCard(
      "prompt",
      "intent",
      [],
      false,
      vi.fn(),
      [],
      3,
      undefined,
      onThinking,
    );

    expect(onThinking).toHaveBeenCalledWith("step 1");
    expect(onThinking).toHaveBeenCalledWith(" step 2");
  });

  it("streams tool-path text live via onToken DURING the turn, not only at the end", async () => {
    // First turn: model emits text + a tool_use; that text must be streamed
    // live via onToken (the delta), not buffered until the final turn.
    mockStream
      .mockReturnValueOnce(
        makeTurn({
          text: "searching now",
          stopReason: "tool_use",
          toolUse: { id: "tu_1", name: "web_search", input: { query: "x" } },
        }),
      )
      .mockReturnValueOnce(
        makeTurn({ text: "Final answer.", stopReason: "end_turn" }),
      );

    const execute = vi.fn(async () => ({ ok: true, content: "hit" }));
    const onToken = vi.fn();
    const { executeCard } = await import("./llm.js");

    await executeCard(
      "prompt",
      "intent",
      [],
      false,
      onToken,
      [mockTool(execute)],
      3,
      vi.fn(),
    );

    // The first (tool_use) turn's text reached onToken live, not just the final turn.
    expect(onToken).toHaveBeenCalledWith("searching now");
    expect(onToken).toHaveBeenCalledWith("Final answer.");
  });

  it("passes the signed thinking block back unstripped on the next tool-loop turn (regression)", async () => {
    // Turn 1 finalMessage carries a thinking block + a tool_use; the assistant
    // message pushed for turn 2 must include that thinking block verbatim.
    const turn1Content = [
      { type: "thinking", thinking: "signed reasoning", signature: "sig" },
      { type: "text", text: "calling tool" },
      {
        type: "tool_use",
        id: "tu_1",
        name: "web_search",
        input: { query: "x" },
      },
    ];
    mockStream
      .mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "calling tool" },
          };
        },
        finalMessage: vi.fn().mockResolvedValue({
          stop_reason: "tool_use",
          content: turn1Content,
        }),
      })
      .mockReturnValueOnce(makeTurn({ text: "Done.", stopReason: "end_turn" }));

    const execute = vi.fn(async () => ({ ok: true, content: "hit" }));
    const { executeCard } = await import("./llm.js");
    await executeCard(
      "prompt",
      "intent",
      [],
      false,
      vi.fn(),
      [mockTool(execute)],
      3,
      vi.fn(),
    );

    // The SECOND stream call's messages must contain an assistant turn whose
    // content still includes the signed thinking block (not stripped).
    const secondCallMessages = mockStream.mock.calls[1][0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const assistantTurn = secondCallMessages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantTurn?.content).toEqual(turn1Content);
    expect(
      (assistantTurn?.content as Array<{ type: string }>).some(
        (b) => b.type === "thinking",
      ),
    ).toBe(true);
  });

  it("does not truncate the happy-path output (stop_reason !== max_tokens)", async () => {
    mockStream.mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "a long report" },
        };
      },
      finalMessage: vi.fn().mockResolvedValue({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "a long report" }],
      }),
    });

    const { executeCard } = await import("./llm.js");
    const result = await executeCard("prompt", "intent", [], false, vi.fn());
    // Budget asserts output headroom is preserved (OUTPUT_BUDGET=16384).
    expect(mockStream.mock.calls[0][0].max_tokens).toBe(24576);
    expect(result.output).toBe("a long report");
  });
});
