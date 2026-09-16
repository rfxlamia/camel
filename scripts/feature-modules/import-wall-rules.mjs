import { KERNEL_IN_WAITING } from "./map.mjs";
import {
	classifyModuleTarget,
	fileDir,
	FORBIDDEN_PRODUCT_FEATURES,
	isAllowlistedKernelInWaiting,
	isIndexImport,
	isKernelPath,
	isLegacyFeaturePath,
	parseImporterFeature,
	resolveRelativeSpecifier,
	toPosix,
} from "./import-paths.mjs";
import { extractImportSpecifiers } from "./import-specifiers.mjs";

export const DEEP_IMPORT_RULE_ID = "FM-RULE-4";
export const ONE_WAY_RULE_ID = "FM-RULE-4";
export const MISSING_INDEX_RULE_ID = "FM-RULE-4";
export const FORBIDDEN_FEATURE_RULE_ID = "FM-RULE-4";

const TS_SOURCE = /\.(ts|tsx)$/i;

/**
 * @param {string} filePath
 * @param {string} specifier
 * @param {string} resolved
 * @param {import("./map.mjs")} mapConfig
 */
function checkSpecifier({ filePath, specifier, resolved, mapConfig }) {
	/** @type {string[]} */
	const violations = [];
	const allowlist = mapConfig.KERNEL_IN_WAITING ?? KERNEL_IN_WAITING;

	const importerFeature = parseImporterFeature(filePath);
	const target = classifyModuleTarget(resolved);

	if (target?.feature && FORBIDDEN_PRODUCT_FEATURES.has(target.feature)) {
		violations.push(
			`${filePath}: ${FORBIDDEN_FEATURE_RULE_ID}: forbidden product feature "${target.feature}" (${specifier})`,
		);
		return violations;
	}

	if (target?.deep) {
		const sameModule =
			importerFeature &&
			importerFeature.side === target.side &&
			importerFeature.feature === target.feature;

		if (!sameModule && !isIndexImport(resolved, target.root)) {
			violations.push(
				`${filePath}: ${DEEP_IMPORT_RULE_ID}: deep import into feature module "${target.feature}" must use index.ts (${specifier})`,
			);
		}
	}

	if (importerFeature && isKernelPath(resolved)) {
		return violations;
	}

	if (importerFeature && isLegacyFeaturePath(resolved)) {
		if (!isAllowlistedKernelInWaiting(resolved, allowlist)) {
			violations.push(
				`${filePath}: ${ONE_WAY_RULE_ID}: module must not import legacy feature file (${specifier})`,
			);
		}
	}

	return violations;
}

/**
 * @param {{ filePath: string, source: string, map: import("./map.mjs") }} input
 * @returns {string[]}
 */
export function checkImports({ filePath, source, map: mapConfig }) {
	const normalizedPath = toPosix(filePath);
	if (!TS_SOURCE.test(normalizedPath)) return [];

	const fromDir = fileDir(normalizedPath);
	/** @type {string[]} */
	const violations = [];

	for (const specifier of extractImportSpecifiers(source)) {
		if (!specifier.startsWith(".")) continue;
		const resolved = resolveRelativeSpecifier(fromDir, specifier);
		violations.push(
			...checkSpecifier({
				filePath: normalizedPath,
				specifier,
				resolved,
				mapConfig,
			}),
		);
	}

	return violations;
}
