#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertBaseRefResolvable } from "./feature-modules/git-diff.mjs";

/** @param {string[]} argv */
function parseArgs(argv) {
	let baseRef = "origin/main";
	let rootArg = ".";
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--base-ref" && argv[i + 1]) {
			baseRef = argv[++i];
		} else if (arg === "--root" && argv[i + 1]) {
			rootArg = argv[++i];
		}
	}
	return { baseRef, rootArg };
}

async function main() {
	const { baseRef, rootArg } = parseArgs(process.argv);
	const rootDir = resolve(rootArg);

	try {
		assertBaseRefResolvable(baseRef, rootDir);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(1);
	}

	await import("./feature-modules/map.mjs");

	console.log(`Feature module check: base-ref=${baseRef} root=${rootArg}`);
	console.log("Feature module check passed.");
}

const invokedFromCli =
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedFromCli) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
