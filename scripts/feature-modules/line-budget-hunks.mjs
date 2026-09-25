/**
 * @typedef {{ text: string, changed: boolean }} DiffLine
 * @typedef {{ removed: DiffLine[], added: DiffLine[] }} DiffHunk
 * @typedef {{ statement: "import" | "export", declarationType: "type" | "value" }} ImportKind
 * @typedef {{ text: string, kind: ImportKind | null }} ImportChangeLine
 */

/**
 * Keep each unified-diff hunk separate so continuation lines cannot borrow
 * import context from an unrelated changed region.
 * @param {string} hunks
 * @returns {DiffHunk[]}
 */
function parseHunks(hunks) {
	/** @type {DiffHunk[]} */
	const sections = [];
	let section;
	for (const line of hunks.split("\n")) {
		if (line.startsWith("@@")) {
			section = { removed: [], added: [] };
			sections.push(section);
			continue;
		}
		if (!section) continue;
		if (line.startsWith("-")) {
			section.removed.push({ text: line.slice(1), changed: true });
		} else if (line.startsWith("+")) {
			section.added.push({ text: line.slice(1), changed: true });
		} else if (line.startsWith(" ")) {
			const text = line.slice(1);
			section.removed.push({ text, changed: false });
			section.added.push({ text, changed: false });
		}
	}
	return sections;
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
 * exact single tokens (escapes respected), so whitespace in a literal is
 * treated as content rather than reflow.
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
			tokens.push(token);
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
	// Literal contents are preserved exactly; only whitespace outside literals
	// remains eligible for reflow equivalence.
	const exactLineFingerprint = (lines) =>
		lines.map((line) => line.trim()).join("\n");
	const hasSlashSensitiveLine = [...removed, ...added].some((line) =>
		line.includes("/"),
	);
	// A slash can be a regex delimiter or a line comment. Treat changed slash
	// lines conservatively: preserving each trimmed line avoids both regex
	// whitespace loss and code moving across a `//` boundary without adding a
	// parser dependency to this guard.
	if (
		hasSlashSensitiveLine &&
		exactLineFingerprint(removed) !== exactLineFingerprint(added)
	) {
		return false;
	}
	const hasRestrictedLineTerminator = [...removed, ...added].some((line) =>
		/\b(?:return|throw|break|continue|yield)\s*$/.test(line.trim()),
	);
	if (
		hasRestrictedLineTerminator &&
		exactLineFingerprint(removed) !== exactLineFingerprint(added)
	) {
		return false;
	}
	const fingerprint = (lines) => {
		const tokens = tokenizeForEquivalence(lines.join("\n"));
		const filtered = tokens.filter((token, index) => {
			if (token !== "," || !isClosingBracket(tokens[index + 1])) return true;
			if (tokens[index + 1] !== "]") return false;
			const previous = tokens[index - 1];
			return previous === "[" || previous === ",";
		});
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
 * @param {string} line
 * @returns {ImportKind}
 */
function getImportKind(line) {
	const trimmed = line.trim();
	return {
		statement: trimmed.startsWith("export") ? "export" : "import",
		declarationType: /^(?:import|export)\s+type(?:\s|\{|\*)/.test(trimmed)
			? "type"
			: "value",
	};
}

/**
 * @param {string} line
 */
function isImportDeclarationEndLine(line) {
	return /^}?\s*from\s+['"]/.test(line.trim());
}

/**
 * @param {string} line
 */
function isCompleteImportDeclaration(line) {
	const trimmed = line.trim();
	return (
		isImportDeclarationEndLine(trimmed) ||
		/^import\s+['"]/.test(trimmed) ||
		(/^import\s*\(/.test(trimmed) && /\)\s*;?$/.test(trimmed)) ||
		/\bfrom\s+['"][^'"]+['"]/.test(trimmed)
	);
}

/**
 * @param {string} line
 */
function isImportContinuationCandidate(line) {
	const trimmed = line.trim();
	return (
		trimmed === "" ||
		trimmed === "{" ||
		trimmed === "}" ||
		trimmed === "}," ||
		/^(type\s+)?[\w$]+,?\s*$/.test(trimmed)
	);
}

/**
 * @param {string} binding
 */
function normalizeImportBindingName(binding) {
	const normalized = binding
		.trim()
		.replace(/,\s*$/, "")
		.replace(/\s+/g, " ")
		.replace(/^type\s+/, "");
	const alias = normalized.match(/\bas\s+([\w$]+)$/);
	return alias ? alias[1] : normalized.split(/\s+/)[0];
}

/**
 * Classify one diff side using active declaration state. Continuation lines
 * outside an active declaration remain semantic lines, even if their names
 * happen to match an import elsewhere in the diff.
 * @param {DiffLine[]} entries
 */
function classifyImportLines(entries) {
	const importIndexes = new Set();
	const importKinds = new Map();
	/** @type {ImportKind | null} */
	let activeKind = null;
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		const trimmed = entry.text.trim();
		if (isImportOrExportFromLine(trimmed)) {
			const kind = getImportKind(trimmed);
			activeKind = isCompleteImportDeclaration(trimmed) ? null : kind;
			if (entry.changed) {
				importIndexes.add(index);
				importKinds.set(index, kind);
			}
			continue;
		}
		if (activeKind) {
			if (entry.changed) {
				importIndexes.add(index);
				importKinds.set(index, activeKind);
			}
			if (isImportDeclarationEndLine(trimmed)) activeKind = null;
			continue;
		}
		if (isImportDeclarationEndLine(trimmed) && entry.changed) {
			importIndexes.add(index);
			importKinds.set(index, null);
		}
	}

	return {
		imports: entries.flatMap((entry, index) =>
			entry.changed && importIndexes.has(index)
				? [{ text: entry.text, kind: importKinds.get(index) ?? null }]
				: [],
		),
		others: entries
			.filter((entry, index) => entry.changed && !importIndexes.has(index))
			.map((entry) => entry.text),
	};
}

/**
 * @param {string} hunks
 */
function classifyImportChanges(hunks) {
	const sections = parseHunks(hunks);
	const result = {
		removedImports: [],
		addedImports: [],
		removedOthers: [],
		addedOthers: [],
	};
	for (const section of sections) {
		const removed = classifyImportLines(section.removed);
		const added = classifyImportLines(section.added);
		result.removedImports.push(...removed.imports);
		result.addedImports.push(...added.imports);
		result.removedOthers.push(...removed.others);
		result.addedOthers.push(...added.others);
	}
	return result;
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
 * @param {string | ImportChangeLine} line
 */
function getImportLineText(line) {
	return typeof line === "string" ? line : line.text;
}

/**
 * Sorted semantic signatures of changed import/export declarations. Module
 * paths are omitted, but statement kind, type/value kind, and local bindings
 * remain significant so only binding organization can be ignored.
 * @param {(string | ImportChangeLine)[]} lines
 */
function extractImportSignatures(lines) {
	/** @type {string[]} */
	const signatures = [];
	/** @type {ImportKind | null} */
	let activeKind = null;
	for (const line of lines) {
		const text = getImportLineText(line);
		const trimmed = text.trim();
		if (isImportOrExportFromLine(trimmed)) {
			const kind = getImportKind(trimmed);
			const { statement, declarationType } = kind;
			const kindPrefix = `${statement}:${declarationType}`;
			if (/^import\s+['"]/.test(trimmed)) {
				signatures.push(`${kindPrefix}:side-effect`);
			} else if (/^export\s+(?:type\s+)?\*\s+from\s/.test(trimmed)) {
				signatures.push(`${kindPrefix}:star`);
			} else {
				const braceMatch = trimmed.match(/\{([^}]*)\}/);
				if (braceMatch) {
					for (const part of braceMatch[1].split(",")) {
						const normalized = part.trim().replace(/\s+/g, " ");
						if (!normalized) continue;
						const bindingType = normalized.startsWith("type ")
							? "type"
							: declarationType;
						const binding = normalized.replace(/^type\s+/, "");
						signatures.push(`${statement}:${bindingType}:named:${binding}`);
					}
				}
				const defaultMatch = trimmed.match(
					/^(?:import|export)\s+(?:type\s+)?([\w$]+)\s*(?:,|from)/,
				);
				if (defaultMatch) {
					signatures.push(
						`${statement}:${declarationType}:default:${defaultMatch[1]}`,
					);
				}
				const namespaceMatch = trimmed.match(
					/^import\s+\*\s+as\s+([\w$]+)\s+from\s/,
				);
				if (namespaceMatch) {
					signatures.push(
						`import:${declarationType}:namespace:${namespaceMatch[1]}`,
					);
				}
			}
			activeKind = isCompleteImportDeclaration(trimmed) ? null : kind;
			continue;
		}
		if (activeKind && isImportContinuationCandidate(trimmed)) {
			const binding = normalizeImportBindingName(trimmed);
			const bindingType = trimmed.startsWith("type ")
				? "type"
				: activeKind.declarationType;
			if (binding) {
				signatures.push(
					`${activeKind.statement}:${bindingType}:named:${binding}`,
				);
			}
			continue;
		}
		if (isImportDeclarationEndLine(trimmed)) {
			activeKind = null;
			continue;
		}
		if (isImportContinuationCandidate(trimmed)) {
			const binding = normalizeImportBindingName(trimmed);
			const providedKind = typeof line === "string" ? null : line.kind;
			const kind = providedKind ?? {
				statement: "import",
				declarationType: "value",
			};
			const bindingType = trimmed.startsWith("type ")
				? "type"
				: kind.declarationType;
			if (binding) {
				signatures.push(`${kind.statement}:${bindingType}:named:${binding}`);
			}
		}
	}
	return signatures.sort();
}

/**
 * Import-specifier-only comparison over an explicit line subset.
 * Exempt only when the quoted module path changed (including multiline `from`).
 * Binding / new-import changes are a touch.
 * An empty subset counts as trivial (pure-rewrap mixed hunks need this).
 * @param {(string | ImportChangeLine)[]} removed
 * @param {(string | ImportChangeLine)[]} added
 */
function isImportSpecifierOnlyLines(removed, added) {
	const changed = [...removed, ...added];
	if (changed.length === 0) return true;
	// Sort stripped lines so a pure reorder stays trivial: biome
	// organizeImports force-reorders imports on amend. Binding order within
	// one line is normalized too (see normalizeBindingOrder).
	// Additionally compare semantic signatures so barrel consolidation during
	// relocation (N leaf imports merged into one barrel import with the same
	// bindings) stays trivial even though the line structure differs. A
	// statement, type/value, or binding change stays a touch.
	const fingerprint = (lines) =>
		lines
			.map((line) => {
				const text = getImportLineText(line);
				return collapseWhitespace(
					normalizeBindingOrder(stripQuotedModuleSpecifiers(text)),
				);
			})
			.sort()
			.join("\n");
	if (fingerprint(removed) === fingerprint(added)) return true;
	return (
		extractImportSignatures(removed).join("\n") ===
		extractImportSignatures(added).join("\n")
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
 * Literal and comment contents are intentionally handled conservatively.
 * @param {string} hunks
 */
export function isNonTrivialTouch(hunks) {
	const { removedImports, addedImports, removedOthers, addedOthers } =
		classifyImportChanges(hunks);
	if (
		removedImports.length === 0 &&
		addedImports.length === 0 &&
		removedOthers.length === 0 &&
		addedOthers.length === 0
	) {
		return false;
	}
	if (!isWhitespaceEquivalentLines(removedOthers, addedOthers)) return true;
	if (!isImportSpecifierOnlyLines(removedImports, addedImports)) return true;
	return false;
}
