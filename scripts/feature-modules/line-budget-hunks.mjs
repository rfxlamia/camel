import { posix } from "node:path";

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

const URL_LITERAL = /new URL\(\s*(['"])([^'"]*)\1\s*,\s*import\.meta\.url\s*\)/;

/**
 * @param {string} line
 */
function isUrlLiteralLine(line) {
	return URL_LITERAL.test(line);
}

/**
 * Same `new URL("<relative>", import.meta.url)` expression, literal blanked.
 * @param {string} line
 */
function urlLineShape(line) {
	return collapseWhitespace(
		line.replace(URL_LITERAL, 'new URL("", import.meta.url)'),
	);
}

/**
 * Trivial only when the rest of the line is identical and both literals are
 * relative and resolve to the same target from the old and new file locations.
 * @param {string} removedLine
 * @param {string} addedLine
 * @param {{ fromPath?: string, path?: string }} context
 */
function isResolutionEquivalentUrl(removedLine, addedLine, context) {
	const { fromPath, path } = context;
	if (!path) return false;
	if (urlLineShape(removedLine) !== urlLineShape(addedLine)) return false;
	const before = URL_LITERAL.exec(removedLine)?.[2];
	const after = URL_LITERAL.exec(addedLine)?.[2];
	if (before === undefined || after === undefined) return false;
	if (!/^\.\.?\//.test(before) || !/^\.\.?\//.test(after)) return false;
	const resolve = (dir, literal) => posix.normalize(posix.join(dir, literal));
	return (
		resolve(posix.dirname(fromPath ?? path), before) ===
		resolve(posix.dirname(path), after)
	);
}

/**
 * Bindings (with `type` qualifier) introduced by import lines. Module
 * specifiers are ignored and default-vs-named kind is ignored, so a
 * default-to-named conversion that keeps every local name stays comparable.
 * An aliased import (`x as y`) keeps its imported name: it binds a specific
 * export, so changing `x` is a real change even when `y` is unchanged.
 * Returns null when a line cannot be reduced to bindings.
 * @param {string[]} lines
 * @returns {string[] | null}
 */
function importBindings(lines) {
	/** @type {string[]} */
	const bindings = [];
	let inTypeStatement = false;
	for (const raw of lines) {
		let line = collapseWhitespace(stripQuotedModuleSpecifiers(raw));
		if (line === "") continue;
		if (/^export\b/.test(line)) return null;
		if (/^import\s*\(/.test(line)) return null;
		if (/^import\b/.test(line)) {
			inTypeStatement = /^import\s+type\b/.test(line);
			line = line.replace(/^import\s+(type\s+)?/, "");
		}
		const closes = /\bfrom\s*""\s*;?$/.test(line);
		line = line.replace(/\bfrom\s*""\s*;?$/, "").replace(/[{}]/g, " ");
		for (const part of line.split(",")) {
			let name = part.trim();
			if (name === "" || name === '""') continue;
			let isType = inTypeStatement;
			if (/^type\s+/.test(name)) {
				isType = true;
				name = name.replace(/^type\s+/, "");
			}
			// An alias binds a specific export, so its imported name is part of the
			// token; `default as X` is the same binding as `import X`.
			const alias = /^([\w$]+|\*)\s+as\s+([\w$]+)$/.exec(name);
			let token;
			if (alias) {
				token =
					alias[1] === "default" ? alias[2] : `${alias[1]} as ${alias[2]}`;
			} else if (/^[\w$]+$/.test(name)) {
				token = name;
			} else {
				return null;
			}
			bindings.push(`${isType ? "type " : ""}${token}`);
		}
		if (closes) inTypeStatement = false;
	}
	return bindings.sort();
}

/**
 * @param {string[]} removed
 * @param {string[]} added
 */
function haveSameImportBindings(removed, added) {
	const before = importBindings(removed);
	const after = importBindings(added);
	if (before === null || after === null) return false;
	return before.join("\n") === after.join("\n");
}

/**
 * @param {string[]} removed
 * @param {string[]} added
 */
function isImportOnlyChange(removed, added) {
	if (removed.length === 0 && added.length === 0) return true;
	const fingerprint = (lines) =>
		lines
			.map((line) => collapseWhitespace(stripQuotedModuleSpecifiers(line)))
			.sort()
			.join("\n");
	if (fingerprint(removed) === fingerprint(added)) return true;
	return haveSameImportBindings(removed, added);
}

/**
 * @param {string} hunks
 * @param {{ fromPath?: string, path?: string }} [context] old/new file paths
 */
export function isNonTrivialTouch(hunks, context = {}) {
	if (isWhitespaceOnlyHunks(hunks)) return false;

	const { removed, added } = parseChangedLines(hunks);
	const removedUrls = removed.filter(isUrlLiteralLine);
	const addedUrls = added.filter(isUrlLiteralLine);
	const removedRest = removed.filter((line) => !isUrlLiteralLine(line));
	const addedRest = added.filter((line) => !isUrlLiteralLine(line));

	if (removedUrls.length !== addedUrls.length) return true;
	if (
		!removedUrls.every((line, i) =>
			isResolutionEquivalentUrl(line, addedUrls[i], context),
		)
	) {
		return true;
	}

	if (![...removedRest, ...addedRest].every(isImportRelatedLine)) return true;
	return !isImportOnlyChange(removedRest, addedRest);
}
