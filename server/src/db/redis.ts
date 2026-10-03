import { createClient, type RedisClientType } from "redis";
import { logger } from "../lib/logger.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let client: RedisClientType | null = null;
let connected = false;

/**
 * Get the shared Redis client. Returns null if Redis is not connected.
 * Safe to call before connectRedis() — will return null gracefully.
 */
export function getRedisClient(): RedisClientType | null {
	return connected ? client : null;
}

/**
 * Connect the shared Redis client. Idempotent — no-op if already connected.
 * Logs a warning and returns gracefully if Redis is unreachable.
 */
export async function connectRedis(): Promise<void> {
	if (connected && client) return;

	client = createClient({
		url: REDIS_URL,
		socket: { connectTimeout: 3000 },
	});
	client.on("error", (err) => {
		if (connected) {
			logger.error({ err }, "Redis unavailable — rate limiting degraded");
			connected = false;
		}
	});
	client.on("ready", () => {
		if (!connected) {
			connected = true;
			logger.info("Redis reconnected — rate limiting restored");
		}
	});

	try {
		await client.connect();
		connected = true;
		logger.info("Redis connected — shared client active");
	} catch {
		connected = false;
		client = null;
		logger.warn("Redis not reachable — rate limiting will be skipped");
	}
}
