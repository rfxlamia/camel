import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliScript = join(repoRoot, "scripts/check-inline-400.mjs");

function withTempRoot(run) {
	const root = mkdtempSync(join(tmpdir(), "inline-400-"));
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeSource(root, path, source) {
	const file = join(root, "server/src", path);
	mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
	writeFileSync(file, source);
}

function runCli(args) {
	return spawnSync("node", [cliScript, ...args], {
		cwd: repoRoot,
		encoding: "utf8",
	});
}

// Keep dependency resolution independent of the detector's missing-module RED.
test("workspace TypeScript resolves from scripts and exposes createSourceFile", async () => {
	const ts = await import("typescript");
	assert.equal(typeof ts.createSourceFile, "function");
});

const scan = async (text, relPath = "server/src/example.ts") => {
	const { scanSource } = await import("./check-inline-400.mjs");
	return scanSource(text, relPath);
};

for (const [name, source, expected] of [
	["status JSON chain", "\nres.status(400).json({});", [{ line: 2 }]],
	[
		"multiline status uses method line, not receiver or argument",
		"res\n  .status(\n    400\n  )",
		[{ line: 2 }],
	],
	["sendStatus", "res.sendStatus(400)", [{ line: 1 }]],
	["writeHead", "res.writeHead(400, {})", [{ line: 1 }]],
	["string-literal element access", 'res["status"](400)', [{ line: 1 }]],
	[
		"multiline element access uses string token line",
		'res[\n  "status"\n](400)',
		[{ line: 2 }],
	],
	[
		"comments and literal text",
		'// res.status(400)\n/* res.sendStatus(400) */\nconst a = "res.status(400)";\nconst b = `res.writeHead(400)`;',
		[],
	],
	[
		"other codes, dynamic codes, and expressions",
		"res.status(404); res.status(409); res.status(500); res.status(code); res.status(400 + 1);",
		[],
	],
	[
		"two distinct violation lines",
		"res.status(400);\n\nres.sendStatus(400);",
		[{ line: 1 }, { line: 3 }],
	],
	[
		"non-method calls and computed property expressions",
		'status(400); res[method](400); res[`status`](400); res["sta" + "tus"](400); res.other(400); res.status("400"); res.status();',
		[],
	],
	[
		"optional method calls",
		"res?.status(400);\nres.sendStatus?.(400);",
		[{ line: 1 }, { line: 2 }],
	],
	[
		"comments before a method do not affect its token line",
		"res. /* comment\n */ status(400)",
		[{ line: 2 }],
	],
]) {
	test(name, async () => {
		assert.deepEqual(await scan(source), expected);
	});
}

test("TSX source is traversed without mistaking JSX text for calls", async () => {
	assert.deepEqual(
		await scan(
			"const view = <div>res.status(400){res.status(400)}</div>;",
			"server/src/example.tsx",
		),
		[{ line: 1 }],
	);
});

test("Given a temp root with a clean server/src Then the CLI exits 0", () => {
	withTempRoot((root) => {
		mkdirSync(join(root, "server/src"), { recursive: true });
		const result = runCli(["--root", root]);
		assert.equal(result.status, 0, result.stderr || result.stdout);
	});
});

test('Given server/src/modules/board/foo.ts containing res.status(400).json({ error: "x" }) Then exit 1 and stdout contains server/src/modules/board/foo.ts:<line>', () => {
	withTempRoot((root) => {
		writeSource(
			root,
			"modules/board/foo.ts",
			'\nres.status(400).json({ error: "x" });\n',
		);
		const result = runCli(["--root", root]);
		assert.equal(result.status, 1, result.stderr || result.stdout);
		assert.equal(result.stdout.trim(), "server/src/modules/board/foo.ts:2");
	});
});

test("Given the same text in foo.test.ts, foo.test-support.ts, foo.d.ts and __tests__/foo.ts Then exit 0", () => {
	withTempRoot((root) => {
		const source = 'res.status(400).json({ error: "x" });\n';
		writeSource(root, "modules/board/foo.test.ts", source);
		writeSource(root, "modules/board/foo.test-support.ts", source);
		writeSource(root, "modules/board/foo.d.ts", source);
		writeSource(root, "modules/board/__tests__/foo.ts", source);
		const result = runCli(["--root", root]);
		assert.equal(result.status, 0, result.stderr || result.stdout);
	});
});

test("Given the text in server/src/validators/http.ts Then exit 0, but in server/src/validators/other.ts Then exit 1", () => {
	withTempRoot((root) => {
		writeSource(root, "validators/http.ts", "res.status(400);\n");
		const allowed = runCli(["--root", root]);
		assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);

		writeSource(root, "validators/other.ts", "res.status(400);\n");
		const forbidden = runCli(["--root", root]);
		assert.equal(forbidden.status, 1, forbidden.stderr || forbidden.stdout);
		assert.match(forbidden.stdout, /server\/src\/validators\/other\.ts:1/);
	});
});

test("Given a missing server/src under --root Then exit 1 with an explanatory message", () => {
	withTempRoot((root) => {
		const result = runCli(["--root", root]);
		assert.equal(result.status, 1, result.stderr || result.stdout);
		assert.match(
			`${result.stdout}\n${result.stderr}`,
			/server\/src.*not found/i,
		);
	});
});

test("Given the real repository root with no arguments Then exit 0", () => {
	const result = runCli([]);
	assert.equal(result.status, 0, result.stderr || result.stdout);
});
