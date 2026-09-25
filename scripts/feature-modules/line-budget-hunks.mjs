/**
 * @param {string} hunks
 */
function parseChangedLines(hunks) {
	/** @type {string[]} */
	const removed = [];
	/** @type {string[]} */
	const added = [];
	let inHunk = false;
	for (const line of hunks.split("\n")) {
		if (line.startsWith("@@")) {
			inHunk = true;
			continue;
		}
		if (!inHunk) continue;
		if (line.startsWith("-")) removed.push(line.slice(1));
		else if (line.startsWith("+")) added.push(line.slice(1));
	}
	return { removed, added };
}

/**
 * @param {string} line
 */
function collapseWhitespace(line) {
	return line.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} hunks
 */
function isWhitespaceOnlyHunks(hunks) {
	const { removed, added } = parseChangedLines(hunks);
	if (removed.length === 0 && added.length === 0) return true;
	if (removed.length !== added.length) return false;
	for (let i = 0; i < removed.length; i++) {
		if (collapseWhitespace(removed[i]) !== collapseWhitespace(added[i])) {
			return false;
		}
	}
	return true;
}

/**
 * @param {string} line
 */
function isImportOrExportFromLine(line) {
	const trimmed = line.trim();
	return (
		trimmed.startsWith("import ") ||
		/^import\s*\(/.test(trimmed) ||
		/^export\s+\{/.test(trimmed) ||
		/^export\s+\*\s+from\s/.test(trimmed) ||
		/^export\s+type\s+\*\s+from\s/.test(trimmed) ||
		/^export\s+type\s+\{/.test(trimmed)
	);
}

/**
 * Continuation lines of a formatted import/export, plus one-line forms.
 * @param {string} line
 */
function isImportRelatedLine(line) {
	const trimmed = line.trim();
	if (trimmed === "") return true;
	if (isImportOrExportFromLine(line)) return true;
	if (/^}?\s*from\s+['"]/.test(trimmed)) return true;
	if (trimmed === "{" || trimmed === "}" || trimmed === "},") return true;
	if (/^(type\s+)?[\w$]+,?\s*$/.test(trimmed)) return true;
	return false;
}

/**
 * Blank out quoted module specifiers so only bindings remain for comparison.
 * @param {string} text
 */
function stripQuotedModuleSpecifiers(text) {
	return text
		.replace(/(from\s+)['"][^'"]+['"]/g, '$1""')
		.replace(/\bimport\s*\(\s*['"][^'"]+['"]/g, 'import(""')
		.replace(/\bimport\s+['"][^'"]+['"]/g, 'import ""');
}

/**
 * Exempt only when the quoted module path changed (including multiline `from`).
 * Binding / new-import changes are a touch.
 * @param {string} hunks
 */
function isImportSpecifierOnlyHunks(hunks) {
	const { removed, added } = parseChangedLines(hunks);
	const changed = [...removed, ...added];
	if (changed.length === 0) return true;
	if (!changed.every(isImportRelatedLine)) return false;
	// Sort stripped lines so a pure reorder stays trivial: biome
	// organizeImports force-reorders imports on amend.
	const fingerprint = (lines) =>
		lines
			.map((line) => collapseWhitespace(stripQuotedModuleSpecifiers(line)))
			.sort()
			.join("\n");
	return fingerprint(removed) === fingerprint(added);
}

/**
 * @param {string} hunks
 */
export function isNonTrivialTouch(hunks) {
	if (isWhitespaceOnlyHunks(hunks)) return false;
	if (isImportSpecifierOnlyHunks(hunks)) return false;
	return true;
}
