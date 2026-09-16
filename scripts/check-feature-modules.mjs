#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertBaseRefResolvable, collectGitDiff } from "./feature-modules/git-diff.mjs";
import * as map from "./feature-modules/map.mjs";
import { collectImportViolations } from "./feature-modules/imports.mjs";
import { collectPlacementViolations } from "./feature-modules/placement.mjs";

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

function main() {
	const { baseRef, rootArg } = parseArgs(process.argv);
	const rootDir = resolve(rootArg);

	try {
		assertBaseRefResolvable(baseRef, rootDir);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(1);
	}

	const diff = collectGitDiff(rootDir, baseRef);
	const placementViolations = collectPlacementViolations({ ...diff, map });
	const importViolations = collectImportViolations({ rootDir, map });

	/** @type {string[]} */
	const allViolations = [...placementViolations, ...importViolations];

	if (allViolations.length > 0) {
		const placementOnly = placementViolations.length > 0;
		const importOnly = importViolations.length > 0;
		const header = placementOnly && importOnly
			? "Feature module violations:"
			: placementOnly
				? "Feature module placement violations:"
				: "Feature module import violations:";
		console.error(header + "\n" + allViolations.join("\n"));
		process.exit(1);
	}

	console.log(`Feature module check: base-ref=${baseRef} root=${rootArg}`);
	console.log("Feature module check passed.");
}

const invokedFromCli =
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedFromCli) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
