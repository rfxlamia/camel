/**
 * @param {string} ch
 */
function isIdentChar(ch) {
	return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * @param {string} source
 * @param {number} i
 * @param {number} len
 * @returns {number | null} next index after skip, or null
 */
function skipLineComment(source, i, len) {
	if (source[i] !== "/" || source[i + 1] !== "/") return null;
	i += 2;
	while (i < len && source[i] !== "\n") i++;
	return i;
}

/**
 * @param {string} source
 * @param {number} i
 * @param {number} len
 * @returns {number | null}
 */
function skipBlockComment(source, i, len) {
	if (source[i] !== "/" || source[i + 1] !== "*") return null;
	i += 2;
	while (i < len - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
	return i + 2;
}

/**
 * @param {string} source
 * @param {number} i
 * @param {number} len
 * @param {string[]} specifiers
 * @returns {number} index after the matching `}`
 */
function scanInterpolation(source, i, len, specifiers) {
	let depth = 1;
	while (i < len && depth > 0) {
		const next =
			skipLineComment(source, i, len) ??
			skipBlockComment(source, i, len) ??
			tryCaptureImportSpecifier(source, i, len, specifiers) ??
			skipTemplateLiteral(source, i, len, specifiers) ??
			skipStringLiteral(source, i, len);
		if (next !== null) {
			i = next;
			continue;
		}
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) return i + 1;
		}
		i++;
	}
	return i;
}

/**
 * @param {string} source
 * @param {number} i
 * @param {number} len
 * @param {string[]} specifiers
 * @returns {number | null}
 */
function skipTemplateLiteral(source, i, len, specifiers) {
	if (source[i] !== "`") return null;
	i++;
	while (i < len) {
		if (source[i] === "\\") {
			i += 2;
			continue;
		}
		if (source[i] === "`") return i + 1;
		if (source[i] === "$" && source[i + 1] === "{") {
			i = scanInterpolation(source, i + 2, len, specifiers);
			continue;
		}
		i++;
	}
	return len;
}

/**
 * @param {string} source
 * @param {number} i
 * @param {number} len
 * @returns {number | null}
 */
function skipStringLiteral(source, i, len) {
	const quote = source[i];
	if (quote !== "'" && quote !== '"') return null;
	i++;
	while (i < len) {
		if (source[i] === "\\") {
			i += 2;
			continue;
		}
		if (source[i] === quote) return i + 1;
		i++;
	}
	return len;
}

/**
 * @param {string} source
 * @param {number} i
 * @param {number} len
 * @param {string[]} specifiers
 * @returns {number | null}
 */
function tryCaptureImportSpecifier(source, i, len, specifiers) {
	const atWordStart = i === 0 || !isIdentChar(source[i - 1]);
	if (atWordStart && source.startsWith("import", i)) {
		const afterKeyword = source.slice(i + 6);
		if (/^\s*\(/.test(afterKeyword)) {
			const match = source
				.slice(i)
				.match(/^import\s*\(\s*(?:['"]([^'"]+)['"]|`([^`$]*)`)\s*\)/);
			if (match) {
				specifiers.push(match[1] ?? match[2]);
				return i + match[0].length;
			}
		}
	}
	const staticImport = source.slice(i).match(
		/^(?:import\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+)['"]([^'"]+)['"]/,
	);
	if (staticImport) {
		specifiers.push(staticImport[1]);
		return i + staticImport[0].length;
	}
	return null;
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function extractImportSpecifiers(source) {
	/** @type {string[]} */
	const specifiers = [];
	let i = 0;
	const len = source.length;

	while (i < len) {
		const next =
			skipLineComment(source, i, len) ??
			skipBlockComment(source, i, len) ??
			tryCaptureImportSpecifier(source, i, len, specifiers) ??
			skipTemplateLiteral(source, i, len, specifiers) ??
			skipStringLiteral(source, i, len);

		if (next !== null) {
			i = next;
			continue;
		}
		i++;
	}

	return specifiers;
}
