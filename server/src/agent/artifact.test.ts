import { describe, expect, it } from "vitest";
import {
	deriveFilename,
	extractRevisedDocument,
	MAX_ARTIFACT_BYTES,
	parseQaVerdict,
} from "./artifact.js";

describe("deriveFilename", () => {
	it("slugifies the first H1 heading", () => {
		const content = "# Mengapa Thailand Memiliki Komunitas Transgender\nBody";
		expect(deriveFilename(content, "riset thailand")).toBe(
			"mengapa-thailand-memiliki-komunitas-transgender.md",
		);
	});

	it("falls back to slug(intent) when no H1 is present", () => {
		expect(deriveFilename("Body with no heading", "riset thailand")).toBe(
			"riset-thailand.md",
		);
	});

	it("falls back to deliverable.md when no H1 and empty intent", () => {
		expect(deriveFilename("Body with no heading", "")).toBe("deliverable.md");
	});

	it("caps the slug at 80 chars before the .md suffix", () => {
		const long = `# ${"a".repeat(200)}`;
		const name = deriveFilename(long, "x");
		expect(name.endsWith(".md")).toBe(true);
		expect(name.length - ".md".length).toBeLessThanOrEqual(80);
	});
});

describe("extractRevisedDocument", () => {
	it("returns the trimmed body after the Revised Document heading", () => {
		const input =
			"## Editorial Notes\n- note\n\n---\n\n## Revised Document\n# Title\nBody";
		expect(extractRevisedDocument(input)).toBe("# Title\nBody");
	});

	it("strips the trailing handoff footer from real editor output", () => {
		const input =
			"## Editorial Notes\n- note\n\n---\n\n## Revised Document\n# Title\nBody\n\n---\n*Handoff: Ready for QA Guardian.*";
		expect(extractRevisedDocument(input)).toBe("# Title\nBody");
	});

	it("strips a leading Editorial Notes block when the heading is absent", () => {
		const input = "## Editorial Notes\n- note\n\n---\n\n# Title\nBody";
		expect(extractRevisedDocument(input)).toBe("# Title\nBody");
	});

	it("returns the whole input when neither marker is present", () => {
		const input = "# Title\nJust a plain document";
		expect(extractRevisedDocument(input)).toBe(input);
	});

	it("never returns empty for non-empty input", () => {
		expect(extractRevisedDocument("plain body").length).toBeGreaterThan(0);
	});
});

describe("parseQaVerdict", () => {
	it("parses a labelled PASS status", () => {
		expect(parseQaVerdict("**Status:** PASS\nLooks good.")).toBe("pass");
	});

	it("parses a labelled NEEDS REVISION status", () => {
		expect(parseQaVerdict("**Status:** NEEDS REVISION\nFix intro.")).toBe(
			"needs_revision",
		);
	});

	it("returns unknown when no labelled Status line exists (substring trap)", () => {
		expect(parseQaVerdict("the document passes every check")).toBe("unknown");
	});

	it("exports a positive byte cap", () => {
		expect(MAX_ARTIFACT_BYTES).toBeGreaterThan(0);
	});
});
