#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

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

export function listIntegrationTests(root = REPO_ROOT) {
	const serverRoot = join(root, "server");
	const sourceRoot = join(serverRoot, "src");
	return walk(sourceRoot)
		.filter((path) => readFileSync(path, "utf8").includes("RUN_INTEGRATION"))
		.map((path) => relative(serverRoot, path).split(sep).join("/"))
		.sort();
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
