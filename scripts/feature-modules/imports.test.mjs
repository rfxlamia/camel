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

import * as map from "./map.mjs";
import {
	checkImports,
	checkMissingModuleIndexes,
	collectImportViolations,
	DEEP_IMPORT_RULE_ID,
	ONE_WAY_RULE_ID,
	MISSING_INDEX_RULE_ID,
	FORBIDDEN_FEATURE_RULE_ID,
} from "./imports.mjs";

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

describe("Cycle 1 — deep import from leftover orchestrator (unit)", () => {
	it("reports deep import when routes file imports module internals", () => {
		const source = `import { updateCard } from "../modules/board/cards-update.js";\n`;
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1, violations.join("; "));
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
		assert.match(violations[0], /server\/src\/routes\/cards\.ts/);
		assert.match(violations[0], /cards-update\.js/);
	});
});

describe("Cycle A — public API and in-module (unit)", () => {
	it("allows index import from outside the module", () => {
		const source = `import { boardRouter } from "../modules/board/index.js";\n`;
		const violations = checkImports({
			filePath: "server/src/routes.ts",
			source,
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("allows relative imports inside the same module", () => {
		const source = `import { loadCard } from "./cards-repo.js";\n`;
		const violations = checkImports({
			filePath: "server/src/modules/board/cards-update.ts",
			source,
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("flags export * from deep paths when importer is outside the module", () => {
		const source = `export * from "../modules/board/internal.js";\n`;
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
	});

	it("flags import type deep paths from outside the module", () => {
		const source = `import type { CardRow } from "../modules/board/cards-repo.js";\n`;
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
	});

	it("does not flag type-folder imports within routes/", () => {
		const source = `import { ok } from "./helpers.js";\n`;
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.deepEqual(violations, []);
	});
});

describe("Cycle B — cross-feature (unit)", () => {
	it("allows cross-feature index import", () => {
		const source = `import { activityApi } from "../activity/index.ts";\n`;
		const violations = checkImports({
			filePath: "client/src/features/board/x.ts",
			source,
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("flags cross-feature deep import", () => {
		const source = `import { describeEvent } from "../activity/describeEvent.ts";\n`;
		const violations = checkImports({
			filePath: "client/src/features/board/x.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
		assert.match(violations[0], /describeEvent\.ts/);
	});

	it("flags nested barrel import as a deep import from outside the module", () => {
		const source = `import { hidden } from "../activity/internal/index.ts";\n`;
		const violations = checkImports({
			filePath: "client/src/features/board/x.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
		assert.match(violations[0], /internal\/index/);
	});
});

describe("Cycle C — one-way vs kernel allowlist (unit)", () => {
	it("flags module importing legacy routes feature file", () => {
		const source = `import { x } from "../../routes/card-response.js";\n`;
		const violations = checkImports({
			filePath: "server/src/modules/board/x.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(ONE_WAY_RULE_ID));
	});

	it("flags feature importing legacy components path", () => {
		const source = `import { MyWorkList } from "../../components/my-work/MyWorkList.tsx";\n`;
		const violations = checkImports({
			filePath: "client/src/features/my-work/x.tsx",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(ONE_WAY_RULE_ID));
	});

	const extractedKernel = [
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { p } from "../../routes/tracker-item-parsers.js";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { v } from "../../routes/vocabulary-response.js";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { w } from "../../routes/work-items.ts";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { h } from "../../routes/helpers.js";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { y } from "../../routes/work-item-response.js";\n`,
		},
		{
			file: "client/src/features/board/x.ts",
			spec: `import { m } from "../../lib/workItemMutations.ts";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { a } from "../../routes/tracker-assignees.js";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { t } from "../../routes/tracker-activity.js";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { l } from "../../routes/workspace-mutation-lock.js";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { c } from "../../routes/work-item-create-metadata.js";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { e } from "../../routes/work-item-events.js";\n`,
		},
		{
			file: "server/src/modules/board/x.ts",
			spec: `import { r } from "../../routes/tracker-items.js";\n`,
		},
	];

	for (const { file, spec } of extractedKernel) {
		it(`flags leftover type-folder import after kernel extract for ${spec.trim()}`, () => {
			const violations = checkImports({ filePath: file, source: spec, map });
			assert.equal(violations.length, 1);
			assert.match(violations[0], new RegExp(ONE_WAY_RULE_ID));
		});
	}
});

describe("Cycle D — composition root, missing index, work-items (unit)", () => {
	it("flags composition root deep import into modules", () => {
		const source = `import { boardRoutes } from "./modules/board/board.routes.js";\n`;
		const violations = checkImports({
			filePath: "server/src/routes.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
	});

	it("flags module tree with files but no index.ts on disk", () => {
		const dir = mkdtempSync(join(repoRoot, ".tmp-fm-index-"));
		try {
			const moduleDir = join(dir, "server/src/modules/board");
			mkdirSync(moduleDir, { recursive: true });
			writeFileSync(join(moduleDir, "cards-update.ts"), "export {};\n");
			const violations = checkMissingModuleIndexes({ rootDir: dir, map });
			assert.equal(violations.length, 1);
			assert.match(violations[0], new RegExp(MISSING_INDEX_RULE_ID));
			assert.match(violations[0], /server\/src\/modules\/board/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("flags a module that only has a nested internal/index.ts", () => {
		const dir = mkdtempSync(join(repoRoot, ".tmp-fm-nested-index-"));
		try {
			const moduleDir = join(dir, "client/src/features/activity/internal");
			mkdirSync(moduleDir, { recursive: true });
			writeFileSync(join(moduleDir, "index.ts"), "export {};\n");
			writeFileSync(join(moduleDir, "private.ts"), "export {};\n");
			const violations = checkMissingModuleIndexes({ rootDir: dir, map });
			assert.equal(violations.length, 1);
			assert.match(violations[0], new RegExp(MISSING_INDEX_RULE_ID));
			assert.match(violations[0], /client\/src\/features\/activity/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("flags client features/work-items as forbidden product module", () => {
		const dir = mkdtempSync(join(repoRoot, ".tmp-fm-work-items-"));
		try {
			const featureDir = join(dir, "client/src/features/work-items");
			mkdirSync(featureDir, { recursive: true });
			writeFileSync(
				join(featureDir, "WorkItemsPage.tsx"),
				"export function WorkItemsPage() { return null; }\n",
			);
			const violations = checkMissingModuleIndexes({ rootDir: dir, map });
			assert.equal(violations.length, 1);
			assert.match(violations[0], new RegExp(FORBIDDEN_FEATURE_RULE_ID));
			assert.match(violations[0], /work-items/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("Cycle E — specifier forms and kernel imports (unit)", () => {
	it("allows extensionless directory import to another feature index", () => {
		const source = `import { activityApi } from "../activity";\n`;
		const violations = checkImports({
			filePath: "client/src/features/board/x.ts",
			source,
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("flags extensionless deep import from outside the module", () => {
		const source = `import { updateCard } from "../modules/board/cards-update";\n`;
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
	});

	it("allows kernel imports from a server module", () => {
		const source = `import { positionBetween } from "../../core/position.js";\n`;
		const violations = checkImports({
			filePath: "server/src/modules/board/x.ts",
			source,
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("allows shared kernel import from a client feature", () => {
		const source = `import { x } from "../../shared/index.ts";\n`;
		const violations = checkImports({
			filePath: "client/src/features/board/x.ts",
			source,
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("ignores specifier-like text inside comments and template literals", () => {
		const source = `
// import { bad } from "../modules/board/cards-update.js";
/* export * from '../modules/board/internal.js' */
const tpl = \`import { x } from "../modules/board/cards-update.js"\`;
import { ok } from "../modules/board/index.js";
`;
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.deepEqual(violations, []);
	});

	it("flags dynamic import() deep paths", () => {
		const source = `const m = await import("../modules/board/cards-update.js");\n`;
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
	});

	it("flags dynamic import() with whitespace before the parenthesis", () => {
		const source = `const m = await import ("../modules/board/cards-update.js");\n`;
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
	});

	it("flags dynamic import() inside a template interpolation", () => {
		const source =
			"const msg = `loaded ${(await import(\"../modules/board/cards-update.js\")).name}`;\n";
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1);
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
	});

	it("flags no-substitution template-literal dynamic import() deep paths", () => {
		const source =
			"const m = await import(`../modules/board/cards-update.js`);\n";
		const violations = checkImports({
			filePath: "server/src/routes/cards.ts",
			source,
			map,
		});
		assert.equal(violations.length, 1, violations.join("; "));
		assert.match(violations[0], new RegExp(DEEP_IMPORT_RULE_ID));
		assert.match(violations[0], /cards-update\.js/);
	});
});

describe("Cycle F — scan scope and CLI exit 1 (integration)", () => {
	it("collectImportViolations scans the full tree under scan roots", () => {
		const dir = mkdtempSync(join(repoRoot, ".tmp-fm-import-scan-"));
		try {
			mkdirSync(join(dir, "server/src/routes"), { recursive: true });
			writeFileSync(
				join(dir, "server/src/routes/cards.ts"),
				`import { updateCard } from "../modules/board/cards-update.js";\n`,
			);
			const violations = collectImportViolations({ rootDir: dir, map });
			assert.ok(
				violations.some(
					(v) => v.includes(DEEP_IMPORT_RULE_ID) && v.includes("cards-update"),
				),
				violations.join("\n"),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("CLI exits 1 when pre-existing file deep-imports a module", () => {
		withTempGitRepo(".tmp-fm-import-cli-", (dir) => {
			writeFileSync(join(dir, "README.md"), "# base\n");
			git(dir, ["add", "README.md"]);
			git(dir, ["commit", "-m", "base"]);

			mkdirSync(join(dir, "server/src/routes"), { recursive: true });
			mkdirSync(join(dir, "server/src/modules/board"), { recursive: true });
			writeFileSync(
				join(dir, "server/src/routes/cards.ts"),
				`import { updateCard } from "../modules/board/cards-update.js";\n`,
			);
			writeFileSync(join(dir, "server/src/modules/board/index.ts"), "export {};\n");
			git(dir, ["add", "."]);
			git(dir, ["commit", "-m", "deep import"]);

			const baseRef = git(dir, ["rev-parse", "HEAD"]);
			const result = spawnSync(
				process.execPath,
				[cliScript, "--base-ref", baseRef, "--root", dir],
				{ encoding: "utf8" },
			);

			assert.equal(result.status, 1, result.stdout || result.stderr);
			const combined = `${result.stdout}\n${result.stderr}`;
			assert.match(combined, new RegExp(DEEP_IMPORT_RULE_ID));
			assert.match(combined, /cards-update/);
		});
	});
});
