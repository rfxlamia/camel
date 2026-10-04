export const PRESENCE_TTL_SECONDS = 60;
export const WORKSPACE_EVENTS_PATTERN = "camel:workspace:*:events";

export function workspaceEventChannel(workspaceId: number): string {
	return `camel:workspace:${workspaceId}:events`;
}

export function workspacePresenceKey(
	workspaceId: number,
	userId: number,
): string {
	return `camel:workspace:${workspaceId}:presence:${userId}`;
}

export function workspacePresencePattern(workspaceId: number): string {
	return `camel:workspace:${workspaceId}:presence:*`;
}

export function parseWorkspaceFromEventChannel(channel: string): number | null {
	const match = channel.match(/^camel:workspace:(\d+):events$/);
	return match ? Number(match[1]) : null;
}
