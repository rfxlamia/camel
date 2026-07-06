import { validateColumnName } from "./input-length.js";

export const COLUMN_COLORS = [
	"powder-blue",
	"pale-sky",
	"light-cyan",
	"frozen-water",
	"turquoise",
] as const;

export type ColumnColor = (typeof COLUMN_COLORS)[number];

export const COLUMN_COLOR_VALIDATION_ERROR = `color must be a legacy name (${COLUMN_COLORS.join(", ")}), a well-formed oklch(...), or null`;

const OKLCH_RE =
	/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)$/i;

export function parseOklchColor(
	value: string,
): { l: number; c: number; h: number } | null {
	const match = value.trim().match(OKLCH_RE);
	if (!match) return null;

	const [, lRaw, cRaw, hRaw] = match;
	const l = lRaw.endsWith("%")
		? Number(lRaw.slice(0, -1)) / 100
		: Number(lRaw);
	const c = Number(cRaw);
	const h = Number(hRaw);

	if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h)) {
		return null;
	}

	return { l, c, h };
}

function isOklchInSanityRange(value: string): boolean {
	const parsed = parseOklchColor(value);
	if (!parsed) return false;
	const { l, c, h } = parsed;
	return l >= 0 && l <= 1 && c >= 0 && c <= 0.4 && h >= 0 && h <= 360;
}

export function isValidColumnColor(value: unknown): value is string | null {
	if (value === null) return true;
	if (typeof value !== "string") return false;
	if (COLUMN_COLORS.includes(value as ColumnColor)) return true;
	return isOklchInSanityRange(value);
}

export interface NormalizedColumn {
	title: string;
	color: string | null;
	wipLimit: number | null;
	policy: string;
	isDone: boolean;
}

export interface ColumnBatchValidationResult {
	valid: boolean;
	error?: string;
	normalized?: NormalizedColumn[];
}

export function validateColumnBatch(
	columns: unknown,
): ColumnBatchValidationResult {
	if (!Array.isArray(columns) || columns.length === 0) {
		return { valid: false, error: "columns must be a non-empty array" };
	}

	const normalized: NormalizedColumn[] = [];
	let doneCount = 0;

	for (let i = 0; i < columns.length; i++) {
		const col = columns[i];
		if (col === null || typeof col !== "object") {
			return { valid: false, error: `columns[${i}] must be an object` };
		}

		const { title, color, wipLimit, policy, isDone } = col as Record<
			string,
			unknown
		>;

		const titleValidation = validateColumnName(
			typeof title === "string" ? title : "",
		);
		if (!titleValidation.valid) {
			return { valid: false, error: titleValidation.error };
		}

		if (!isValidColumnColor(color)) {
			return {
				valid: false,
				error: COLUMN_COLOR_VALIDATION_ERROR,
			};
		}

		if (wipLimit !== undefined && wipLimit !== null) {
			if (!Number.isInteger(wipLimit) || (wipLimit as number) < 1) {
				return {
					valid: false,
					error: "wipLimit must be a positive integer or null",
				};
			}
		}

		if (isDone !== undefined && typeof isDone !== "boolean") {
			return { valid: false, error: "isDone must be a boolean" };
		}

		const done = isDone === true;
		if (done) doneCount++;

		normalized.push({
			title: titleValidation.trimmed!,
			color: color as string | null,
			wipLimit: typeof wipLimit === "number" ? wipLimit : null,
			policy: typeof policy === "string" ? policy : "",
			isDone: done,
		});
	}

	if (doneCount > 1) {
		return {
			valid: false,
			error: "only one column may have isDone set to true",
		};
	}

	return { valid: true, normalized };
}
