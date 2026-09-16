import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEEP_IMPORT_RULE_ID } from "./import-wall-rules.mjs";
import { LINE_BUDGET_RULE_ID } from "./line-budget.mjs";
import { PLACEMENT_RULE_ID } from "./placement.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJsonPath = join(repoRoot, "package.json");
const makefilePath = join(repoRoot, "Makefile");
const ciYamlPath = join(repoRoot, ".github/workflows/ci.yml");
const cliScript = join(repoRoot, "scripts/check-feature-modules.mjs");

/**
 * @param {number} n
 */
function makeLines(n) {
	return Array.from({ length: n }, (_, i) => `const line${i} = ${i};`).join(
		"\n",
	);
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(
		result.status,
		0,
		`git ${args.join(" ")} failed: ${result.stderr}`,
	);
	return result.stdout.trim();
}

/**
 * @param {string} dirPrefix
 * @param {(dir: string) => void} run
 */
function withTempGitRepo(dirPrefix, run) {
	const dir = mkdtempSync(join(repoRoot, dirPrefix));
	try {
		git(dir, ["init"]);
		git(dir, ["config", "user.email", "fm@test.local"]);
		git(dir, ["config", "user.name", "FM Test"]);
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("Cycle 1 — package.json scripts (unit)", () => {
	it("exposes check:feature-modules, test:feature-modules, and chains test:feature-modules in root test", () => {
		const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		const scripts = pkg.scripts ?? {};

		assert.equal(
			scripts["check:feature-modules"],
			"node scripts/check-feature-modules.mjs",
		);

		const testFm = scripts["test:feature-modules"];
		assert.ok(
			testFm,
			"test:feature-modules script must exist",
		);
		assert.match(
			testFm,
			/node --test scripts\/feature-modules\/.*\.test\.mjs/,
		);

		const rootTest = scripts.test ?? "";
		assert.match(
			rootTest,
			/npm run test --workspace=server && npm run test --workspace=client && npm run test:feature-modules$/,
		);
	});
});

describe("Cycle A — live guard scan count (integration)", () => {
	it("exits 0 on convention PR tree and reports a non-zero scan count", () => {
		const result = spawnSync(process.execPath, [cliScript], {
			cwd: repoRoot,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const combined = `${result.stdout}\n${result.stderr}`;
		const countMatch = combined.match(
			/(?:scanned-files|rules-evaluated|files-scanned)=(\d+)/,
		);
		assert.ok(countMatch, `expected scan count in stdout/stderr:\n${combined}`);
		assert.ok(Number(countMatch[1]) > 0, `scan count must be > 0, got ${countMatch[1]}`);
	});
});

describe("Cycle B — Makefile and CI (unit)", () => {
	it("Makefile check runs check:feature-modules beside check:mutation-routing", () => {
		const makefile = readFileSync(makefilePath, "utf8");
		assert.match(makefile, /check:mutation-routing/);
		assert.match(makefile, /check:feature-modules/);
		const checkRecipe = makefile.slice(makefile.indexOf("check:"));
		assert.match(checkRecipe, /check:mutation-routing/);
		assert.match(checkRecipe, /check:feature-modules/);
	});

	it("ci.yml primary job runs check:feature-modules beside mutation-routing with full checkout", () => {
		const ci = readFileSync(ciYamlPath, "utf8");
		const primaryBlock =
			ci.match(/^ {2}primary:\n([\s\S]*?)^ {2}db-integration:/m)?.[0] ?? "";
		assert.match(primaryBlock, /npm run check:mutation-routing/);
		assert.match(primaryBlock, /npm run check:feature-modules/);
		assert.match(primaryBlock, /fetch-depth:\s*0/);
	});
});

describe("Cycle C — CLI fail path with three rule ids (integration)", () => {
	it("exits 1 with placement, line-budget, and deep-import violations", () => {
		withTempGitRepo(".tmp-fm-wiring-cli-", (dir) => {
			writeFileSync(join(dir, "README.md"), "# base\n");
			git(dir, ["add", "README.md"]);
			git(dir, ["commit", "-m", "base"]);

			mkdirSync(join(dir, "server/src/routes"), { recursive: true });
			mkdirSync(join(dir, "server/src/modules/board"), { recursive: true });

			writeFileSync(
				join(dir, "server/src/routes/cards-update.ts"),
				"export {};\n",
			);

			const tooLongPath = "server/src/modules/board/too-long.ts";
			writeFileSync(join(dir, tooLongPath), makeLines(301));

			writeFileSync(join(dir, "server/src/modules/board/index.ts"), "export {};\n");
			writeFileSync(
				join(dir, "server/src/modules/board/cards-update.ts"),
				"export {};\n",
			);
			writeFileSync(
				join(dir, "server/src/routes/deep-import.ts"),
				`import { updateCard } from "../modules/board/cards-update.js";\n`,
			);

			git(dir, ["add", "."]);
			git(dir, ["commit", "-m", "three violations"]);

			const baseRef = git(dir, ["rev-parse", "HEAD~1"]);
			const result = spawnSync(
				process.execPath,
				[cliScript, "--base-ref", baseRef, "--root", dir],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 1, result.stdout || result.stderr);
			const combined = `${result.stdout}\n${result.stderr}`;

			assert.match(combined, new RegExp(PLACEMENT_RULE_ID));
			assert.match(combined, /server\/src\/routes\/cards-update\.ts/);

			assert.match(combined, new RegExp(LINE_BUDGET_RULE_ID));
			assert.match(combined, /server\/src\/modules\/board\/too-long\.ts/);
			assert.match(combined, /301/);

			assert.match(combined, new RegExp(DEEP_IMPORT_RULE_ID));
			assert.match(combined, /server\/src\/routes\/deep-import\.ts/);
			assert.match(combined, /cards-update\.js/);
		});
	});
});
