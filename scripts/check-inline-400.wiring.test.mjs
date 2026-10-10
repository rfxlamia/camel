import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = (path) => readFileSync(join(repoRoot, path), "utf8");

describe("inline 400 guard wiring (unit)", () => {
	it("runs the guard through npm scripts, make check, CI, and request-validation guidance", () => {
		const pkg = JSON.parse(readRepoFile("package.json"));
		const scripts = pkg.scripts ?? {};

		assert.equal(
			scripts["check:inline-400"],
			"node scripts/check-inline-400.mjs",
		);
		assert.equal(scripts["test:guards"], "node --test scripts/*.test.mjs");
		assert.match(
			scripts.test ?? "",
			/npm run test:guards && npm run test --workspace=server && npm run test --workspace=client && npm run test:feature-modules$/,
		);

		const makefile = readRepoFile("Makefile");
		const checkRecipe = makefile.match(/^check:.*(?:\n\t.*)*/m)?.[0] ?? "";
		assert.match(checkRecipe, /\$\(NPM\) run check:inline-400/);

		const ci = readRepoFile(".github/workflows/ci.yml");
		const primaryBlock =
			ci.match(/^ {2}primary:\n([\s\S]*?)^ {2}db-integration:/m)?.[0] ?? "";
		assert.match(primaryBlock, /- run: npm run check:inline-400/);

		const claude = readRepoFile("CLAUDE.md");
		const requestValidationParagraph =
			claude.match(/^\*\*Request validation[^\n]*/m)?.[0] ?? "";
		assert.match(requestValidationParagraph, /check:inline-400/);
	});
});
