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

	PORT: z.coerce.number().int().positive().default(3001),

	TAVILY_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	console.error("❌ Invalid environment variables:");
	console.error(z.treeifyError(parsed.error).errors.join("\n"));
	process.exit(1);
}

export const config = Object.freeze(parsed.data);
