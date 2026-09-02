#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "client/src";
const ALLOWLIST = new Set([
	"client/src/lib/workItemMutations.ts",
	"client/src/api.ts",
	"client/src/context/BoardContext.tsx",
]);
const FORBIDDEN = /\bapi\.(updateWorkItem|updateTrackerItem|updateCard)\b/;

function walk(dir, files = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			walk(path, files);
		} else if (/\.(ts|tsx)$/.test(name)) {
			files.push(path);
		}
	}
	return files;
}

const violations = [];
for (const file of walk(ROOT)) {
	const rel = relative(".", file).replace(/\\/g, "/");
	if (ALLOWLIST.has(rel)) continue;
	if (/\.test\.(ts|tsx)$/.test(rel)) continue;

	const lines = readFileSync(file, "utf8").split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (FORBIDDEN.test(line)) {
			violations.push(`${rel}:${i + 1}: ${line.trim()}`);
		}
	}
}

if (violations.length > 0) {
	console.error(
		"Work item mutation routing violations (route via workItemMutations.ts):\n" +
			violations.join("\n"),
	);
	process.exit(1);
}

console.log("Work item mutation routing check passed.");
