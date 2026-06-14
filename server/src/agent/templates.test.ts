import { describe, it, expect } from "vitest";
import { TEMPLATES, getTemplate, renderSystemPrompt } from "./templates.js";

describe("Research & Report template", () => {
  it("has exactly 5 columns in order", () => {
    const t = getTemplate("research-report");
    expect(t).not.toBeNull();
    expect(t!.columns).toHaveLength(5);
    expect(t!.columns.map((c) => c.slug)).toEqual([
      "research-specialist",
      "analysis-specialist",
      "writer",
      "editor",
      "qa-guardian",
    ]);
  });

  it("last column is always QA Guardian", () => {
    const t = getTemplate("research-report");
    expect(t!.columns[t!.columns.length - 1].slug).toBe("qa-guardian");
  });

  it("each column has a non-empty system_prompt", () => {
    const t = getTemplate("research-report");
    t!.columns.forEach((col) => {
      expect(col.system_prompt.length).toBeGreaterThan(50);
    });
  });

  it("analysis-specialist and qa-guardian have reasoning=true", () => {
    const t = getTemplate("research-report");
    const reasoningSlugs = t!.columns.filter((c) => c.reasoning).map((c) => c.slug);
    expect(reasoningSlugs).toContain("analysis-specialist");
    expect(reasoningSlugs).toContain("qa-guardian");
  });

  it("returns null for unknown template id", () => {
    expect(getTemplate("nonexistent")).toBeNull();
  });
});

describe("renderSystemPrompt", () => {
  it("substitutes {original_intent} with the provided value", () => {
    const out = renderSystemPrompt("The user has requested: {original_intent}", {
      original_intent: "riset kompetitor fintech",
    });
    expect(out).toBe("The user has requested: riset kompetitor fintech");
    expect(out).not.toMatch(/\{original_intent\}/);
  });

  it("leaves unfilled placeholders intact (Phase 2 tokens)", () => {
    const out = renderSystemPrompt("{original_intent} / {previous_output}", {
      original_intent: "x",
    });
    expect(out).toBe("x / {previous_output}");
  });
});
