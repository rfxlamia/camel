export type BoardViewMode = "board" | "list" | "calendar";

export const BOARD_VIEW_STORAGE_KEY = "boardViewModeByWorkspace";

function readMap(): Record<string, BoardViewMode> {
	try {
		const raw = localStorage.getItem(BOARD_VIEW_STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		return parsed as Record<string, BoardViewMode>;
	} catch {
		return {};
	}
}

export function readBoardViewMode(workspaceId: number): BoardViewMode {
	try {
		const map = readMap();
		return map[String(workspaceId)] ?? "board";
	} catch {
		return "board";
	}
}

export function writeBoardViewMode(
	workspaceId: number,
	mode: BoardViewMode,
): void {
	try {
		const map = readMap();
		map[String(workspaceId)] = mode;
		localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify(map));
	} catch {
		// localStorage unavailable — silently ignore
	}
}
