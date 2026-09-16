import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** @typedef {{ from: string, to: string, similarity: number, kind: 'rename' | 'rename-with-edit' }} RenameEntry */
/** @typedef {{ from: string, to: string, similarity: number }} CopyEntry */

const TS_SOURCE = /\.(ts|tsx)$/i;
const CAMEL_LOTTIE = /^camel-lottie\//;

/**
 * @param {string} raw
 */
export function unquoteGitPath(raw) {
	const trimmed = raw.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
	}
	return trimmed;
}

/**
 * @param {string} path
 */
export function isIgnoredPath(path) {
	return CAMEL_LOTTIE.test(path);
}

/**
 * @param {string} path
 */
export function isSourceFile(path) {
	return TS_SOURCE.test(path) && !isIgnoredPath(path);
}

/**
 * @param {string} status
 * @param {string} rest
 * @returns {RenameEntry | null}
 */
function parseRenameStatusLine(status, rest) {
	if (!status.startsWith("R")) return null;
	const similarity = Number.parseInt(status.slice(1), 10);
	const parts = rest.split("\t");
	if (parts.length < 2) return null;
	const from = unquoteGitPath(parts[0]);
	const to = unquoteGitPath(parts[1]);
	const kind = similarity === 100 ? "rename" : "rename-with-edit";
	return { from, to, similarity, kind };
}

/**
 * @param {string} status
 * @param {string} rest
 * @returns {CopyEntry | null}
 */
function parseCopyStatusLine(status, rest) {
	if (!status.startsWith("C")) return null;
	const similarity = Number.parseInt(status.slice(1), 10);
	const parts = rest.split("\t");
	if (parts.length < 2) return null;
	return {
		from: unquoteGitPath(parts[0]),
		to: unquoteGitPath(parts[1]),
		similarity,
	};
}

/**
 * @param {{ new: string[], modified: string[], renamed: RenameEntry[], copied: CopyEntry[] }} buckets
 */
function assembleSourceFilePaths(buckets) {
	const sourceSet = new Set([...buckets.new, ...buckets.modified]);
	for (const entry of buckets.renamed) {
		if (isSourceFile(entry.to)) sourceSet.add(entry.to);
	}
	for (const entry of buckets.copied) {
		if (isSourceFile(entry.to)) sourceSet.add(entry.to);
	}
	return [...sourceSet];
}

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} result
 */
function gitCommandDetail(result) {
	return (result.stderr || result.stdout || "").trim();
}

/**
 * @param {string} messageBody
 * @param {import("node:child_process").SpawnSyncReturns<string>} result
 */
function throwFmRule5GitError(messageBody, result) {
	const detail = gitCommandDetail(result);
	throw new Error(
		`FM-RULE-5: ${messageBody} (${detail || "unknown git error"})`,
	);
}

/**
 * @param {string} output
 * @returns {{ new: string[], modified: string[], renamed: RenameEntry[], copied: CopyEntry[], deleted: string[] }}
 */
function collectNameStatusBuckets(output) {
	/** @type {string[]} */
	const newFiles = [];
	/** @type {string[]} */
	const modified = [];
	/** @type {RenameEntry[]} */
	const renamed = [];
	/** @type {CopyEntry[]} */
	const copied = [];
	/** @type {string[]} */
	const deleted = [];

	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const tab = trimmed.indexOf("\t");
		if (tab === -1) continue;

		const status = trimmed.slice(0, tab);
		const rest = trimmed.slice(tab + 1);

		const renameEntry = parseRenameStatusLine(status, rest);
		if (renameEntry) {
			renamed.push(renameEntry);
			continue;
		}

		const copyEntry = parseCopyStatusLine(status, rest);
		if (copyEntry) {
			copied.push(copyEntry);
			continue;
		}

		const path = unquoteGitPath(rest);

		if (status === "D") {
			if (isSourceFile(path)) deleted.push(path);
			continue;
		}

		if (!isSourceFile(path)) continue;

		if (status === "A") newFiles.push(path);
		else if (status === "M") modified.push(path);
	}

	return { new: newFiles, modified, renamed, copied, deleted };
}

/**
 * Parse `git diff --name-status` / `--find-renames` text (no git spawn).
 * @param {string} output
 * @param {{ baseRef?: string }} [options]
 */
export function parseNameStatusOutput(output, options = {}) {
	const baseRef = options.baseRef ?? "origin/main";
	const buckets = collectNameStatusBuckets(output);

	return {
		baseRef,
		new: buckets.new,
		modified: buckets.modified,
		renamed: buckets.renamed,
		copied: buckets.copied,
		deleted: buckets.deleted,
		sourceFiles: assembleSourceFilePaths(buckets),
	};
}

/**
 * Fixture trees skip merge-base resolution (used by guard unit fixtures).
 * @param {string} rootDir absolute or relative repo root
 */
export function isFixtureRoot(rootDir) {
	const normalized = rootDir.replace(/\\/g, "/");
	if (normalized.includes("scripts/feature-modules/fixtures")) return true;
	return existsSync(join(rootDir, ".feature-modules-fixture"));
}

/**
 * Fail loud when base ref cannot be resolved (Rule 5).
 * @param {string} baseRef
 * @param {string} rootDir absolute path to git work tree
 */
export function assertBaseRefResolvable(baseRef, rootDir) {
	if (isFixtureRoot(rootDir)) return;
	const result = spawnSync(
		"git",
		["rev-parse", "--verify", `${baseRef}^{commit}`],
		{ cwd: rootDir, encoding: "utf8" },
	);
	if (result.status !== 0) {
		throwFmRule5GitError(
			`merge-base ref "${baseRef}" is not reachable`,
			result,
		);
	}
}

/**
 * Run merge-base + name-status diff via the real git binary.
 * @param {string} rootDir absolute git work tree
 * @param {string} [baseRef]
 */
export function collectGitDiff(rootDir, baseRef = "origin/main") {
	assertBaseRefResolvable(baseRef, rootDir);

	const mergeBaseResult = spawnSync(
		"git",
		["merge-base", "HEAD", baseRef],
		{ cwd: rootDir, encoding: "utf8" },
	);
	if (mergeBaseResult.status !== 0) {
		throwFmRule5GitError(
			`cannot compute merge-base for "${baseRef}"`,
			mergeBaseResult,
		);
	}

	const mergeBase = mergeBaseResult.stdout.trim();
	const diffResult = spawnSync(
		"git",
		[
			"diff",
			"--name-status",
			"--find-renames",
			"--find-copies",
			"--find-copies-harder",
			mergeBase,
			"HEAD",
		],
		{ cwd: rootDir, encoding: "utf8" },
	);
	if (diffResult.status !== 0) {
		throwFmRule5GitError("git diff failed", diffResult);
	}

	return parseNameStatusOutput(diffResult.stdout, { baseRef });
}
