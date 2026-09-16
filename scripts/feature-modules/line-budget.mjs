import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isSourceFile } from "./git-diff.mjs";

export const LINE_BUDGET_RULE_ID = "FM-RULE-3";
export const LINE_BUDGET_MAX = 300;

const TEST_FILE =
	/\.(test|integration\.test)\.(ts|tsx)$|test-support/i;
const GENERATED_FILE = /\.generated\.(ts|tsx)$/i;
const GENERATED_DIR = /\/generated\//;

/**
 * Raw LF line count (last line without trailing newline still counts).
 * @param {string} text
 */
export function countRawLines(text) {
	if (text === "") return 0;
	const newlineCount = (text.match(/\n/g) ?? []).length;
	return text.endsWith("\n") ? newlineCount : newlineCount + 1;
}

/**
 * @param {string} path
 */
export function isExcludedFromLineBudget(path) {
	if (!isSourceFile(path)) return true;
	if (TEST_FILE.test(path)) return true;
	if (GENERATED_FILE.test(path)) return true;
	if (GENERATED_DIR.test(path)) return true;
	return false;
}

/**
 * @param {string} hunks
 */
function parseChangedLines(hunks) {
	/** @type {string[]} */
	const removed = [];
	/** @type {string[]} */
	const added = [];
	for (const line of hunks.split("\n")) {
		if (
			line.startsWith("+++") ||
			line.startsWith("---") ||
			line.startsWith("@@")
		) {
			continue;
		}
		if (line.startsWith("-")) removed.push(line.slice(1));
		else if (line.startsWith("+")) added.push(line.slice(1));
	}
	return { removed, added };
}

/**
 * @param {string} line
 */
function collapseWhitespace(line) {
	return line.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} hunks
 */
function isWhitespaceOnlyHunks(hunks) {
	const { removed, added } = parseChangedLines(hunks);
	if (removed.length === 0 && added.length === 0) return true;
	if (removed.length !== added.length) return false;
	for (let i = 0; i < removed.length; i++) {
		if (collapseWhitespace(removed[i]) !== collapseWhitespace(added[i])) {
			return false;
		}
	}
	return true;
}

/**
 * @param {string} line
 */
function isImportOrExportFromLine(line) {
	const trimmed = line.trim();
	return (
		trimmed.startsWith("import ") ||
		/^export\s+\{/.test(trimmed) ||
		/^export\s+\*\s+from\s/.test(trimmed) ||
		/^export\s+type\s+\{/.test(trimmed)
	);
}

/**
 * @param {string} hunks
 */
function isImportSpecifierOnlyHunks(hunks) {
	const { removed, added } = parseChangedLines(hunks);
	const changed = [...removed, ...added];
	if (changed.length === 0) return true;
	return changed.every(isImportOrExportFromLine);
}

/**
 * @param {string} hunks
 */
export function isNonTrivialTouch(hunks) {
	if (isWhitespaceOnlyHunks(hunks)) return false;
	if (isImportSpecifierOnlyHunks(hunks)) return false;
	return true;
}

/**
 * @param {string} path
 * @param {number} lineCount
 * @param {string} detail
 */
function lineBudgetViolation(path, lineCount, detail) {
	return [`${path}: ${LINE_BUDGET_RULE_ID}: ${detail} (${lineCount} lines)`];
}

/**
 * @param {{
 *   path: string,
 *   status: string,
 *   beforeText: string,
 *   afterText: string,
 *   hunks?: string,
 *   renameKind?: 'rename' | 'rename-with-edit',
 * }} input
 * @returns {string[]}
 */
export function checkLineBudget({
	path,
	status,
	beforeText,
	afterText,
	hunks = "",
	renameKind,
}) {
	if (isExcludedFromLineBudget(path)) return [];

	const afterLines = countRawLines(afterText);
	const beforeLines = countRawLines(beforeText);

	if (status === "new") {
		if (afterLines > LINE_BUDGET_MAX) {
			return lineBudgetViolation(
				path,
				afterLines,
				"new source file exceeds 300-line ceiling",
			);
		}
		return [];
	}

	if (status === "rename" && renameKind === "rename") {
		return [];
	}

	const appliesOnTouch =
		status === "rename-with-edit" ||
		(status === "modified" && beforeLines > LINE_BUDGET_MAX) ||
		(status === "rename" && renameKind === "rename-with-edit");

	if (!appliesOnTouch) return [];

	if (!isNonTrivialTouch(hunks)) return [];

	if (afterLines > LINE_BUDGET_MAX) {
		return lineBudgetViolation(
			path,
			afterLines,
			"300-on-touch: oversized file must be ≤300 lines after non-trivial edit",
		);
	}

	return [];
}

/**
 * @param {string} rootDir
 * @param {string} baseRef
 */
function resolveMergeBase(rootDir, baseRef) {
	const result = spawnSync(
		"git",
		["merge-base", "HEAD", baseRef],
		{ cwd: rootDir, encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(
			`FM-RULE-5: cannot compute merge-base for "${baseRef}" (${(result.stderr || result.stdout).trim()})`,
		);
	}
	return result.stdout.trim();
}

/**
 * @param {string} rootDir
 * @param {string} objectRef
 * @param {string} path
 */
function gitShowText(rootDir, objectRef, path) {
	const result = spawnSync(
		"git",
		["show", `${objectRef}:${path}`],
		{ cwd: rootDir, encoding: "utf8" },
	);
	if (result.status !== 0) return "";
	return result.stdout;
}

/**
 * @param {string} rootDir
 * @param {string} mergeBase
 * @param {string} path
 * @param {string} [oldPath]
 */
function gitDiffHunks(rootDir, mergeBase, path, oldPath) {
	const diffPath = oldPath ?? path;
	const result = spawnSync(
		"git",
		["diff", "-U0", mergeBase, "HEAD", "--", diffPath],
		{ cwd: rootDir, encoding: "utf8" },
	);
	if (result.status !== 0) return "";
	return result.stdout;
}

/**
 * @param {string} rootDir
 * @param {string} path
 */
function readWorkingTreeText(rootDir, path) {
	try {
		return readFileSync(join(rootDir, path), "utf8");
	} catch {
		return "";
	}
}

/**
 * @param {{ rootDir: string, baseRef: string, diff: ReturnType<typeof import("./git-diff.mjs").parseNameStatusOutput> }} input
 * @returns {string[]}
 */
export function collectLineBudgetViolations({ rootDir, baseRef, diff }) {
	const mergeBase = resolveMergeBase(rootDir, baseRef);
	/** @type {string[]} */
	const violations = [];

	for (const path of diff.new) {
		violations.push(
			...checkLineBudget({
				path,
				status: "new",
				beforeText: "",
				afterText: readWorkingTreeText(rootDir, path),
				hunks: gitDiffHunks(rootDir, mergeBase, path),
			}),
		);
	}

	for (const path of diff.modified) {
		violations.push(
			...checkLineBudget({
				path,
				status: "modified",
				beforeText: gitShowText(rootDir, mergeBase, path),
				afterText: readWorkingTreeText(rootDir, path),
				hunks: gitDiffHunks(rootDir, mergeBase, path),
			}),
		);
	}

	for (const entry of diff.renamed) {
		if (!isSourceFile(entry.to)) continue;
		const renameKind =
			entry.kind === "rename" ? "rename" : "rename-with-edit";
		violations.push(
			...checkLineBudget({
				path: entry.to,
				status: "rename",
				beforeText: gitShowText(rootDir, mergeBase, entry.from),
				afterText: readWorkingTreeText(rootDir, entry.to),
				hunks: gitDiffHunks(rootDir, mergeBase, entry.to, entry.from),
				renameKind,
			}),
		);
	}

	for (const entry of diff.copied) {
		if (!isSourceFile(entry.to)) continue;
		const renameKind =
			entry.similarity === 100 ? "rename" : "rename-with-edit";
		violations.push(
			...checkLineBudget({
				path: entry.to,
				status: "rename",
				beforeText: gitShowText(rootDir, mergeBase, entry.from),
				afterText: readWorkingTreeText(rootDir, entry.to),
				hunks: gitDiffHunks(rootDir, mergeBase, entry.to, entry.from),
				renameKind,
			}),
		);
	}

	return violations;
}
