import { validateColumnName } from "./input-length.js";

export const COLUMN_COLORS = [
	"powder-blue",
	"pale-sky",
	"light-cyan",
	"frozen-water",
	"turquoise",
] as const;

export type ColumnColor = (typeof COLUMN_COLORS)[number];

export function isValidColumnColor(
	value: unknown,
): value is ColumnColor | null {
	return value === null || COLUMN_COLORS.includes(value as ColumnColor);
}

export interface NormalizedColumn {
	title: string;
	color: ColumnColor | null;
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
				error: `color must be one of: ${COLUMN_COLORS.join(", ")}, or null`,
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
			color: color as ColumnColor | null,
			wipLimit: wipLimit ?? null,
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
