import type { Response } from "express";
import type { z } from "zod";

/** The one 400 body shape every route returns for invalid input. */
export type ValidationErrorBody = {
	error: string;
	fieldErrors?: Record<string, string>;
};

export type ParseOptions = {
	/** Overrides the top-level `error`; defaults to the first issue's message. */
	message?: string;
	/** Include `fieldErrors` keyed by the first path segment of each issue. */
	fieldErrors?: boolean;
};

export type ParseResult<T> =
	| { ok: true; data: T }
	| { ok: false; body: ValidationErrorBody };

export function parseWith<S extends z.ZodType>(
	schema: S,
	input: unknown,
	options: ParseOptions = {},
): ParseResult<z.output<S>> {
	const result = schema.safeParse(input);
	if (result.success) return { ok: true, data: result.data };

	const issues = result.error.issues;
	const body: ValidationErrorBody = {
		error: options.message ?? issues[0]?.message ?? "Invalid request",
	};
	if (options.fieldErrors) {
		const fieldErrors: Record<string, string> = {};
		for (const issue of issues) {
			const key = issue.path[0];
			if (typeof key !== "string" || key in fieldErrors) continue;
			fieldErrors[key] = issue.message;
		}
		if (Object.keys(fieldErrors).length > 0) body.fieldErrors = fieldErrors;
	}
	return { ok: false, body };
}

export function sendValidationError(
	res: Response,
	body: ValidationErrorBody,
): Response {
	return res.status(400).json(body);
}

/**
 * Parse `input` with `schema`; on failure reply 400 and return `undefined`.
 * Callers must `return` when the result is `undefined`.
 */
export function validateOrReply<S extends z.ZodType>(
	res: Response,
	schema: S,
	input: unknown,
	options?: ParseOptions,
): z.output<S> | undefined {
	const parsed = parseWith(schema, input, options);
	if (parsed.ok) return parsed.data;
	sendValidationError(res, parsed.body);
	return undefined;
}
