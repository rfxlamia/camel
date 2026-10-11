#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RELATIVE_IMPORT = /(?:from|import)\s+["'](\.\.?\/[^"']+)["']/g;
const SKIP_IF_GATE = "skipIf(!process.env.RUN_INTEGRATION)";

function walk(directory, files = []) {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return files;
		throw error;
	}

	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			walk(path, files);
		} else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
			files.push(path);
		}
	}
	return files;
}

function readText(path) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

function isInside(root, path) {
	const relativePath = relative(root, path);
	return (
		relativePath !== "" &&
		!relativePath.startsWith(`..${sep}`) &&
		!relativePath.startsWith("..") &&
		!relativePath.startsWith(sep)
	);
}

function resolveRelativeImport(fromFile, specifier, sourceRoot) {
	const raw = resolve(dirname(fromFile), specifier);
	const candidates = specifier.endsWith(".js")
		? [raw.slice(0, -3) + ".ts", raw]
		: [raw, `${raw}.ts`];
	for (const candidate of candidates) {
		if (!isInside(sourceRoot, candidate)) continue;
		if (readText(candidate) !== null) return candidate;
	}
	return null;
}

function oneHopImports(fromFile, text, sourceRoot) {
	const imports = [];
	for (const match of text.matchAll(RELATIVE_IMPORT)) {
		const resolved = resolveRelativeImport(fromFile, match[1], sourceRoot);
		if (resolved) imports.push(resolved);
	}
	return imports;
}

function fileMentions(path, needle) {
	const text = readText(path);
	return Boolean(text?.includes(needle));
}

function testFileMatches(path, sourceRoot, needle) {
	const text = readText(path);
	if (!text) return false;
	if (text.includes(needle)) return true;
	return oneHopImports(path, text, sourceRoot).some((imported) =>
		fileMentions(imported, needle),
	);
}

function listMatchingTests(root, needle) {
	const serverRoot = join(root, "server");
	const sourceRoot = join(serverRoot, "src");
	return walk(sourceRoot)
		.filter((path) => testFileMatches(path, sourceRoot, needle))
		.map((path) => relative(serverRoot, path).split(sep).join("/"))
		.sort();
}

export function listIntegrationTests(root = REPO_ROOT) {
	return listMatchingTests(root, "RUN_INTEGRATION");
}

export function listSkipIfGatedTests(root = REPO_ROOT) {
	return listMatchingTests(root, SKIP_IF_GATE);
}

function runCli(args) {
	let root = REPO_ROOT;
	for (let index = 0; index < args.length; index += 1) {
		if (
			args[index] === "--root" &&
			args[index + 1] &&
			!args[index + 1].startsWith("--")
		) {
			root = args[index + 1];
			index += 1;
		} else {
			console.error("Usage: list-integration-tests.mjs [--root <dir>]");
			return 1;
		}
	}

	const files = listIntegrationTests(root);
	if (files.length === 0) {
		console.error("No server .test.ts files reference RUN_INTEGRATION.");
		return 1;
	}
	console.log(files.join("\n"));
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = runCli(process.argv.slice(2));
}
