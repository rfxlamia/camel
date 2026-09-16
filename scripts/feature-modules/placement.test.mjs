import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FEATURES } from "./map.mjs";
import { checkPlacement, PLACEMENT_RULE_ID } from "./placement.mjs";

/** @type {import("./map.mjs")} */
const map = { FEATURES };

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cliScript = join(repoRoot, "scripts/check-feature-modules.mjs");

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

describe("Cycle 1 — allowed board module (unit)", () => {
	it("allows new files under mapped server module prefix", () => {
		const violations = checkPlacement({
			path: "server/src/modules/board/cards-update.ts",
			status: "new",
			map,
		});
		assert.deepEqual(violations, []);
	});
});

/**
 * @param {string} path
 */
function expectPlacementViolation(path) {
	const violations = checkPlacement({ path, status: "new", map });
	assert.equal(violations.length, 1, violations.join("; "));
	assert.match(violations[0], new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ${PLACEMENT_RULE_ID}:`));
}

describe("Cycle A — kernel allow (unit)", () => {
	it("allows new files under client shared kernel prefix", () => {
		const violations = checkPlacement({
			path: "client/src/shared/taxonomy/sortVocab.ts",
			status: "new",
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("allows new files under server lib kernel prefix", () => {
		const violations = checkPlacement({
			path: "server/src/lib/attachment-foo.ts",
			status: "new",
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("allows new files under client layout kernel prefix", () => {
		const violations = checkPlacement({
			path: "client/src/layout/Foo.tsx",
			status: "new",
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("allows new files under server db kernel prefix", () => {
		const violations = checkPlacement({
			path: "server/src/db/bar.ts",
			status: "new",
			map,
		});
		assert.deepEqual(violations, []);
	});
});

describe("Cycle B — forbidden type-folders (unit)", () => {
	const forbiddenPaths = [
		"server/src/routes/cards-update.ts",
		"client/src/pages/ReportsPage.tsx",
		"client/src/lib/foo.ts",
		"server/src/agent/tools/newTool.ts",
		"client/src/apiClient.ts",
	];

	for (const path of forbiddenPaths) {
		it(`rejects new file at ${path}`, () => {
			expectPlacementViolation(path);
		});
	}

	it("does not flag modified src-root siblings (grandfathered)", () => {
		const violations = checkPlacement({
			path: "client/src/apiClient.ts",
			status: "modified",
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("ignores new files outside client/src and server/src", () => {
		assert.deepEqual(
			checkPlacement({ path: "docs/pocket/foo.ts", status: "new", map }),
			[],
		);
		assert.deepEqual(
			checkPlacement({ path: "scripts/feature-modules/x.ts", status: "new", map }),
			[],
		);
	});
});

describe("Cycle C — unmapped feature (unit)", () => {
	it("rejects new files under unmapped server module name", () => {
		expectPlacementViolation("server/src/modules/billing/x.ts");
	});
});

describe("Cycle D — test file placement (unit)", () => {
	it("rejects new tests under legacy trees", () => {
		expectPlacementViolation("server/src/routes/cards.write.test.ts");
		expectPlacementViolation("server/src/__tests__/foo.test.ts");
	});

	it("allows colocated tests under mapped modules", () => {
		const violations = checkPlacement({
			path: "server/src/modules/board/cards-update.test.ts",
			status: "new",
			map,
		});
		assert.deepEqual(violations, []);
	});
});

describe("Cycle E — CLI exit 1 for placement (integration)", () => {
	it("fails when temp repo adds a forbidden new routes file", () => {
		withTempGitRepo(".tmp-fm-placement-", (dir) => {
			writeFileSync(join(dir, "README.md"), "# base\n");
			git(dir, ["add", "README.md"]);
			git(dir, ["commit", "-m", "base"]);

			mkdirSync(join(dir, "server/src/routes"), { recursive: true });
			writeFileSync(
				join(dir, "server/src/routes/cards-update.ts"),
				"export {};\n",
			);
			git(dir, ["add", "server/src/routes/cards-update.ts"]);
			git(dir, ["commit", "-m", "bad placement"]);

			const baseRef = git(dir, ["rev-parse", "HEAD~1"]);
			const result = spawnSync(
				process.execPath,
				[cliScript, "--base-ref", baseRef, "--root", dir],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 1, result.stdout || result.stderr);
			const combined = `${result.stdout}\n${result.stderr}`;
			assert.match(combined, /FM-RULE-1/);
			assert.match(combined, /server\/src\/routes\/cards-update\.ts/);
		});
	});
});
