import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	listIntegrationTests,
	listSkipIfGatedTests,
} from "./list-integration-tests.mjs";

const cliScript = fileURLToPath(
	new URL("./list-integration-tests.mjs", import.meta.url),
);

function withTempRoot(run) {
	const root = mkdtempSync(join(tmpdir(), "integration-tests-"));
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeServerFile(root, relativePath, contents) {
	const file = join(root, "server", "src", relativePath);
	mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
	writeFileSync(file, contents);
}

test("selects every server .test.ts containing RUN_INTEGRATION, including mixed suites", () => {
	withTempRoot((root) => {
		writeServerFile(
			root,
			"root.test.ts",
			'describe.skipIf(!process.env.RUN_INTEGRATION)("root", () => {});',
		);
		writeServerFile(
			root,
			"nested/db.integration.test.ts",
			'describe.skipIf(!process.env.RUN_INTEGRATION)("db", () => {});',
		);
		writeServerFile(
			root,
			"nested/mixed.test.ts",
			'describe.skipIf(!process.env.RUN_INTEGRATION)("gated", () => {});',
		);
		writeServerFile(root, "nested/unit.test.ts", 'describe("unit", () => {});');
		writeServerFile(root, "nested/helper.ts", "const key = 'RUN_INTEGRATION';");
		writeServerFile(
			root,
			"nested/columns-remap.scenarios.ts",
			'describe.skipIf(!process.env.RUN_INTEGRATION)("remap", () => {});',
		);
		writeServerFile(
			root,
			"nested/unimported.scenarios.ts",
			'describe.skipIf(!process.env.RUN_INTEGRATION)("unimported", () => {});',
		);
		writeServerFile(
			root,
			"nested/remap.integration.test.ts",
			'import "./columns-remap.scenarios.js";\n',
		);
		writeFileSync(join(root, "server", "package.json"), '"RUN_INTEGRATION"');

		const expected = [
			"src/nested/db.integration.test.ts",
			"src/nested/mixed.test.ts",
			"src/nested/remap.integration.test.ts",
			"src/root.test.ts",
		];
		assert.deepEqual(listIntegrationTests(root), expected);

		const result = spawnSync("node", [cliScript, "--root", root], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(result.stdout.trim().split("\n"), expected);
	});
});

test("returns an empty list when no server tests reference RUN_INTEGRATION", () => {
	withTempRoot((root) => {
		writeServerFile(root, "unit.test.ts", 'describe("unit", () => {});');
		assert.deepEqual(listIntegrationTests(root), []);

		const result = spawnSync("node", [cliScript, "--root", root], {
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/No server \.test\.ts files reference RUN_INTEGRATION/,
		);
	});
});

test("returns an empty list when server/src is missing", () => {
	withTempRoot((root) => {
		assert.deepEqual(listIntegrationTests(root), []);
	});
});

test("real repo selects skipIf-gated tests including imported scenario suites", () => {
	const selected = listIntegrationTests();
	assert.ok(
		selected.includes(
			"src/modules/board/columns-is-done-remap.integration.test.ts",
		),
		"columns-is-done-remap.integration.test.ts must be selected via scenario imports",
	);
	const gated = listSkipIfGatedTests();
	for (const file of gated) {
		assert.ok(
			selected.includes(file),
			`${file} is skipIf-gated but not selected for DB`,
		);
	}
	assert.ok(
		selected.length >= 81,
		`expected at least 81 selected files, got ${selected.length}`,
	);
});
