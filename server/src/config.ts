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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	console.error("❌ Invalid environment variables:");
	console.error(z.treeifyError(parsed.error).errors.join("\n"));
	process.exit(1);
}

export const config = Object.freeze(parsed.data);

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
