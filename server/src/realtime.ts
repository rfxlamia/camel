import { createClient } from "redis";
import type { Request, Response } from "express";
import type { AuthUser } from "./auth.js";

// Redis carries the real-time layer (presence + pub/sub). If it is down the
// app must keep working: presence degrades to "just me" and events fall back
// to direct in-process fan-out (fine for a single server instance).

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const PRESENCE_TTL_SECONDS = 60;
const WORKSPACE_EVENTS_PATTERN = "camel:workspace:*:events";

export function workspaceEventChannel(workspaceId: number): string {
  return `camel:workspace:${workspaceId}:events`;
}

export function workspacePresenceKey(workspaceId: number, userId: number): string {
  return `camel:workspace:${workspaceId}:presence:${userId}`;
}

export function workspacePresencePattern(workspaceId: number): string {
  return `camel:workspace:${workspaceId}:presence:*`;
}

function parseWorkspaceFromEventChannel(channel: string): number | null {
  const match = channel.match(/^camel:workspace:(\d+):events$/);
  return match ? Number(match[1]) : null;
}

export interface BoardEvent {
  type:
    | "card.created"
    | "card.updated"
    | "card.moved"
    | "card.deleted"
    | "column.created"
    | "column.updated"
    | "presence.changed"
    | "settings.updated"
    | "membership.removed";
  actor?: AuthUser;
  cardId?: number;
  userId?: number;
  workspaceId?: number;
  workspaceName?: string;
  at?: string;
}

type PublishableEvent = Omit<BoardEvent, "at">;

interface PublisherLike {
  publish(channel: string, message: string): Promise<number>;
  set?(key: string, value: string, options?: { EX: number }): Promise<unknown>;
  del?(key: string): Promise<unknown>;
  mGet?(keys: string[]): Promise<(string | null)[]>;
}

interface SubscriberLike {
  pSubscribe(
    pattern: string,
    listener: (message: string, channel: string) => void,
  ): Promise<void>;
}

interface PresenceLike {
  scanIterator(options: { MATCH: string; COUNT?: number }): AsyncIterable<string | string[]>;
  set?(key: string, value: string, options?: { EX: number }): Promise<unknown>;
  del?(key: string): Promise<unknown>;
  mGet?(keys: string[]): Promise<(string | null)[]>;
}

export interface RealtimeHubDeps {
  publisher: PublisherLike | null;
  subscriber: SubscriberLike | null;
  presence?: PresenceLike | null;
}

interface SseClient {
  workspaceId: number;
  res: Response;
}

interface LocalTestClient {
  workspaceId: number;
  buffer: PublishableEvent[];
}

export function createRealtimeHub(deps: RealtimeHubDeps) {
  const redisAvailable = deps.publisher !== null;
  const presence = deps.presence ?? deps.publisher;
  const sseClients = new Set<SseClient>();
  const localTestClients = new Set<LocalTestClient>();

  function fanOut(workspaceId: number, message: string, event: PublishableEvent): void {
    for (const client of sseClients) {
      if (client.workspaceId === workspaceId) {
        client.res.write(`data: ${message}\n\n`);
      }
    }
    for (const client of localTestClients) {
      if (client.workspaceId === workspaceId) {
        client.buffer.push(event);
      }
    }
  }

  function onRedisMessage(message: string, channel: string): void {
    const workspaceId = parseWorkspaceFromEventChannel(channel);
    if (workspaceId === null) return;
    try {
      const parsed = JSON.parse(message) as PublishableEvent;
      fanOut(workspaceId, message, parsed);
    } catch {
      // ignore malformed payloads
    }
  }

  return {
    async connectSubscriber(): Promise<void> {
      if (!deps.subscriber) return;
      await deps.subscriber.pSubscribe(WORKSPACE_EVENTS_PATTERN, onRedisMessage);
    },

    connectLocalClient({ workspaceId }: { workspaceId: number; userId: number }) {
      const client: LocalTestClient = { workspaceId, buffer: [] };
      localTestClients.add(client);
      return {
        drain: () => {
          const events = [...client.buffer];
          client.buffer = [];
          return events;
        },
      };
    },

    async publishEvent(workspaceId: number, event: PublishableEvent): Promise<void> {
      const message = JSON.stringify({ ...event, at: new Date().toISOString() });
      if (redisAvailable && deps.publisher) {
        try {
          await deps.publisher.publish(workspaceEventChannel(workspaceId), message);
          return;
        } catch {
          // fall through to local fan-out
        }
      }
      fanOut(workspaceId, message, event);
    },

    sseHandler(req: Request, res: Response): void {
      const workspaceId = Number(req.params.workspaceId);
      if (!Number.isInteger(workspaceId)) {
        res.status(400).json({ error: "workspaceId must be an integer" });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");

      const client: SseClient = { workspaceId, res };
      sseClients.add(client);

      const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(keepAlive);
        sseClients.delete(client);
      });
    },

    async heartbeat(workspaceId: number, user: AuthUser): Promise<void> {
      if (!redisAvailable || !presence?.set) return;
      try {
        await presence.set(
          workspacePresenceKey(workspaceId, user.id),
          JSON.stringify({ ...user, lastSeen: new Date().toISOString() }),
          { EX: PRESENCE_TTL_SECONDS },
        );
      } catch {
        // presence is best-effort
      }
    },

    async clearPresence(workspaceId: number, userId: number): Promise<void> {
      if (!redisAvailable || !presence?.del) return;
      try {
        await presence.del(workspacePresenceKey(workspaceId, userId));
      } catch {
        // best-effort
      }
    },

    async onlineUsers(
      workspaceId: number,
      self?: AuthUser,
    ): Promise<Array<AuthUser & { lastSeen: string }>> {
      const fallback = self ? [{ ...self, lastSeen: new Date().toISOString() }] : [];
      if (!redisAvailable || !presence?.scanIterator) return fallback;
      try {
        const keys: string[] = [];
        for await (const key of presence.scanIterator({
          MATCH: workspacePresencePattern(workspaceId),
        })) {
          keys.push(...(Array.isArray(key) ? key : [key]));
        }
        if (keys.length === 0) return fallback;
        const values = presence.mGet ? await presence.mGet(keys) : [];
        const users = values
          .filter((v): v is string => v !== null)
          .map((v) => JSON.parse(v) as AuthUser & { lastSeen: string });
        if (self && !users.some((u) => u.id === self.id)) users.push(fallback[0]);
        return users.sort((a, b) => a.displayName.localeCompare(b.displayName));
      } catch {
        return fallback;
      }
    },
  };
}

// ---- Production singleton ----------------------------------------------------

let redisAvailable = false;

const publisher = createClient({ url: REDIS_URL });
const subscriber = publisher.duplicate();

publisher.on("error", () => {
  if (redisAvailable) console.error("Redis unavailable — real-time degraded to local fan-out");
  redisAvailable = false;
});
subscriber.on("error", () => {});

let activeHub = createRealtimeHub({
  publisher: null,
  subscriber: null,
  presence: null,
});

export async function connectRedis(): Promise<void> {
  try {
    await publisher.connect();
    await subscriber.connect();
    redisAvailable = true;
    activeHub = createRealtimeHub({
      publisher,
      subscriber,
      presence: publisher,
    });
    await activeHub.connectSubscriber();
    console.log("Redis connected — real-time layer active");
  } catch {
    redisAvailable = false;
    console.warn("Redis not reachable — presence/real-time degraded (board still works)");
  }
}

export async function publishEvent(workspaceId: number, event: PublishableEvent): Promise<void> {
  return activeHub.publishEvent(workspaceId, event);
}

export function sseHandler(req: Request, res: Response): void {
  return activeHub.sseHandler(req, res);
}

export async function heartbeat(workspaceId: number, user: AuthUser): Promise<void> {
  return activeHub.heartbeat(workspaceId, user);
}

export async function clearPresence(workspaceId: number, userId: number): Promise<void> {
  return activeHub.clearPresence(workspaceId, userId);
}

export async function onlineUsers(
  workspaceId: number,
  self?: AuthUser,
): Promise<Array<AuthUser & { lastSeen: string }>> {
  return activeHub.onlineUsers(workspaceId, self);
}
