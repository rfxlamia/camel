export {
	DEEP_IMPORT_RULE_ID,
	FORBIDDEN_FEATURE_RULE_ID,
	MISSING_INDEX_RULE_ID,
	ONE_WAY_RULE_ID,
	checkImports,
} from "./import-wall-rules.mjs";

export {
	checkMissingModuleIndexes,
	collectImportViolations,
} from "./import-wall-scan.mjs";

export { extractImportSpecifiers } from "./import-specifiers.mjs";
