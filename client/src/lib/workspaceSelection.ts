import type { Workspace } from "../types";

export const WORKSPACE_STORAGE_KEY = "activeWorkspaceId";

export interface WorkspaceSelectionInput {
  workspaces: Workspace[];
  savedWorkspaceId: number | null;
}

export interface WorkspaceSelectionResult {
  activeWorkspaceId: number | null;
  pickerRequired: boolean;
  clearSavedWorkspace: boolean;
}

export interface RemovalRedirectInput {
  activeWorkspaceId: number;
  removedWorkspaceId: number;
  removedWorkspaceName: string;
  workspaces: Workspace[];
}

export interface RemovalRedirect {
  nextWorkspaceId: number;
  toast: string;
}

export function chooseInitialWorkspace({
  workspaces,
  savedWorkspaceId,
}: WorkspaceSelectionInput): WorkspaceSelectionResult {
  if (savedWorkspaceId !== null) {
    const saved = workspaces.find((w) => w.id === savedWorkspaceId);
    if (saved) {
      return {
        activeWorkspaceId: saved.id,
        pickerRequired: false,
        clearSavedWorkspace: false,
      };
    }
    return {
      activeWorkspaceId: null,
      pickerRequired: true,
      clearSavedWorkspace: true,
    };
  }

  if (workspaces.length === 1) {
    return {
      activeWorkspaceId: workspaces[0]!.id,
      pickerRequired: false,
      clearSavedWorkspace: false,
    };
  }

  return {
    activeWorkspaceId: null,
    pickerRequired: workspaces.length > 1,
    clearSavedWorkspace: false,
  };
}

export function getRemovalRedirect({
  activeWorkspaceId,
  removedWorkspaceId,
  removedWorkspaceName,
  workspaces,
}: RemovalRedirectInput): RemovalRedirect | null {
  if (activeWorkspaceId !== removedWorkspaceId) return null;

  const personal = workspaces.find((w) => w.isPersonal);
  if (!personal) return null;

  return {
    nextWorkspaceId: personal.id,
    toast: `You were removed from ${removedWorkspaceName}.`,
  };
}

/** Ordered steps BoardContext runs when the active workspace changes. */
export function planWorkspaceRefresh(workspaceId: number): string[] {
  return [
    "close-event-stream",
    `load-board:${workspaceId}`,
    `load-metrics:${workspaceId}`,
    `load-activity:${workspaceId}`,
    `load-presence:${workspaceId}`,
    `load-settings:${workspaceId}`,
    `open-event-stream:${workspaceId}`,
  ];
}

export function readSavedWorkspaceId(): number | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw || !/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function persistWorkspaceId(workspaceId: number): void {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, String(workspaceId));
}

export function clearSavedWorkspaceId(): void {
  localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}
