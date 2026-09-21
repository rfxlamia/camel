import { describe, expect, it } from "vitest";
import {
	buildVarsMap,
	findUnresolvedPlaceholders,
	getTemplate,
	RESEARCH_REPORT_COLUMNS,
	renderSystemPrompt,
} from "./templates.js";

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
		const reasoningSlugs = t!.columns
			.filter((c) => c.reasoning)
			.map((c) => c.slug);
		expect(reasoningSlugs).toContain("analysis-specialist");
		expect(reasoningSlugs).toContain("qa-guardian");
	});

	it("returns null for unknown template id", () => {
		expect(getTemplate("nonexistent")).toBeNull();
	});
});

describe("renderSystemPrompt", () => {
	it("substitutes {original_intent} with the provided value", () => {
		const out = renderSystemPrompt(
			"The user has requested: {original_intent}",
			{
				original_intent: "riset kompetitor fintech",
			},
		);
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
		expect(
			findUnresolvedPlaceholders("hello world, no placeholders here"),
		).toEqual([]);
	});

	it("returns the unresolved placeholder when a typo key remains", () => {
		expect(findUnresolvedPlaceholders("prompt {reserch_output} done")).toEqual([
			"{reserch_output}",
		]);
	});

	it("returns all unresolved placeholders when multiple remain", () => {
		expect(findUnresolvedPlaceholders("{a} text {b_c}")).toEqual([
			"{a}",
			"{b_c}",
		]);
	});
});

describe("research-report template tool assignment", () => {
	const template = getTemplate("research-report")!;
	const bySlug = (slug: string) =>
		template.columns.find((c) => c.slug === slug)!;

	it("gives the research-specialist column web_search", () => {
		expect(bySlug("research-specialist").tools).toEqual(["web_search"]);
	});
	it("gives non-research columns no tools", () => {
		expect(bySlug("editor").tools ?? []).toEqual([]);
		expect(bySlug("writer").tools ?? []).toEqual([]);
		expect(bySlug("analysis-specialist").tools ?? []).toEqual([]);
		expect(bySlug("qa-guardian").tools ?? []).toEqual(["create_file"]);
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

describe("status-report template", () => {
	it("returns exactly 2 columns: Analyst then QA/Persist", () => {
		const t = getTemplate("status-report");
		expect(t).not.toBeNull();
		expect(t!.columns).toHaveLength(2);
		expect(t!.columns.map((c) => c.slug)).toEqual(["analyst", "qa-guardian"]);
	});

	it("Analyst column uses query_board_data + editor_output under ## Revised Document", () => {
		const t = getTemplate("status-report")!;
		const analyst = t.columns[0];
		expect(analyst.tools).toEqual(["query_board_data"]);
		expect(analyst.reasoning).toBe(true);
		expect(analyst.output_key).toBe("editor_output");
		expect(analyst.system_prompt).toContain("## Revised Document");
	});

	it("Analyst prompt encodes honesty rules + the on-track objective (substrings only)", () => {
		const analyst = getTemplate("status-report")!.columns[0];
		const prompt = analyst.system_prompt;
		expect(prompt).toMatch(/not yet measurable/i);
		expect(prompt).toMatch(/insufficient/i);
		expect(prompt).toMatch(/on track/i);
	});

	it("QA column persists via create_file and emits a parseQaVerdict-compatible Status line", () => {
		const qa = getTemplate("status-report")!.columns[1];
		expect(qa.tools).toEqual(["create_file"]);
		expect(qa.system_prompt).toMatch(/PASS/);
		expect(qa.system_prompt).toMatch(/NEEDS REVISION/);
	});
});
