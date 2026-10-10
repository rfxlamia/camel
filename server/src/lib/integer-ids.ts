/**
 * Lenient lock-reference extraction only — NOT validation.
 * Non-arrays yield []; invalid elements are dropped without coercion.
 * Retained order, duplicates, and unsafe integers are deliberately preserved.
 * Validate the raw request separately with parseLabelIds / parseAssigneeIds.
 */
export function extractIntegerIds(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value.filter((id): id is number => Number.isInteger(id));
}
