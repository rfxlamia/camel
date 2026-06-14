import { describe, expect, it } from "vitest";
import {
  buildVarsMap,
  findUnresolvedPlaceholders,
  RESEARCH_REPORT_COLUMNS,
} from "./templates.js";

describe("buildVarsMap", () => {
  it("includes all three built-in keys when accumulator is empty", () => {
    const result = buildVarsMap("my intent", "prev output", {});
    expect(result).toEqual({
      original_intent: "my intent",
      topic: "my intent",
      previous_output: "prev output",
    });
  });

  it("merges a named accumulator key alongside the built-ins", () => {
    const result = buildVarsMap("intent", "prev", {
      research_output: "BRIEF",
    });
    expect(result.research_output).toBe("BRIEF");
    expect(result.original_intent).toBe("intent");
    expect(result.topic).toBe("intent");
    expect(result.previous_output).toBe("prev");
  });

  it("merges multiple named accumulator keys (multi-predecessor support)", () => {
    const result = buildVarsMap("intent", "prev", {
      research_output: "A",
      analysis_output: "B",
    });
    expect(result.research_output).toBe("A");
    expect(result.analysis_output).toBe("B");
    expect(result.original_intent).toBe("intent");
  });

  it("built-ins always override accumulator keys with the same name", () => {
    const result = buildVarsMap("real intent", "real prev", {
      original_intent: "hijack",
      previous_output: "also hijack",
      topic: "also hijack",
    });
    expect(result.original_intent).toBe("real intent");
    expect(result.previous_output).toBe("real prev");
    expect(result.topic).toBe("real intent");
  });
});

describe("findUnresolvedPlaceholders", () => {
  it("returns an empty array for a fully-resolved string", () => {
    expect(findUnresolvedPlaceholders("hello world, no placeholders here")).toEqual([]);
  });

  it("returns the unresolved placeholder when a typo key remains", () => {
    expect(findUnresolvedPlaceholders("prompt {reserch_output} done")).toEqual([
      "{reserch_output}",
    ]);
  });

  it("returns all unresolved placeholders when multiple remain", () => {
    expect(findUnresolvedPlaceholders("{a} text {b_c}")).toEqual(["{a}", "{b_c}"]);
  });
});

describe("RESEARCH_REPORT_COLUMNS", () => {
  it("every column has a non-empty output_key", () => {
    for (const column of RESEARCH_REPORT_COLUMNS) {
      expect(
        column.output_key,
        `column '${column.slug}' is missing output_key`,
      ).toBeTruthy();
      expect(typeof column.output_key).toBe("string");
      expect((column.output_key as string).length).toBeGreaterThan(0);
    }
  });
});
