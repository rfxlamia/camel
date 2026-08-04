/**
 * Tracker key prefix derivation — keep in sync with client workspaceInitials.
 * @see client/src/lib/workspaceSwitcher.ts
 */
export function derivePrefix(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
	return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

const KEY_PATTERN = /^([A-Z?]{1,2})-(\d+)$/;

export function formatKey(prefix: string, keyNumber: number): string {
	return `${prefix}-${keyNumber}`;
}

export function parseKeyFromUrl(
	key: string,
): { prefix: string; keyNumber: number } | null {
	const match = KEY_PATTERN.exec(key);
	if (!match) return null;
	return { prefix: match[1], keyNumber: Number(match[2]) };
}
