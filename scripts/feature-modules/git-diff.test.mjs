import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	collectGitDiff,
	parseNameStatusOutput,
	unquoteGitPath,
} from "./git-diff.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliScript = join(repoRoot, "scripts/check-feature-modules.mjs");

describe("Cycle 1 — git-diff parser (unit)", () => {
	it("classifies add/modify/rename/copy/delete and applies ignore rules", () => {
		const fixture = [
			"A\tclient/src/features/board/new.ts",
			"M\tserver/src/modules/tracker/item.ts",
			"R100\tserver/src/old.ts\tserver/src/modules/tracker/renamed.ts",
			"R085\tserver/src/edited-old.ts\tserver/src/modules/tracker/renamed-edit.ts",
			"C100\tserver/src/copy-src.ts\tserver/src/modules/tracker/copied.ts",
			"D\tserver/src/modules/tracker/removed.ts",
			'A\t"path with spaces/client.ts"',
			"A\tcamel-lottie/foo.ts",
			"A\tREADME.md",
			"A\tclient/src/styles.css",
		].join("\n");

		const result = parseNameStatusOutput(fixture);

		assert.deepEqual(result.new, [
			"client/src/features/board/new.ts",
			"path with spaces/client.ts",
		]);
		assert.deepEqual(result.modified, ["server/src/modules/tracker/item.ts"]);
		assert.deepEqual(result.renamed, [
			{
				from: "server/src/old.ts",
				to: "server/src/modules/tracker/renamed.ts",
				similarity: 100,
				kind: "rename",
			},
			{
				from: "server/src/edited-old.ts",
				to: "server/src/modules/tracker/renamed-edit.ts",
				similarity: 85,
				kind: "rename-with-edit",
			},
		]);
		assert.deepEqual(result.copied, [
			{
				from: "server/src/copy-src.ts",
				to: "server/src/modules/tracker/copied.ts",
				similarity: 100,
			},
		]);
		assert.deepEqual(result.deleted, ["server/src/modules/tracker/removed.ts"]);
	});

	it("defaults merge-base ref to origin/main and accepts override", () => {
		assert.equal(parseNameStatusOutput("", { baseRef: undefined }).baseRef, "origin/main");
		assert.equal(parseNameStatusOutput("", { baseRef: "feature/foo" }).baseRef, "feature/foo");
	});

	it("lists source files excluding deleted and non-ts paths", () => {
		const fixture = [
			"A\tclient/src/a.ts",
			"D\tclient/src/gone.ts",
			"A\tclient/src/a.tsx",
			"A\tclient/src/readme.md",
		].join("\n");
		const result = parseNameStatusOutput(fixture);
		assert.deepEqual(result.sourceFiles.sort(), [
			"client/src/a.ts",
			"client/src/a.tsx",
		]);
		assert.ok(!result.sourceFiles.includes("client/src/gone.ts"));
	});

	it("decodes C-quoted octal and tab escapes in git pathnames", () => {
		assert.equal(unquoteGitPath('"caf\\303\\251.ts"'), "café.ts");
		assert.equal(
			unquoteGitPath('"client/src/foo\\tbar.ts"'),
			"client/src/foo\tbar.ts",
		);

		const result = parseNameStatusOutput('A\t"caf\\303\\251.ts"\n');
		assert.deepEqual(result.new, ["café.ts"]);
	});
});

describe("Cycle Map — map data (unit)", () => {
	it("lists locked features, kernel-in-waiting, and scan roots", async () => {
		const map = await import("./map.mjs");

		const expectedFeatures = [
			"board",
			"tracker",
			"my-work",
			"agent",
			"chat",
			"focus",
			"settings",
			"workspaces",
			"notifications",
			"activity",
			"auth",
		];
		assert.deepEqual([...map.FEATURES].sort(), [...expectedFeatures].sort());
		assert.deepEqual(map.SCAN_ROOTS, ["client/src", "server/src"]);
		assert.ok(
			map.KERNEL_IN_WAITING.includes("client/src/lib/workItemMutations.ts"),
		);
		assert.ok(
			!map.KERNEL_IN_WAITING.some((p) => p.endsWith("work-item-response.ts")),
		);
		assert.ok(
			existsSync(join(repoRoot, "server/src/lib/work-item-response.ts")),
		);
		assert.ok(
			!existsSync(join(repoRoot, "server/src/routes/work-item-response.ts")),
		);
		assert.ok(
			!map.KERNEL_IN_WAITING.some((p) => p.endsWith("work-items.ts")),
		);
		assert.ok(
			!map.KERNEL_IN_WAITING.some((p) => p.endsWith("helpers.ts")),
		);
		assert.ok(
			!map.KERNEL_IN_WAITING.some((p) => p.endsWith("vocabulary-response.ts")),
		);
		assert.ok(
			!map.KERNEL_IN_WAITING.some((p) => p.endsWith("tracker-item-parsers.ts")),
		);
	});
});

describe("Cycle A — stub CLI (integration)", () => {
	it("exits 0, prints pass line, and echoes resolved base-ref and root", () => {
		const result = spawnSync(
			process.execPath,
			[cliScript, "--base-ref", "origin/main", "--root", "."],
			{ cwd: repoRoot, encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /Feature module check passed\./);
		assert.match(result.stdout, /origin\/main/);
		assert.match(result.stdout, /root=\./);
	});

	it("fails loud when merge-base ref is missing (non-fixture root)", () => {
		const result = spawnSync(
			process.execPath,
			[
				cliScript,
				"--base-ref",
				"refs/no/such-ref-feature-modules-129",
				"--root",
				".",
			],
			{ cwd: repoRoot, encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		const combined = `${result.stdout}\n${result.stderr}`;
		assert.match(combined, /FM-RULE-5/);
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

describe("Cycle Git — real git binary (integration)", () => {
	it("collects name-status from merge-base through real git", () => {
		withTempGitRepo(".tmp-fm-git-", (dir) => {
			writeFileSync(join(dir, "keep.ts"), "// keep\n");
			writeFileSync(join(dir, "modify-me.ts"), "// v1\n");
			writeFileSync(join(dir, "rename-me.ts"), "// rename\n");
			writeFileSync(join(dir, "copy-src.ts"), "// copy\n");
			writeFileSync(join(dir, "delete-me.ts"), "// delete\n");
			writeFileSync(join(dir, "noise.md"), "# doc\n");
			git(dir, ["add", "."]);
			git(dir, ["commit", "-m", "base"]);

			writeFileSync(join(dir, "modify-me.ts"), "// v2\n");
			writeFileSync(join(dir, "brand-new.ts"), "// new\n");
			git(dir, ["mv", "rename-me.ts", "renamed.ts"]);
			writeFileSync(
				join(dir, "copied.ts"),
				readFileSync(join(dir, "copy-src.ts"), "utf8"),
			);
			rmSync(join(dir, "delete-me.ts"));
			git(dir, ["add", "-A"]);
			git(dir, ["commit", "-m", "changes"]);

			const baseRef = git(dir, ["rev-parse", "HEAD~1"]);
			const result = collectGitDiff(dir, baseRef);

			assert.deepEqual(result.new.sort(), ["brand-new.ts"].sort());
			assert.deepEqual(result.modified, ["modify-me.ts"]);
			assert.ok(
				result.renamed.some(
					(r) => r.from === "rename-me.ts" && r.to === "renamed.ts",
				),
			);
			assert.ok(result.deleted.includes("delete-me.ts"));
			assert.ok(
				result.copied.some(
					(c) => c.from === "copy-src.ts" && c.to === "copied.ts",
				),
			);
			assert.equal(result.sourceFiles.length, 4);
			assert.ok(!result.sourceFiles.includes("noise.md"));
		});
	});

	it("fails loud when base ref is missing", () => {
		withTempGitRepo(".tmp-fm-git-miss-", (dir) => {
			writeFileSync(join(dir, "solo.ts"), "// solo\n");
			git(dir, ["add", "solo.ts"]);
			git(dir, ["commit", "-m", "solo"]);

			assert.throws(
				() => collectGitDiff(dir, "refs/no/such-base-fm-129"),
				/FM-RULE-5/,
			);
		});
	});

	it("reports zero source files when HEAD equals merge-base", () => {
		withTempGitRepo(".tmp-fm-git-empty-", (dir) => {
			writeFileSync(join(dir, "only.ts"), "// only\n");
			git(dir, ["add", "only.ts"]);
			git(dir, ["commit", "-m", "only"]);
			const head = git(dir, ["rev-parse", "HEAD"]);

			const result = collectGitDiff(dir, head);
			assert.deepEqual(result.sourceFiles, []);
			assert.deepEqual(result.new, []);
			assert.deepEqual(result.modified, []);
		});
	});
});

describe("Cycle B — shared kernel file exists (unit)", () => {
	it("client/src/shared/index.ts is a valid empty ESM module", () => {
		const sharedIndex = join(repoRoot, "client/src/shared/index.ts");
		assert.ok(existsSync(sharedIndex), "client/src/shared/index.ts must exist");
		const contents = readFileSync(sharedIndex, "utf8").trim();
		assert.equal(contents, "export {};");
	});
});
