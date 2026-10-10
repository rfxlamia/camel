import assert from "node:assert/strict";
import test from "node:test";

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
