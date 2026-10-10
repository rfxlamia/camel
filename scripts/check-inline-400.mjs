#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// AST-only detector for literal 400 method calls. Dynamic codes such as
// res.status(code) are intentionally NOT flagged; no constant evaluation occurs.
// Importing this module does not run a CLI or read files.
const METHODS = new Set(["status", "sendStatus", "writeHead"]);

export function scanSource(text, relPath) {
	const source = ts.createSourceFile(
		relPath,
		text,
		ts.ScriptTarget.Latest,
		true,
	);
	const violations = [];

	function visit(node) {
		if (ts.isCallExpression(node)) {
			const callee = node.expression;
			const firstArgument = node.arguments[0];
			let method;
			if (ts.isPropertyAccessExpression(callee)) {
				method = callee.name;
			} else if (
				ts.isElementAccessExpression(callee) &&
				callee.argumentExpression &&
				ts.isStringLiteral(callee.argumentExpression)
			) {
				method = callee.argumentExpression;
			}
			if (
				method &&
				METHODS.has(method.text) &&
				firstArgument &&
				ts.isNumericLiteral(firstArgument) &&
				Number(firstArgument.text) === 400
			) {
				// Use the method token's start, excluding receiver and comment trivia.
				const { line } = source.getLineAndCharacterOfPosition(
					method.getStart(source),
				);
				violations.push({ line: line + 1 });
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(source);
	return violations;
}

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST = new Set(["server/src/validators/http.ts"]);
const SKIP = /(?:\.test\.ts|\.test-support\.ts|\.d\.ts)$/;

// This walk/skip logic intentionally mirrors check-event-write-routing.mjs and
// the check-work-item-mutation-routing.mjs / check-feature-modules.mjs family.
// Those scripts run their CLI at import time and cannot be imported, so a shared
// scripts/lib/walk.mjs extraction is deferred.
function walk(dir, files = []) {
	const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "__tests__") walk(path, files);
		} else if (
			entry.isFile() &&
			entry.name.endsWith(".ts") &&
			!SKIP.test(entry.name)
		) {
			files.push(path);
		}
	}
	return files;
}

function runCli(args) {
	let root = REPO_ROOT;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--root") {
			if (!args[index + 1] || args[index + 1].startsWith("--")) {
				console.error("Usage: check-inline-400.mjs [--root <dir>]");
				return 1;
			}
			root = args[index + 1];
			index += 1;
		} else {
			console.error(`Unknown argument: ${args[index]}`);
			return 1;
		}
	}

	const sourceRoot = join(root, "server/src");
	if (!existsSync(sourceRoot)) {
		console.error(`Inline 400 check: ${sourceRoot} not found.`);
		return 1;
	}

	const violations = [];
	for (const file of walk(sourceRoot)) {
		const rel = relative(root, file).replace(/\\/g, "/");
		if (ALLOWLIST.has(rel)) continue;
		const text = readFileSync(file, "utf8");
		for (const { line } of scanSource(text, rel)) {
			violations.push(`${rel}:${line}`);
		}
	}

	if (violations.length > 0) {
		console.log(violations.sort().join("\n"));
		return 1;
	}
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = runCli(process.argv.slice(2));
}
