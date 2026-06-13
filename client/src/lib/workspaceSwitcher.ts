import type { Workspace, WorkspaceInvite } from "../types";
import { WORKSPACE_STORAGE_KEY } from "./workspaceSelection";

export const WORKSPACE_MEMBERSHIP_CAP = 10;
export const CAP_MESSAGE = "You've reached the workspace limit (10).";
export const REMINDED_INVITES_KEY = "camel.remindedInviteIds";

export type WorkspaceLimitAction = "accept-invite" | "create-workspace";

export interface SwitchAttemptInput {
  activeWorkspaceId: number | null;
  targetWorkspaceId: number;
  hasUnsavedCardEdits: boolean;
}

export type SwitchAttemptState =
  | { status: "noop" }
  | { status: "confirm-required"; pendingWorkspaceId: number }
  | { status: "switch"; workspaceId: number };

export interface InvitePopoverInput {
  switcherOpen: boolean;
  remindedInviteIds: number[];
  pendingInvites: WorkspaceInvite[];
}

export interface InvitePopoverState {
  visible: boolean;
  invites: WorkspaceInvite[];
}

export interface WorkspaceLimitActionInput {
  membershipCount: number;
  action: WorkspaceLimitAction;
}

export interface WorkspaceLimitActionState {
  disabled: boolean;
  message: string | null;
}

export function getSwitchAttemptState({
  activeWorkspaceId,
  targetWorkspaceId,
  hasUnsavedCardEdits,
}: SwitchAttemptInput): SwitchAttemptState {
  if (activeWorkspaceId === targetWorkspaceId) return { status: "noop" };
  if (hasUnsavedCardEdits) {
    return { status: "confirm-required", pendingWorkspaceId: targetWorkspaceId };
  }
  return { status: "switch", workspaceId: targetWorkspaceId };
}

export function getInvitePopoverState({
  switcherOpen,
  remindedInviteIds,
  pendingInvites,
}: InvitePopoverInput): InvitePopoverState {
  if (switcherOpen || remindedInviteIds.length === 0) {
    return { visible: false, invites: [] };
  }
  const reminded = new Set(remindedInviteIds);
  const invites = pendingInvites.filter((invite) => reminded.has(invite.id));
  return {
    visible: invites.length > 0,
    invites,
  };
}

export function getWorkspaceLimitActionState({
  membershipCount,
  action: _action,
}: WorkspaceLimitActionInput): WorkspaceLimitActionState {
  if (membershipCount >= WORKSPACE_MEMBERSHIP_CAP) {
    return { disabled: true, message: CAP_MESSAGE };
  }
  return { disabled: false, message: null };
}

export function readRemindedInviteIds(): number[] {
  try {
    const raw = localStorage.getItem(REMINDED_INVITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => typeof id === "number" && Number.isInteger(id));
  } catch {
    return [];
  }
}

export function persistRemindedInviteIds(ids: number[]): void {
  localStorage.setItem(REMINDED_INVITES_KEY, JSON.stringify(ids));
}

export const WORKSPACE_CREATED_TOAST = "Workspace created.";

export interface CreatedWorkspaceSelectionInput {
  currentWorkspaceIds: number[];
  createdWorkspace: Pick<Workspace, "id" | "name" | "role" | "isPersonal">;
}

export interface CreatedWorkspaceSelectionResult {
  workspaces: Array<Pick<Workspace, "id"> | Pick<Workspace, "id" | "name" | "role" | "isPersonal">>;
  activeWorkspaceId: number;
  localStorageWrite: { key: string; value: string };
  toast: string;
}

export function applyCreatedWorkspaceSelection({
  currentWorkspaceIds,
  createdWorkspace,
}: CreatedWorkspaceSelectionInput): CreatedWorkspaceSelectionResult {
  return {
    workspaces: [
      ...currentWorkspaceIds.map((id) => ({ id })),
      {
        id: createdWorkspace.id,
        name: createdWorkspace.name,
        role: createdWorkspace.role,
        isPersonal: createdWorkspace.isPersonal,
      },
    ],
    activeWorkspaceId: createdWorkspace.id,
    localStorageWrite: {
      key: WORKSPACE_STORAGE_KEY,
      value: String(createdWorkspace.id),
    },
    toast: WORKSPACE_CREATED_TOAST,
  };
}

export function workspaceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}
