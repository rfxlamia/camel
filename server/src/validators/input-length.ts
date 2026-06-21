export interface ValidationResult {
	valid: boolean;
	trimmed?: string;
	error?: string;
}

export const MAX_LENGTHS = {
	cardTitle: 255,
	cardDescription: 10000,
	boardName: 100,
	displayName: 50,
	username: 32,
	usernameMin: 3,
	workspaceName: 100,
	columnName: 50,
} as const;

export function validateCardTitle(title: string): ValidationResult {
	if (typeof title !== "string") {
		return { valid: false, error: "title must be a string" };
	}

	const trimmed = title.trim();
	if (trimmed === "") {
		return { valid: false, error: "title is required" };
	}

	if (trimmed.length > MAX_LENGTHS.cardTitle) {
		return {
			valid: false,
			error: `title must be ${MAX_LENGTHS.cardTitle} characters or less`,
		};
	}

	return { valid: true, trimmed };
}

export function validateCardDescription(description: string): ValidationResult {
	if (typeof description !== "string") {
		return { valid: false, error: "description must be a string" };
	}

	if (description === "") {
		return { valid: true, trimmed: "" };
	}

	const trimmed = description.trim();
	if (trimmed.length > MAX_LENGTHS.cardDescription) {
		return {
			valid: false,
			error: `description must be ${MAX_LENGTHS.cardDescription} characters or less`,
		};
	}

	return { valid: true, trimmed };
}

export function validateBoardName(name: string): ValidationResult {
	if (typeof name !== "string") {
		return { valid: false, error: "name must be a string" };
	}

	const trimmed = name.trim();
	if (trimmed === "") {
		return { valid: false, error: "Name is required" };
	}

	if (trimmed.length > MAX_LENGTHS.boardName) {
		return {
			valid: false,
			error: `name must be ${MAX_LENGTHS.boardName} characters or less`,
		};
	}

	return { valid: true, trimmed };
}

export function validateDisplayName(name: string): ValidationResult {
	if (typeof name !== "string") {
		return { valid: false, error: "name must be a string" };
	}

	const trimmed = name.trim();
	if (trimmed.length > MAX_LENGTHS.displayName) {
		return {
			valid: false,
			error: `name must be ${MAX_LENGTHS.displayName} characters or less`,
		};
	}

	return { valid: true, trimmed: trimmed || undefined };
}

/**
 * Validates a due date as a calendar date string "YYYY-MM-DD" (the format an
 * HTML <input type="date"> emits). Rejects malformed strings and impossible
 * dates (e.g. 2026-02-30). Returns the normalized "YYYY-MM-DD" on success.
 */
export function validateDueDate(dueDate: string): ValidationResult {
	if (typeof dueDate !== "string") {
		return { valid: false, error: "due date must be a string" };
	}
	const trimmed = dueDate.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return { valid: false, error: "due date must be in YYYY-MM-DD format" };
	}
	// Round-trip through UTC to reject impossible calendar dates without
	// timezone drift (e.g. Feb 30 normalizes to Mar 2, which won't match).
	const [y, m, d] = trimmed.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	if (
		dt.getUTCFullYear() !== y ||
		dt.getUTCMonth() !== m - 1 ||
		dt.getUTCDate() !== d
	) {
		return { valid: false, error: "due date is not a valid calendar date" };
	}
	return { valid: true, trimmed };
}

export function validateColumnName(name: string): ValidationResult {
	if (typeof name !== "string") {
		return { valid: false, error: "name must be a string" };
	}

	const trimmed = name.trim();
	if (trimmed === "") {
		return { valid: false, error: "Column name is required" };
	}

	if (trimmed.length > MAX_LENGTHS.columnName) {
		return {
			valid: false,
			error: `Column name must be ${MAX_LENGTHS.columnName} characters or less`,
		};
	}

	return { valid: true, trimmed };
}

export function validateUsername(username: string): ValidationResult {
	if (typeof username !== "string") {
		return { valid: false, error: "username must be a string" };
	}

	const trimmed = username.trim();
	if (trimmed.length < MAX_LENGTHS.usernameMin) {
		return {
			valid: false,
			error: `username must be at least ${MAX_LENGTHS.usernameMin} characters`,
		};
	}

	if (trimmed.length > MAX_LENGTHS.username) {
		return {
			valid: false,
			error: `username must be ${MAX_LENGTHS.username} characters or less`,
		};
	}

	return { valid: true, trimmed };
}
