import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return sourceFiles(full);
		return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
	});
}

describe("module boundaries", () => {
	// agent -> chat plus chat -> agent was an import cycle (#182). The shared
	// LLM runner lives in lib/llm; chat may depend on agent tools, never the
	// other way round.
	it("agent sources never import the chat module", () => {
		const offenders = sourceFiles(AGENT_DIR).filter((file) =>
			/from\s+["'][^"']*\/chat(\/|["'])/.test(readFileSync(file, "utf8")),
		);
		expect(offenders).toEqual([]);
	});
});
