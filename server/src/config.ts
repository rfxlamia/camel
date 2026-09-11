/**
 * Centralized environment-variable validation.
 *
 * Import this module ONCE at the top of your entrypoint (index.ts).
 * Every other module imports the typed `config` object instead of
 * reading `process.env` directly.
 *
 * Missing required vars crash at startup with a clear message —
 * no more silent fallbacks deep in a request handler.
 */

import "dotenv/config";
import { existsSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
	DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

	ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),

	ANTHROPIC_BASE_URL: z.string().optional(),
	ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),

	REDIS_URL: z.string().default("redis://localhost:6379"),

	// Deployment environment. Left as a permissive string (not an enum) so
	// custom values like "staging" don't crash startup.
	NODE_ENV: z.string().optional(),

	// Comma-separated list of allowed CORS origins. Required in production
	// (enforced below) — otherwise the API silently denies all cross-origin
	// requests. Consumed by core/cors.ts.
	CORS_ORIGIN: z.string().optional(),

	PORT: z.coerce.number().int().positive().default(3001),

	TAVILY_API_KEY: z.string().optional(),

	LINEAR_API_KEY: z.string().optional(),
	LINEAR_TEAM_ID: z.string().optional(),

	// OAuth / Better Auth
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	GITHUB_CLIENT_ID: z.string().optional(),
	GITHUB_CLIENT_SECRET: z.string().optional(),
	BETTER_AUTH_SECRET: z.string().default("dev-secret-change-in-production"),
	APP_BASE_URL: z.string().default("http://localhost:3001"),
	CLIENT_URL: z.string().default("http://localhost:5173"),
	OAUTH_ENABLED: z.enum(["true", "false"]).default("false"),
	EMAIL_GATE_ENABLED: z.enum(["true", "false"]).default("false"),
	FOCUS_MODE_ENABLED: z.enum(["true", "false"]).default("false"),

	// Private attachment bytes must not share the public uploads directory.
	ATTACHMENTS_DIR: z.string().min(1).optional(),
});

export const DEVELOPMENT_ATTACHMENTS_DIR = fileURLToPath(
	new URL("../private-uploads", import.meta.url),
);
export const CONTAINER_ATTACHMENTS_DIR = "/app/server/private-uploads";
const PUBLIC_CLIENT_ROOT = fileURLToPath(
	new URL("../../client/public", import.meta.url),
);

type Environment = z.input<typeof envSchema>;
type ParsedAppConfig = z.infer<typeof envSchema>;
export type AppConfig = Omit<ParsedAppConfig, "ATTACHMENTS_DIR"> & {
	ATTACHMENTS_DIR: string;
};

function canonicalizePath(input: string): string {
	const absolute = path.resolve(input);
	const missingParts: string[] = [];
	let existingPath = absolute;

	while (!existsSync(existingPath)) {
		const parent = path.dirname(existingPath);
		if (parent === existingPath) return absolute;
		missingParts.unshift(path.basename(existingPath));
		existingPath = parent;
	}

	return path.join(realpathSync(existingPath), ...missingParts);
}

function isPathWithinOrEqual(candidate: string, parent: string): boolean {
	const relative = path.relative(parent, candidate);
	return (
		relative === "" ||
		(!path.isAbsolute(relative) &&
			relative !== ".." &&
			!relative.startsWith(`..${path.sep}`))
	);
}

export function resolveAttachmentDirectory(
	env: Pick<Environment, "ATTACHMENTS_DIR" | "NODE_ENV">,
): string {
	const configured = env.ATTACHMENTS_DIR
		? path.resolve(env.ATTACHMENTS_DIR)
		: env.NODE_ENV === "production" || env.NODE_ENV === "container-production"
			? CONTAINER_ATTACHMENTS_DIR
			: DEVELOPMENT_ATTACHMENTS_DIR;
	const canonicalConfigured = canonicalizePath(configured);
	const canonicalPublicRoot = canonicalizePath(PUBLIC_CLIENT_ROOT);
	if (isPathWithinOrEqual(canonicalConfigured, canonicalPublicRoot)) {
		throw new Error("ATTACHMENTS_DIR must be outside client/public");
	}
	return configured;
}

export function resolveConfig(env?: Environment): AppConfig {
	const result = envSchema.parse(env ?? process.env);
	return Object.freeze({
		...result,
		ATTACHMENTS_DIR: resolveAttachmentDirectory(result),
	});
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	console.error("❌ Invalid environment variables:");
	console.error(z.treeifyError(parsed.error).errors.join("\n"));
	process.exit(1);
}

export const config = Object.freeze({
	...parsed.data,
	ATTACHMENTS_DIR: resolveAttachmentDirectory(parsed.data),
});

if (
	process.env.NODE_ENV === "production" &&
	(!process.env.BETTER_AUTH_SECRET ||
		config.BETTER_AUTH_SECRET === "dev-secret-change-in-production")
) {
	console.error("❌ BETTER_AUTH_SECRET must be set in production");
	process.exit(1);
}

if (
	process.env.NODE_ENV === "production" &&
	(!config.CORS_ORIGIN || config.CORS_ORIGIN.trim() === "")
) {
	console.error(
		"❌ CORS_ORIGIN must be set in production (comma-separated list of allowed origins)",
	);
	process.exit(1);
}

// OAuth state cookies are host-scoped; APP_BASE_URL and CLIENT_URL must share
// the same origin or the state cookie won't be sent on the callback redirect.
// Only enforce in production — local dev uses different ports (localhost:3001 vs :5173).
if (process.env.NODE_ENV === "production") {
	try {
		const appOrigin = new URL(config.APP_BASE_URL).origin;
		const clientOrigin = new URL(config.CLIENT_URL).origin;
		if (appOrigin !== clientOrigin) {
			console.error(
				`❌ APP_BASE_URL (${config.APP_BASE_URL}) and CLIENT_URL (${config.CLIENT_URL}) must share the same origin — OAuth state cookie will be lost otherwise`,
			);
			process.exit(1);
		}
	} catch {
		console.error(
			`❌ APP_BASE_URL (${config.APP_BASE_URL}) or CLIENT_URL (${config.CLIENT_URL}) is not a valid URL`,
		);
		process.exit(1);
	}
}
