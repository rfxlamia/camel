import { describe, it, expect, vi } from "vitest";
import { createToolRegistry, toAnthropicToolDefs } from "./registry.js";
import type { Tool } from "./types.js";

const mockTool: Tool = {
  name: "web_search",
  description: "Search the web",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  riskTier: "read-only",
  execute: vi.fn(async () => ({ ok: true, content: "result" })),
};

describe("createToolRegistry.resolveTools", () => {
  it("resolves a known tool name to its definition", () => {
    const registry = createToolRegistry([mockTool]);
    expect(registry.resolveTools(["web_search"])).toEqual([mockTool]);
  });
  it("drops unknown tool names without throwing", () => {
    const registry = createToolRegistry([mockTool]);
    expect(registry.resolveTools(["web_search", "nope"])).toEqual([mockTool]);
  });
  it("returns [] for an empty name list", () => {
    const registry = createToolRegistry([mockTool]);
    expect(registry.resolveTools([])).toEqual([]);
  });
});

describe("toAnthropicToolDefs", () => {
  it("maps each Tool to {name, description, input_schema}", () => {
    expect(toAnthropicToolDefs([mockTool])).toEqual([
      { name: "web_search", description: "Search the web", input_schema: mockTool.inputSchema },
    ]);
  });
  it("does not leak execute/riskTier into the Anthropic def", () => {
    const [def] = toAnthropicToolDefs([mockTool]);
    expect(def).not.toHaveProperty("execute");
    expect(def).not.toHaveProperty("riskTier");
    expect(def).not.toHaveProperty("inputSchema");
  });
});
