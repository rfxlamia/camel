import { createClient, type RedisClientType } from "redis";

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

	client = createClient({ url: REDIS_URL });
	client.on("error", (err) => {
		if (connected) {
			console.error("Redis unavailable — rate limiting degraded:", err.message);
			connected = false;
		}
	});
	client.on("ready", () => {
		if (!connected) {
			connected = true;
			console.log("Redis reconnected — rate limiting restored");
		}
	});

	try {
		await client.connect();
		connected = true;
		console.log("Redis connected — shared client active");
	} catch {
		connected = false;
		client = null;
		console.warn("Redis not reachable — rate limiting will be skipped");
	}
}
