import { createClient } from "redis";
import type { Request, Response } from "express";
import type { AuthUser } from "./auth.js";

// Redis carries the real-time layer (presence + pub/sub). If it is down the
// app must keep working: presence degrades to "just me" and events fall back
// to direct in-process fan-out (fine for a single server instance).

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const EVENTS_CHANNEL = "camel:events";
const PRESENCE_PREFIX = "camel:presence:";
const PRESENCE_TTL_SECONDS = 60;

export interface BoardEvent {
  type: "card.created" | "card.updated" | "card.moved" | "card.deleted" | "column.updated" | "presence.changed" | "settings.updated";
  actor: AuthUser;
  cardId?: number;
  at: string;
}

let redisAvailable = false;

const publisher = createClient({ url: REDIS_URL });
const subscriber = publisher.duplicate();

publisher.on("error", () => {
  if (redisAvailable) console.error("Redis unavailable — real-time degraded to local fan-out");
  redisAvailable = false;
});
subscriber.on("error", () => {});

export async function connectRedis(): Promise<void> {
  try {
    await publisher.connect();
    await subscriber.connect();
    await subscriber.subscribe(EVENTS_CHANNEL, (message) => fanOut(message));
    redisAvailable = true;
    console.log("Redis connected — real-time layer active");
  } catch {
    redisAvailable = false;
    console.warn("Redis not reachable — presence/real-time degraded (board still works)");
  }
}

// ---- SSE fan-out -----------------------------------------------------------

const sseClients = new Set<Response>();

function fanOut(message: string): void {
  for (const res of sseClients) {
    res.write(`data: ${message}\n\n`);
  }
}

export async function publishEvent(event: Omit<BoardEvent, "at">): Promise<void> {
  const message = JSON.stringify({ ...event, at: new Date().toISOString() });
  if (redisAvailable) {
    try {
      await publisher.publish(EVENTS_CHANNEL, message);
      return;
    } catch {
      // fall through to local fan-out
    }
  }
  fanOut(message);
}

export function sseHandler(req: Request, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  sseClients.add(res);

  // Periodic comment keeps proxies from closing the idle stream.
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
}

// ---- Presence ----------------------------------------------------------------

export async function heartbeat(user: AuthUser): Promise<void> {
  if (!redisAvailable) return;
  try {
    await publisher.set(
      `${PRESENCE_PREFIX}${user.id}`,
      JSON.stringify({ ...user, lastSeen: new Date().toISOString() }),
      { EX: PRESENCE_TTL_SECONDS },
    );
  } catch {
    // presence is best-effort
  }
}

export async function clearPresence(userId: number): Promise<void> {
  if (!redisAvailable) return;
  try {
    await publisher.del(`${PRESENCE_PREFIX}${userId}`);
  } catch {
    // best-effort
  }
}

export async function onlineUsers(self: AuthUser): Promise<Array<AuthUser & { lastSeen: string }>> {
  const fallback = [{ ...self, lastSeen: new Date().toISOString() }];
  if (!redisAvailable) return fallback;
  try {
    const keys: string[] = [];
    for await (const key of publisher.scanIterator({ MATCH: `${PRESENCE_PREFIX}*`, COUNT: 100 })) {
      keys.push(...(Array.isArray(key) ? key : [key]));
    }
    if (keys.length === 0) return fallback;
    const values = await publisher.mGet(keys);
    const users = values
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as AuthUser & { lastSeen: string });
    if (!users.some((u) => u.id === self.id)) users.push(fallback[0]);
    return users.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch {
    return fallback;
  }
}
