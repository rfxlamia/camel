import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSearch = vi.fn();
vi.mock("@tavily/core", () => ({
  tavily: vi.fn(() => ({ search: mockSearch })),
}));

function makeResults(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Title ${i}`,
    url: `https://example.com/${i}`,
    content: "x".repeat(1000),
  }));
}

describe("web_search tool", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    process.env.TAVILY_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.TAVILY_API_KEY;
  });

  it("caps to ≤10 results and size-caps each snippet (R2/R8)", async () => {
    mockSearch.mockResolvedValueOnce({ results: makeResults(12) });
    const { webSearch } = await import("./webSearch.js");
    const result = await webSearch.execute({ query: "fintech" });

    expect(result.ok).toBe(true);
    expect(mockSearch).toHaveBeenCalledWith(
      "fintech",
      expect.objectContaining({ maxResults: 10 }),
    );
    const matches = result.content.match(/https:\/\/example\.com\//g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(10);
    expect(result.content).not.toContain("x".repeat(1000));
  });

  it("retries a transient network error then succeeds (R3)", async () => {
    mockSearch
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ results: makeResults(1) });
    const { webSearch } = await import("./webSearch.js");
    const result = await webSearch.execute({ query: "fintech" });

    expect(result.ok).toBe(true);
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it("returns ENV_VAR_MISSING without calling Tavily when key unset (R3)", async () => {
    delete process.env.TAVILY_API_KEY;
    const { webSearch } = await import("./webSearch.js");
    const result = await webSearch.execute({ query: "fintech" });

    expect(result).toMatchObject({ ok: false, errorCode: "ENV_VAR_MISSING" });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("returns RATE_LIMIT after exhausting retries (R3)", async () => {
    mockSearch.mockRejectedValue(new Error("Rate limit exceeded"));
    const { webSearch } = await import("./webSearch.js");
    const result = await webSearch.execute({ query: "fintech" });

    expect(result).toMatchObject({ ok: false, errorCode: "RATE_LIMIT" });
    expect(mockSearch).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry an auth error (API_ERROR)", async () => {
    mockSearch.mockRejectedValue(new Error("Invalid API key"));
    const { webSearch } = await import("./webSearch.js");
    const result = await webSearch.execute({ query: "fintech" });

    expect(result).toMatchObject({ ok: false, errorCode: "API_ERROR" });
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it("reports a friendly message on empty results (R7)", async () => {
    mockSearch.mockResolvedValueOnce({ results: [] });
    const { webSearch } = await import("./webSearch.js");
    const result = await webSearch.execute({ query: "obscure topic" });

    expect(result.ok).toBe(true);
    expect(result.content.toLowerCase()).toContain("no results found");
    expect(result.content).toContain("obscure topic");
  });

  it("never throws — any failure surfaces as a structured result", async () => {
    mockSearch.mockRejectedValue(new Error("something weird"));
    const { webSearch } = await import("./webSearch.js");
    await expect(webSearch.execute({ query: "x" })).resolves.toMatchObject({
      ok: false,
    });
  });
});
