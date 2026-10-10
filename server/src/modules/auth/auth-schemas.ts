import { z } from "zod";
import { USERNAME_RE } from "../../auth.js";
import {
	validateDisplayName,
	validateUsername,
} from "../../validators/input-length.js";

const PASSWORD_MESSAGE = "Password must be at least 8 characters.";
const LOGIN_MESSAGE = "Username and password are required.";

/** Shared register + oauth username 400. ASCII hyphen-minus (U+002D). */
export const USERNAME_MESSAGE =
	"Username must be 3-32 characters: letters, numbers, underscore.";

/**
 * Username field. Wraps `validateUsername` and `USERNAME_RE` — does not
 * reimplement their length or pattern rules. Returns the validator's trim.
 */
export function usernameSchema(message: string) {
	return z
		.custom<string>(
			(value) => {
				const validation = validateUsername(validatorInput(value));
				return validation.valid && USERNAME_RE.test(validation.trimmed ?? "");
			},
			{ error: message },
		)
		.transform((value) => {
			const validation = validateUsername(validatorInput(value));
			return validation.trimmed!;
		});
}

/** Register and oauth set-password: string of at least 8 characters, untrimmed. */
export const passwordSchema = z.custom<string>(
	(value) => typeof value === "string" && value.length >= 8,
	{ error: PASSWORD_MESSAGE },
);

/**
 * Register display name. Wraps `validateDisplayName` and surfaces that
 * validator's own error string. Empty input stays valid with `undefined`.
 */
export const displayNameSchema = z
	.unknown()
	.superRefine((value, ctx) => {
		const validation = validateDisplayName(validatorInput(value));
		if (!validation.valid) {
			ctx.addIssue({
				code: "custom",
				message: validation.error ?? "Invalid request",
			});
		}
	})
	.transform((value) => validateDisplayName(validatorInput(value)).trimmed);

/** Login credentials. Both fields must be strings; neither is trimmed. */
export const loginCredentialsSchema = z.custom<{
	username: string;
	password: string;
}>(
	(value) => {
		if (!isRecord(value)) return false;
		return (
			typeof value.username === "string" && typeof value.password === "string"
		);
	},
	{ error: LOGIN_MESSAGE },
);

/** Match `field ?? ""` before the string validators. Non-strings stay non-strings. */
function validatorInput(value: unknown): string {
	return (value ?? "") as string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
