import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { collectGitDiff } from "./git-diff.mjs";
import {
	checkLineBudget,
	collectLineBudgetViolations,
	isNonTrivialTouch,
	LINE_BUDGET_RULE_ID,
} from "./line-budget.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliScript = join(repoRoot, "scripts/check-feature-modules.mjs");

/**
 * @param {number} n
 * @param {boolean} [trailingNewline]
 */
function makeLines(n, trailingNewline = false) {
	const body = Array.from(
		{ length: n },
		(_, i) => `const line${i} = ${i};`,
	).join("\n");
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
		assert.match(
			violations[0],
			new RegExp(
				`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ${LINE_BUDGET_RULE_ID}:`,
			),
		);
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

	it("passes for a multiline from-path-only change on a 999-line file", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);
		const hunks = [
			"@@ -12,1 +12,1 @@",
			'-} from "./old-path.js";',
			'+} from "../modules/board/old-path.js";',
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

describe("Cycle H — import reorder (unit)", () => {
	it("passes for reorder-only import hunks on a 999-line file", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,2 +1,2 @@",
			'-import { b } from "./b.js";',
			'-import { a } from "./a.js";',
			'+import { a } from "./a.js";',
			'+import { b } from "./b.js";',
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

	it("passes for reorder plus specifier-swap hunks on a 999-line file", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,2 +1,2 @@",
			'-import { b } from "./old.js";',
			'-import { a } from "./a.js";',
			'+import { a } from "./a.js";',
			'+import { b } from "./new.js";',
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

	it("treats reordered imports with a binding change as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,2 +1,2 @@",
			'-import { b } from "./b.js";',
			'-import { a } from "./a.js";',
			'+import { a } from "./a.js";',
			'+import { c } from "./b.js";',
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
});

describe("Cycle I — intra-line binding order (unit)", () => {
	it("passes for same-set binding reorder within one import line on a 999-line file", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,1 +1,1 @@",
			'-import { sql, type Selectable } from "kysely";',
			'+import { type Selectable, sql } from "kysely";',
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

	it("treats binding add within one import line as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,1 +1,1 @@",
			'-import { sql } from "kysely";',
			'+import { type Selectable, sql } from "kysely";',
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

	it("treats binding remove within one import line as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,1 +1,1 @@",
			'-import { type Selectable, sql } from "kysely";',
			'+import { sql } from "kysely";',
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
});

describe("Cycle J — barrel consolidation (unit)", () => {
	it("passes when N leaf imports merge into one barrel import with the identical binding set", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -9,4 +9,5 @@",
			'-import { config } from "../config.js";',
			'+import { config } from "../../config.js";',
			'-import type { Tool, ToolEvent } from "../agent/tools/types.js";',
			'+import type { Tool, ToolEvent } from "../agent/index.js";',
			'-import { toAnthropicToolDefs } from "../agent/tools/registry.js";',
			'-import { countSearchResults } from "../agent/tools/trace.js";',
			"+import {",
			"+\tcountSearchResults,",
			"+\ttoAnthropicToolDefs,",
			'+} from "../agent/index.js";',
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

	it("treats barrel consolidation with a binding add as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,2 +1,1 @@",
			'-import { a } from "./a.js";',
			'-import { b } from "./b.js";',
			'+import { a, b, c } from "./barrel.js";',
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

	it("treats barrel consolidation with a binding remove as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,2 +1,1 @@",
			'-import { a } from "./a.js";',
			'-import { b } from "./b.js";',
			'+import { a } from "./barrel.js";',
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
});

describe("Cycle K — rewrap/reflow (unit)", () => {
	it("passes for a rewrap-only hunk with identical tokens on a 999-line file", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -42,2 +42,1 @@",
			"-  const text = userMessageText ??",
			'-    history.find((m) => m.role === "user")?.content;',
			'+  const text = userMessageText ?? history.find((m) => m.role === "user")?.content;',
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

	it("treats rewrap plus one identifier change as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -42,2 +42,1 @@",
			"-  const text = userMessageText ??",
			'-    history.find((m) => m.role === "user")?.content;',
			'+  const text = userMessageText ?? archive.find((m) => m.role === "user")?.content;',
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

	it("treats rewrap plus string-content change as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -42,2 +42,1 @@",
			"-  const text = userMessageText ??",
			'-    history.find((m) => m.role === "user")?.content;',
			'+  const text = userMessageText ?? history.find((m) => m.role === "assistant")?.content;',
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

	it("passes for a T8 signature/method-chain/?? rewrap with identical tokens on a 999-line file", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -10,7 +10,2 @@",
			"-  function format(",
			"-    messages: Item[],",
			"-  ): string {",
			"-    return items",
			"-      .filter((m) => m.ok)",
			"-      .map((m) => m.label ??",
			"-        fallback);",
			"+  function format(messages: Item[]): string {",
			"+    return items.filter((m) => m.ok).map((m) => m.label ?? fallback);",
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

	it("treats T8 signature/method-chain/?? rewrap with one identifier change as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -10,7 +10,2 @@",
			"-  function format(",
			"-    messages: Item[],",
			"-  ): string {",
			"-    return items",
			"-      .filter((m) => m.ok)",
			"-      .map((m) => m.label ??",
			"-        fallback);",
			"+  function format(messages: Item[]): string {",
			"+    return items.filter((m) => m.ok).map((m) => m.label ?? other);",
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
});

describe("Cycle L — mixed import-retarget plus body-rewrap (unit)", () => {
	it("passes for a mixed import-retarget plus body-rewrap hunk on a 999-line file", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,1 +1,1 @@",
			'-import { x } from "./a.js";',
			'+import { x } from "./b.js";',
			"@@ -42,2 +42,1 @@",
			"-  const text = userMessageText ??",
			'-    history.find((m) => m.role === "user")?.content;',
			'+  const text = userMessageText ?? history.find((m) => m.role === "user")?.content;',
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

	it("treats mixed import-retarget plus rewrap with one identifier change as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,1 +1,1 @@",
			'-import { x } from "./a.js";',
			'+import { x } from "./b.js";',
			"@@ -42,2 +42,1 @@",
			"-  const text = userMessageText ??",
			'-    history.find((m) => m.role === "user")?.content;',
			'+  const text = userMessageText ?? archive.find((m) => m.role === "user")?.content;',
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

	it("treats mixed import-retarget plus rewrap with string-content change as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);

		const hunks = [
			"@@ -1,1 +1,1 @@",
			'-import { x } from "./a.js";',
			'+import { x } from "./b.js";',
			"@@ -42,2 +42,1 @@",
			"-  const text = userMessageText ??",
			'-    history.find((m) => m.role === "user")?.content;',
			'+  const text = userMessageText ?? history.find((m) => m.role === "assistant")?.content;',
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
});

describe("Review regressions — import classification (unit)", () => {
	it("treats reordered function arguments as a non-trivial touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);
		const hunks = [
			"@@ -20,2 +20,2 @@",
			"-\tfirstArg,",
			"-\tsecondArg,",
			"+\tsecondArg,",
			"+\tfirstArg,",
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

	it("does not let an import binding name exempt an unrelated argument reorder", () => {
		const hunk = [
			"@@ -1,1 +1,1 @@",
			'-import { firstArg, secondArg } from "./old.js";',
			'+import { firstArg, secondArg } from "./new.js";',
			"@@ -20,2 +20,2 @@",
			"-\tfirstArg,",
			"-\tsecondArg,",
			"+\tsecondArg,",
			"+\tfirstArg,",
		].join("\n");

		assert.equal(isNonTrivialTouch(hunk), true);
	});

	it("does not ignore type modifiers in multiline import bindings", () => {
		const hunk = [
			"@@ -20,4 +20,4 @@",
			" import {",
			"-\ttype Foo,",
			"+\tFoo,",
			' } from "./module.js";',
		].join("\n");

		assert.equal(isNonTrivialTouch(hunk), true);
	});

	it("keeps reordered bindings inside an active import declaration exempt", () => {
		const hunk = [
			"@@ -20,5 +20,5 @@",
			" import {",
			"-\tfirstArg,",
			"-\tsecondArg,",
			"+\tsecondArg,",
			"+\tfirstArg,",
			' } from "./module.js";',
		].join("\n");

		assert.equal(isNonTrivialTouch(hunk), false);
	});

	it("treats a return line terminator as a non-trivial touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);
		const hunks = [
			"@@ -20,2 +20,1 @@",
			"-return",
			"-{ ok: true };",
			"+return { ok: true };",
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

	it("treats moving code across a line comment as a non-trivial touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);
		const hunks = [
			"@@ -20,2 +20,2 @@",
			"-foo(); // call foo",
			"-bar();",
			"+foo();",
			"+// call foo bar();",
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

	it("preserves whitespace inside string literals", () => {
		const hunk = [
			"@@ -20,1 +20,1 @@",
			'-const value = "a  b";',
			'+const value = "a b";',
		].join("\n");

		assert.equal(isNonTrivialTouch(hunk), true);
	});

	it("preserves whitespace inside template literals", () => {
		const hunk = [
			"@@ -20,1 +20,1 @@",
			"-const value = `a  b`;",
			"+const value = `a b`;",
		].join("\n");

		assert.equal(isNonTrivialTouch(hunk), true);
	});

	it("preserves empty array elisions", () => {
		const hunk = [
			"@@ -20,1 +20,1 @@",
			"-const value = [];",
			"+const value = [,];",
		].join("\n");

		assert.equal(isNonTrivialTouch(hunk), true);
	});

	it("preserves repeated array elisions", () => {
		const hunk = [
			"@@ -20,1 +20,1 @@",
			"-const value = [,];",
			"+const value = [,,];",
		].join("\n");

		assert.equal(isNonTrivialTouch(hunk), true);
	});

	it("preserves whitespace inside regular-expression literals", () => {
		const hunk = [
			"@@ -20,1 +20,1 @@",
			"-const pattern = /^ $/;",
			"+const pattern = /^$/;",
		].join("\n");

		assert.equal(isNonTrivialTouch(hunk), true);
	});

	it("preserves side-effect import statements", () => {
		const hunk = ["@@ -20,1 +20,0 @@", '-import "./polyfill.js";'].join("\n");

		assert.equal(isNonTrivialTouch(hunk), true);
	});

	it("preserves export-star statements", () => {
		const hunk = ["@@ -20,1 +20,0 @@", '-export * from "./module.js";'].join(
			"\n",
		);

		assert.equal(isNonTrivialTouch(hunk), true);
	});

	it("preserves type-only versus value default imports", () => {
		const hunk = [
			"@@ -20,1 +20,1 @@",
			'-import type Foo from "./old.js";',
			'+import Foo from "./new.js";',
		].join("\n");

		assert.equal(isNonTrivialTouch(hunk), true);
	});
});

describe("Cycle E — exemption negatives and edges (unit)", () => {
	it("treats +++/--- source lines inside a hunk as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);
		const hunks = [
			"--- a/server/src/routes/cards.ts",
			"+++ b/server/src/routes/cards.ts",
			"@@ -42,1 +42,1 @@",
			"----counter;",
			"++++counter;",
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

	it("treats an import binding rename as a touch", () => {
		const path = "server/src/routes/cards.ts";
		const beforeText = makeLines(999);
		const afterText = makeLines(999);
		const hunks = [
			"@@ -1,1 +1,1 @@",
			'-import { oldHelper } from "./old-path.js";',
			'+import { newHelper } from "./old-path.js";',
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

	it("fails C<100 copy-with-edit via collectLineBudgetViolations when source hunks are empty", () => {
		withTempGitRepo(".tmp-fm-line-budget-copy-edit-", (dir) => {
			const fromPath = "server/src/routes/copy-src.ts";
			const toPath = "server/src/modules/board/copied.ts";
			mkdirSync(join(dir, "server/src/routes"), { recursive: true });
			mkdirSync(join(dir, "server/src/modules/board"), { recursive: true });
			writeFileSync(join(dir, fromPath), makeLines(521));
			git(dir, ["add", fromPath]);
			git(dir, ["commit", "-m", "base"]);

			writeFileSync(join(dir, toPath), `${makeLines(521)}\n// copy edit touch`);
			git(dir, ["add", toPath]);
			git(dir, ["commit", "-m", "copy with edit"]);

			const baseRef = git(dir, ["rev-parse", "HEAD~1"]);
			const diff = collectGitDiff(dir, baseRef);
			const copy = diff.copied.find((c) => c.to === toPath);
			assert.ok(copy, `expected copied entry for ${toPath}`);
			assert.ok(copy.similarity < 100, "expected C<100 copy-with-edit");

			const mergeBase = git(dir, ["merge-base", "HEAD", baseRef]);
			const sourceHunks = spawnSync(
				"git",
				["diff", "-U0", mergeBase, "HEAD", "--", fromPath],
				{ cwd: dir, encoding: "utf8" },
			).stdout;
			assert.equal(sourceHunks, "", "source path must have empty hunks");

			const violations = collectLineBudgetViolations({
				rootDir: dir,
				baseRef,
				diff,
			});
			expectLineBudgetViolation(toPath, 522)(violations);
		});
	});

	it("passes for a 621-line git mv with specifier-only sibling import edits", () => {
		withTempGitRepo(".tmp-fm-line-budget-rename-spec-", (dir) => {
			const fromPath = "server/src/routes/helpers.ts";
			const toPath = "server/src/lib/helpers.ts";
			const body = Array.from(
				{ length: 620 },
				(_, i) => `export const n${i} = ${i};`,
			).join("\n");
			const before = `import { x } from "./focus-session.js";\n${body}\n`;
			mkdirSync(join(dir, "server/src/routes"), { recursive: true });
			mkdirSync(join(dir, "server/src/lib"), { recursive: true });
			writeFileSync(join(dir, fromPath), before);
			git(dir, ["add", fromPath]);
			git(dir, ["commit", "-m", "base"]);

			git(dir, ["mv", fromPath, toPath]);
			writeFileSync(
				join(dir, toPath),
				`import { x } from "../routes/focus-session.js";\n${body}\n`,
			);
			git(dir, ["add", toPath]);
			git(dir, ["commit", "-m", "rename specifier"]);

			const baseRef = git(dir, ["rev-parse", "HEAD~1"]);
			const diff = collectGitDiff(dir, baseRef);
			const renamed = diff.renamed.find((r) => r.to === toPath);
			assert.ok(renamed, `expected renamed entry for ${toPath}`);
			assert.equal(renamed.kind, "rename-with-edit");
			assert.ok(renamed.similarity < 100);

			const violations = collectLineBudgetViolations({
				rootDir: dir,
				baseRef,
				diff,
			});
			assert.deepEqual(violations, []);
		});
	});

	it("still reports 300-on-touch for a 621-line git mv that also edits the body", () => {
		withTempGitRepo(".tmp-fm-line-budget-rename-body-", (dir) => {
			const fromPath = "server/src/routes/helpers.ts";
			const toPath = "server/src/lib/helpers.ts";
			const body = Array.from(
				{ length: 620 },
				(_, i) => `export const n${i} = ${i};`,
			).join("\n");
			const before = `import { x } from "./focus-session.js";\n${body}\n`;
			mkdirSync(join(dir, "server/src/routes"), { recursive: true });
			mkdirSync(join(dir, "server/src/lib"), { recursive: true });
			writeFileSync(join(dir, fromPath), before);
			git(dir, ["add", fromPath]);
			git(dir, ["commit", "-m", "base"]);

			git(dir, ["mv", fromPath, toPath]);
			writeFileSync(
				join(dir, toPath),
				`import { x } from "../routes/focus-session.js";\n${body}\nexport const touched = true;\n`,
			);
			git(dir, ["add", toPath]);
			git(dir, ["commit", "-m", "rename body"]);

			const baseRef = git(dir, ["rev-parse", "HEAD~1"]);
			const diff = collectGitDiff(dir, baseRef);
			const renamed = diff.renamed.find((r) => r.to === toPath);
			assert.ok(renamed, `expected renamed entry for ${toPath}`);
			assert.equal(renamed.kind, "rename-with-edit");

			const violations = collectLineBudgetViolations({
				rootDir: dir,
				baseRef,
				diff,
			});
			expectLineBudgetViolation(toPath, 622)(violations);
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
