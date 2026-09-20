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
 * Token stream for rewrap-insensitive comparison (Cycle-K fingerprint).
 * Every run of `[A-Za-z0-9_$]` is one token; every other non-whitespace
 * character is its own token; whitespace itself contributes no tokens.
 * Single/double-quoted strings and template literals are kept intact as
 * single tokens (escapes respected) so `"a b"` vs `"ab"` still differs,
 * with runs of whitespace inside them collapsed to one space so a pure
 * reflow inside a template literal stays trivial.
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeForEquivalence(text) {
	const tokens = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			let token = ch;
			i++;
			while (i < text.length) {
				const c = text[i];
				if (c === "\\" && i + 1 < text.length) {
					token += c + text[i + 1];
					i += 2;
					continue;
				}
				token += c;
				i++;
				if (c === ch) break;
			}
			tokens.push(token.replace(/\s+/g, " "));
			continue;
		}
		if (/[A-Za-z0-9_$]/.test(ch)) {
			let j = i + 1;
			while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) j++;
			tokens.push(text.slice(i, j));
			i = j;
			continue;
		}
		tokens.push(ch);
		i++;
	}
	return tokens;
}

/**
 * Closing brackets/parens/braces for trailing-comma rewrap tolerance.
 * @param {string|undefined} token
 */
function isClosingBracket(token) {
	return token === "]" || token === ")" || token === "}";
}

/**
 * Token-stream comparison over an explicit line subset
 * (Cycle-K fingerprint factored out so the mixed-hunk split in
 * isNonTrivialTouch can reuse it without duplicating logic).
 * @param {string[]} removed
 * @param {string[]} added
 */
function isWhitespaceEquivalentLines(removed, added) {
	if (removed.length === 0 && added.length === 0) return true;
	// Why token streams instead of collapsing `\s+` to single spaces?
	// A line break's position relative to punctuation changes where the
	// collapsed space lands, so a pure rewrap compares UNEQUAL:
	// `(messages:` + newline fingerprints as `(messages`, but
	// `(␣messages:` fingerprints as `( messages`; likewise `):` vs `) :`,
	// `??` + newline, and `.` + newline in method chains. Comparing token
	// streams (whitespace contributes no tokens at all) makes break
	// position irrelevant: identical tokens in identical order stay
	// trivial (biome formatter reflows bodies on commit, and relocation
	// hunks must not trip FM-RULE-3 on reflow). ANY token difference
	// (identifier, operator, literal, punctuation) still mismatches and
	// stays a touch — EXCEPT a comma immediately before a closing
	// bracket/paren/brace, which the biome formatter adds and removes as
	// part of multi-line vs single-line reflow (`Item[],` vs `Item[]`):
	// that comma is rewrap, not content, so it is dropped from the stream.
	// Residual risk: whitespace-only changes inside string literals are
	// invisible to this comparison — accepted: tests + human review cover
	// string-content changes.
	const fingerprint = (lines) => {
		const tokens = tokenizeForEquivalence(lines.join("\n"));
		const filtered = tokens.filter(
			(token, index) => token !== "," || !isClosingBracket(tokens[index + 1]),
		);
		return filtered.join("\0");
	};
	return fingerprint(removed) === fingerprint(added);
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
 * Sort comma-separated bindings inside `{ ... }` so an intra-line reorder
 * stays trivial. Biome organizeImports reorders bindings within one import
 * line on commit (e.g. `{ sql, type Selectable }` vs `{ type Selectable, sql }`).
 * @param {string} line
 */
function normalizeBindingOrder(line) {
	return line.replace(/\{([^}]*)\}/g, (_, inner) => {
		const bindings = inner
			.split(",")
			.map((binding) => binding.trim())
			.filter(Boolean)
			.sort();
		return `{ ${bindings.join(", ")} }`;
	});
}

/**
 * Sorted multiset of every identifier bound by the changed import/export
 * lines (module specifiers ignored, `type` modifiers kept). Multiline blocks
 * contribute their bare continuation lines (`countSearchResults,`) alongside
 * single-line brace groups, so N leaf imports consolidated into one barrel
 * import compare equal when the global binding set is identical.
 * @param {string[]} lines
 */
function extractImportBindings(lines) {
	/** @type {string[]} */
	const bindings = [];
	for (const line of lines) {
		const trimmed = line.trim();
		const braceMatch = trimmed.match(/\{([^}]*)\}/);
		if (braceMatch) {
			for (const part of braceMatch[1].split(",")) {
				const binding = part.trim().replace(/\s+/g, " ");
				if (binding) bindings.push(binding);
			}
			const defaultMatch = trimmed.match(/^import\s+(?:type\s+)?([\w$]+)\s*,/);
			if (defaultMatch) bindings.push(defaultMatch[1]);
			continue;
		}
		if (/^import\s*\{?\s*$/.test(trimmed)) continue;
		if (/^}?\s*from\s+['"]/.test(trimmed)) continue;
		if (trimmed === "{" || trimmed === "}" || trimmed === "},") continue;
		if (trimmed === "") continue;
		if (/^(type\s+)?[\w$]+\s*,?\s*$/.test(trimmed)) {
			bindings.push(trimmed.replace(/,\s*$/, "").replace(/\s+/g, " "));
			continue;
		}
		const defaultOnly = trimmed.match(
			/^import\s+(?:type\s+)?([\w$]+)\s+from\s+['"]/,
		);
		if (defaultOnly) {
			bindings.push(defaultOnly[1]);
			continue;
		}
		const namespace = trimmed.match(
			/^import\s+\*\s+as\s+([\w$]+)\s+from\s+['"]/,
		);
		if (namespace) {
			bindings.push(namespace[1]);
		}
	}
	return bindings.sort();
}

/**
 * Import-specifier-only comparison over an explicit line subset.
 * Exempt only when the quoted module path changed (including multiline `from`).
 * Binding / new-import changes are a touch.
 * An empty subset counts as trivial (pure-rewrap mixed hunks need this).
 * @param {string[]} removed
 * @param {string[]} added
 */
function isImportSpecifierOnlyLines(removed, added) {
	const changed = [...removed, ...added];
	if (changed.length === 0) return true;
	if (!changed.every(isImportRelatedLine)) return false;
	// Sort stripped lines so a pure reorder stays trivial: biome
	// organizeImports force-reorders imports on amend. Binding order within
	// one line is normalized too (see normalizeBindingOrder).
	// Additionally compare the global binding multiset so barrel
	// consolidation during relocation (N leaf imports merged into one barrel
	// import with the identical binding set) stays trivial even though the
	// line structure differs. A binding ADD or REMOVE changes the multiset
	// and stays a touch.
	const fingerprint = (lines) =>
		lines
			.map((line) =>
				collapseWhitespace(
					normalizeBindingOrder(stripQuotedModuleSpecifiers(line)),
				),
			)
			.sort()
			.join("\n");
	if (fingerprint(removed) === fingerprint(added)) return true;
	return (
		extractImportBindings(removed).join("\n") ===
		extractImportBindings(added).join("\n")
	);
}

/**
 * Why split the hunk into import-related vs other lines? The old pipeline
 * checked (1) whitespace-only on the WHOLE hunk, then (2)
 * import-specifier-only requiring EVERY changed line to be import-related.
 * A relocation hunk mixing import retargets with a biome body-rewrap can
 * never pass either stage: (1) fails on the intended specifier differences,
 * (2) fails on the non-import rewrap lines — even though each subset is
 * individually trivial. So split first: other lines must be
 * whitespace-equivalent (Cycle-K fingerprint on the non-import subset, so
 * any token difference still fires), import lines must satisfy the existing
 * specifier-only logic on the import subset (specifier swap, reorder,
 * intra-line binding reorder, same-set consolidation OK; binding
 * add/remove, new imports, comments stay a touch). Whole hunk trivial iff
 * BOTH subsets trivial; an empty subset counts as trivial so pure-import
 * and pure-rewrap hunks keep working.
 * Residual risk: string-literal whitespace invisibility — same accepted
 * Cycle-K risk (tests + human review cover string-content changes).
 * @param {string} hunks
 */
export function isNonTrivialTouch(hunks) {
	const { removed, added } = parseChangedLines(hunks);
	if (removed.length === 0 && added.length === 0) return false;
	const removedImports = removed.filter(isImportRelatedLine);
	const addedImports = added.filter(isImportRelatedLine);
	const removedOthers = removed.filter((line) => !isImportRelatedLine(line));
	const addedOthers = added.filter((line) => !isImportRelatedLine(line));
	if (!isWhitespaceEquivalentLines(removedOthers, addedOthers)) return true;
	if (!isImportSpecifierOnlyLines(removedImports, addedImports)) return true;
	return false;
}
