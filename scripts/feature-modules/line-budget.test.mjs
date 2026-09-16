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

import { collectGitDiff } from "./git-diff.mjs";
import {
	LINE_BUDGET_RULE_ID,
	checkLineBudget,
	collectLineBudgetViolations,
} from "./line-budget.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliScript = join(repoRoot, "scripts/check-feature-modules.mjs");

/**
 * @param {number} n
 * @param {boolean} [trailingNewline]
 */
function makeLines(n, trailingNewline = false) {
	const body = Array.from({ length: n }, (_, i) => `const line${i} = ${i};`).join(
		"\n",
	);
	return trailingNewline ? `${body}\n` : body;
}

/** Non-trivial handler body hunk (injected unified diff fragment). */
function handlerBodyHunk() {
	return [
		"@@ -42,3 +42,3 @@",
		" export function handle() {",
		"-  return oldLogic();",
		"+  return newLogic();",
		" }",
	].join("\n");
}

/**
 * @param {string} path
 * @param {number} lineCount
 */
function expectLineBudgetViolation(path, lineCount) {
	return (violations) => {
		assert.equal(violations.length, 1, violations.join("; "));
		assert.match(violations[0], new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ${LINE_BUDGET_RULE_ID}:`));
		assert.match(violations[0], new RegExp(String(lineCount)));
	};
}

describe("Cycle 1 — non-trivial oversized without shrink (unit)", () => {
	it("reports 300-on-touch when merge-base file is >300 and handler body changes without shrink", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = `${beforeText.slice(0, beforeText.indexOf("line42"))}const line42 = 42;\n${beforeText.slice(beforeText.indexOf("line43"))}`;

		const violations = checkLineBudget({
			path,
			status: "modified",
			beforeText,
			afterText,
			hunks: handlerBodyHunk(),
		});

		expectLineBudgetViolation(path, 999)(violations);
	});
});

describe("Cycle A — extract success (unit)", () => {
	it("passes when oversized before is non-trivially touched but afterText is ≤300 lines", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(280);

		const violations = checkLineBudget({
			path,
			status: "modified",
			beforeText,
			afterText,
			hunks: handlerBodyHunk(),
		});

		assert.deepEqual(violations, []);
	});
});

describe("Cycle B — new file 301 lines (unit)", () => {
	it("fails when status is new and afterText has 301 lines", () => {
		const path = "server/src/modules/board/cards-update.ts";
		const afterText = makeLines(301);

		const violations = checkLineBudget({
			path,
			status: "new",
			beforeText: "",
			afterText,
			hunks: "",
		});

		expectLineBudgetViolation(path, 301)(violations);
	});

	it("does not apply the 300 rule to an 800-line new test file", () => {
		const path = "server/src/modules/board/cards-update.test.ts";
		const afterText = makeLines(800);

		const violations = checkLineBudget({
			path,
			status: "new",
			beforeText: "",
			afterText,
			hunks: "",
		});

		assert.deepEqual(violations, []);
	});
});

describe("Cycle C — rename (unit)", () => {
	it("passes for pure rename with identical 521-line content", () => {
		const path = "server/src/modules/tracker/item-update.ts";
		const content = makeLines(521);

		const violations = checkLineBudget({
			path,
			status: "rename",
			beforeText: content,
			afterText: content,
			hunks: "",
			renameKind: "rename",
		});

		assert.deepEqual(violations, []);
	});

	it("fails when rename includes a body edit and result stays >300 lines", () => {
		const path = "server/src/modules/tracker/item-update.ts";
		const beforeText = makeLines(521);
		const afterText = `${beforeText}\n// extra logic touch`;

		const violations = checkLineBudget({
			path,
			status: "rename",
			beforeText,
			afterText,
			hunks: handlerBodyHunk(),
			renameKind: "rename-with-edit",
		});

		expectLineBudgetViolation(path, 522)(violations);
	});

	it("passes for C100 copy with 301-line content (same as pure rename)", () => {
		const path = "server/src/modules/board/cards-copy.ts";
		const content = makeLines(301);

		const violations = checkLineBudget({
			path,
			status: "rename",
			beforeText: content,
			afterText: content,
			hunks: "",
			renameKind: "rename",
		});

		assert.deepEqual(violations, []);
	});

	it("fails when C<100 copy-with-edit keeps destination >300 lines", () => {
		const path = "server/src/routes/copied.ts";
		const beforeText = makeLines(521);
		const afterText = `${beforeText}\n// copy edit touch`;

		const violations = checkLineBudget({
			path,
			status: "rename",
			beforeText,
			afterText,
			hunks: handlerBodyHunk(),
			renameKind: "rename-with-edit",
		});

		expectLineBudgetViolation(path, 522)(violations);
	});
});

describe("Cycle D — non-touches (unit)", () => {
	it("passes for whitespace/format-only hunks on a 492-line file", () => {
		const path = "client/src/context/BoardContext.tsx";
		const beforeText = makeLines(492);
		const afterText = beforeText.replace(/\s+/g, " ");

		const hunks = [
			"@@ -1,3 +1,3 @@",
			"-const  line0  =  0;",
			"+const line0 = 0;",
		].join("\n");

		const violations = checkLineBudget({
			path,
			status: "modified",
			beforeText,
			afterText,
			hunks,
		});

		assert.deepEqual(violations, []);
	});

	it("passes for import-specifier-only hunks on a 999-line file", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = `${makeLines(998)}\nimport { oldHelper } from "./old-path.js";`;
		const afterText = `${makeLines(998)}\nimport { oldHelper } from "../modules/board/old-path.js";`;

		const hunks = [
			"@@ -999,1 +999,1 @@",
			'-import { oldHelper } from "./old-path.js";',
			'+import { oldHelper } from "../modules/board/old-path.js";',
		].join("\n");

		const violations = checkLineBudget({
			path,
			status: "modified",
			beforeText,
			afterText,
			hunks,
		});

		assert.deepEqual(violations, []);
	});
});

describe("Cycle E — exemption negatives and edges (unit)", () => {
	it("treats mixed import-specifier and body change as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = `${beforeText}\n// body touch`;

		const hunks = [
			"@@ -1,2 +1,2 @@",
			'-import { x } from "./a.js";',
			'+import { x } from "./b.js";',
			"@@ -50,1 +50,2 @@",
			"+// body touch",
		].join("\n");

		const violations = checkLineBudget({
			path,
			status: "modified",
			beforeText,
			afterText,
			hunks,
		});

		expectLineBudgetViolation(path, 1000)(violations);
	});

	it("treats new import plus new call site as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = `${beforeText}\nimport { z } from "./z.js";\nz();`;

		const hunks = [
			"@@ -999,0 +999,2 @@",
			'+import { z } from "./z.js";',
			"+z();",
		].join("\n");

		const violations = checkLineBudget({
			path,
			status: "modified",
			beforeText,
			afterText,
			hunks,
		});

		expectLineBudgetViolation(path, 1001)(violations);
	});

	it("treats comment-only change as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = beforeText.replace("line500", "line500 // note");

		const hunks = [
			"@@ -500,1 +500,1 @@",
			"-const line500 = 500;",
			"+const line500 = 500; // note",
		].join("\n");

		const violations = checkLineBudget({
			path,
			status: "modified",
			beforeText,
			afterText,
			hunks,
		});

		expectLineBudgetViolation(path, 999)(violations);
	});

	it("passes when afterText has exactly 300 lines", () => {
		const path = "server/src/modules/board/small.ts";
		const afterText = makeLines(300);

		const violations = checkLineBudget({
			path,
			status: "new",
			beforeText: "",
			afterText,
			hunks: "",
		});

		assert.deepEqual(violations, []);
	});

	it("fails when afterText has 301 lines with no trailing newline", () => {
		const path = "server/src/modules/board/big.ts";
		const afterText = makeLines(301, false);

		const violations = checkLineBudget({
			path,
			status: "new",
			beforeText: "",
			afterText,
			hunks: "",
		});

		expectLineBudgetViolation(path, 301)(violations);
	});

	it("does not apply the 300 rule to generated paths", () => {
		for (const path of [
			"client/src/features/board/types.generated.ts",
			"client/src/features/board/types.generated.tsx",
			"client/src/generated/foo.ts",
		]) {
			const violations = checkLineBudget({
				path,
				status: "new",
				beforeText: "",
				afterText: makeLines(400),
				hunks: "",
			});
			assert.deepEqual(violations, [], path);
		}
	});
});

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

describe("Cycle F — hunk producer + CLI grandfather (integration)", () => {
	it("classifies whitespace-only and import-only edits via real git hunks", () => {
		withTempGitRepo(".tmp-fm-line-budget-git-", (dir) => {
			const bigPath = "server/src/routes/cards.ts";
			const bigContent = `${makeLines(998)}\nimport { oldHelper } from "./old-path.js";`;
			mkdirSync(join(dir, "server/src/routes"), { recursive: true });
			writeFileSync(join(dir, bigPath), bigContent);
			git(dir, ["add", bigPath]);
			git(dir, ["commit", "-m", "base"]);

			writeFileSync(
				join(dir, bigPath),
				`${makeLines(998)}\nimport { oldHelper } from "../modules/board/old-path.js";`,
			);
			git(dir, ["add", bigPath]);
			git(dir, ["commit", "-m", "import-only"]);

			const baseRef = git(dir, ["rev-parse", "HEAD~1"]);
			const diff = collectGitDiff(dir, baseRef);
			const violations = collectLineBudgetViolations({
				rootDir: dir,
				baseRef,
				diff,
			});
			assert.deepEqual(violations, []);
		});
	});

	it("does not invent a touch for unmodified BoardContext-sized grandfather file", () => {
		withTempGitRepo(".tmp-fm-line-budget-board-", (dir) => {
			writeFileSync(join(dir, "README.md"), "# base\n");
			git(dir, ["add", "README.md"]);
			git(dir, ["commit", "-m", "base"]);

			const baseRef = git(dir, ["rev-parse", "HEAD"]);
			const result = spawnSync(
				process.execPath,
				[cliScript, "--base-ref", baseRef, "--root", dir],
				{ encoding: "utf8" },
			);
			assert.equal(result.status, 0, result.stderr || result.stdout);
		});
	});
});

describe("Cycle G — CLI exit 1 for 300 (integration)", () => {
	it("exits 1 with rule id, path, and line count for a new 301-line module file", () => {
		withTempGitRepo(".tmp-fm-line-budget-cli-", (dir) => {
			writeFileSync(join(dir, "README.md"), "# base\n");
			git(dir, ["add", "README.md"]);
			git(dir, ["commit", "-m", "base"]);

			mkdirSync(join(dir, "server/src/modules/board"), { recursive: true });
			const path = "server/src/modules/board/cards-update.ts";
			writeFileSync(join(dir, path), makeLines(301));
			git(dir, ["add", path]);
			git(dir, ["commit", "-m", "too big"]);

			const baseRef = git(dir, ["rev-parse", "HEAD~1"]);
			const result = spawnSync(
				process.execPath,
				[cliScript, "--base-ref", baseRef, "--root", dir],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 1, result.stdout || result.stderr);
			const combined = `${result.stdout}\n${result.stderr}`;
			assert.match(combined, new RegExp(LINE_BUDGET_RULE_ID));
			assert.match(combined, /server\/src\/modules\/board\/cards-update\.ts/);
			assert.match(combined, /301/);
		});
	});
});
