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
 * Parse `git diff --name-status` / `--find-renames` text (no git spawn).
 * @param {string} output
 * @param {{ baseRef?: string }} [options]
 */
export function parseNameStatusOutput(output, options = {}) {
	const baseRef = options.baseRef ?? "origin/main";

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

		if (status.startsWith("R")) {
			const similarity = Number.parseInt(status.slice(1), 10);
			const parts = rest.split("\t");
			if (parts.length < 2) continue;
			const from = unquoteGitPath(parts[0]);
			const to = unquoteGitPath(parts[1]);
			const kind = similarity === 100 ? "rename" : "rename-with-edit";
			renamed.push({ from, to, similarity, kind });
			continue;
		}

		if (status.startsWith("C")) {
			const similarity = Number.parseInt(status.slice(1), 10);
			const parts = rest.split("\t");
			if (parts.length < 2) continue;
			copied.push({
				from: unquoteGitPath(parts[0]),
				to: unquoteGitPath(parts[1]),
				similarity,
			});
			continue;
		}

		const path = unquoteGitPath(rest);

		if (status === "D") {
			if (isSourceFile(path)) deleted.push(path);
			continue;
		}

		if (isIgnoredPath(path) || !isSourceFile(path)) continue;

		if (status === "A") newFiles.push(path);
		else if (status === "M") modified.push(path);
	}

	const sourceSet = new Set([...newFiles, ...modified]);
	for (const entry of renamed) {
		if (isSourceFile(entry.to)) sourceSet.add(entry.to);
	}
	for (const entry of copied) {
		if (isSourceFile(entry.to)) sourceSet.add(entry.to);
	}

	return {
		baseRef,
		new: newFiles,
		modified,
		renamed,
		copied,
		deleted,
		sourceFiles: [...sourceSet],
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
		const detail = (result.stderr || result.stdout || "").trim();
		throw new Error(
			`FM-RULE-5: merge-base ref "${baseRef}" is not reachable (${detail || "unknown git error"})`,
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
		const detail = (mergeBaseResult.stderr || mergeBaseResult.stdout || "").trim();
		throw new Error(
			`FM-RULE-5: cannot compute merge-base for "${baseRef}" (${detail || "unknown git error"})`,
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
		const detail = (diffResult.stderr || diffResult.stdout || "").trim();
		throw new Error(
			`FM-RULE-5: git diff failed (${detail || "unknown git error"})`,
		);
	}

	return parseNameStatusOutput(diffResult.stdout, { baseRef });
}
