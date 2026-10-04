import type { AuthUser } from "../auth.js";
import {
	PRESENCE_TTL_SECONDS,
	workspacePresenceKey,
	workspacePresencePattern,
} from "./channels.js";
import type { PresenceLike } from "./types.js";

export type OnlineUser = AuthUser & { lastSeen: string };

interface PresenceManagerOptions {
	presence: PresenceLike | null;
	isRedisAvailable: () => boolean;
}

async function scanPresenceKeys(
	presence: PresenceLike,
	workspaceId: number,
): Promise<string[]> {
	const keys: string[] = [];
	for await (const key of presence.scanIterator({
		MATCH: workspacePresencePattern(workspaceId),
	})) {
		keys.push(...(Array.isArray(key) ? key : [key]));
	}
	return keys;
}

function parsePresenceValues(values: (string | null)[]): OnlineUser[] {
	return values
		.filter((v): v is string => v !== null)
		.map((v) => JSON.parse(v) as OnlineUser);
}

export function createPresenceManager({
	presence,
	isRedisAvailable,
}: PresenceManagerOptions) {
	async function heartbeat(workspaceId: number, user: AuthUser): Promise<void> {
		if (!isRedisAvailable() || !presence?.set) return;
		try {
			await presence.set(
				workspacePresenceKey(workspaceId, user.id),
				JSON.stringify({ ...user, lastSeen: new Date().toISOString() }),
				{ EX: PRESENCE_TTL_SECONDS },
			);
		} catch {
			// presence is best-effort
		}
	}

	async function clearPresence(
		workspaceId: number,
		userId: number,
	): Promise<void> {
		if (!isRedisAvailable() || !presence?.del) return;
		try {
			await presence.del(workspacePresenceKey(workspaceId, userId));
		} catch {
			// best-effort
		}
	}

	async function onlineUsers(
		workspaceId: number,
		self?: AuthUser,
	): Promise<OnlineUser[]> {
		const fallback: OnlineUser[] = self
			? [{ ...self, lastSeen: new Date().toISOString() }]
			: [];
		if (!isRedisAvailable() || !presence?.scanIterator) return fallback;
		try {
			const keys = await scanPresenceKeys(presence, workspaceId);
			if (keys.length === 0) return fallback;
			const values = presence.mGet ? await presence.mGet(keys) : [];
			const users = parsePresenceValues(values);
			if (self && !users.some((u) => u.id === self.id)) users.push(fallback[0]);
			return users.sort((a, b) => a.displayName.localeCompare(b.displayName));
		} catch {
			return fallback;
		}
	}

	return { heartbeat, clearPresence, onlineUsers };
}
