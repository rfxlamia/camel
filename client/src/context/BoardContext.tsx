import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { ApiError, api } from "../api";
import {
  CAP_MESSAGE,
  applyCreatedWorkspaceSelection,
  getSwitchAttemptState,
  persistRemindedInviteIds,
  readRemindedInviteIds,
} from "../lib/workspaceSwitcher";
import {
  chooseInitialWorkspace,
  clearSavedWorkspaceId,
  getRemovalRedirect,
  persistWorkspaceId,
  readSavedWorkspaceId,
} from "../lib/workspaceSelection";
import type {
  ActivityEvent,
  Column,
  FlowMetrics,
  PresenceUser,
  SettingsMap,
  SwitchConfirmState,
  User,
  Workspace,
  WorkspaceInvite,
} from "../types";

const HEARTBEAT_INTERVAL_MS = 25_000;
const PRESENCE_REFRESH_MS = 30_000;

/** Outcome of a save, so callers (e.g. the context panel) can react to a 409. */
export type SaveCardResult = "saved" | "conflict" | "error";

interface BoardContextValue {
  user: User;
  activeWorkspaceId: number | null;
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  pendingInvites: WorkspaceInvite[];
  pickerRequired: boolean;
  workspacesReady: boolean;
  membershipCount: number;
  remindedInviteIds: number[];
  hasUnsavedCardEdits: boolean;
  setHasUnsavedCardEdits: (dirty: boolean) => void;
  switchConfirm: SwitchConfirmState;
  attemptSwitchWorkspace: (workspaceId: number) => void;
  confirmPendingSwitch: () => void;
  cancelPendingSwitch: () => void;
  switchWorkspace: (workspaceId: number) => void;
  reloadWorkspaces: () => Promise<Workspace[]>;
  acceptWorkspaceInvite: (invite: WorkspaceInvite) => Promise<void>;
  declineWorkspaceInvite: (invite: WorkspaceInvite) => Promise<void>;
  remindInviteLater: (invite: WorkspaceInvite) => void;
  openCreateWorkspace: () => void;
  closeCreateWorkspace: () => void;
  createWorkspaceOpen: boolean;
  submitCreateWorkspace: (name: string) => Promise<void>;
  columns: Column[] | null;
  setColumns: Dispatch<SetStateAction<Column[] | null>>;
  metrics: FlowMetrics | null;
  activity: ActivityEvent[];
  presence: PresenceUser[];
  loadError: boolean;
  refreshTick: number;
  refresh: () => Promise<void>;
  saveCard: (
    id: number,
    patch: { title?: string; description?: string; version?: number },
  ) => Promise<SaveCardResult>;
  deleteCard: (id: number) => Promise<void>;
  toast: string | null;
  showToast: (message: string) => void;
  logout: () => Promise<void>;
  settings: SettingsMap;
  settingsVersion: number;
  refreshSettings: () => Promise<void>;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard must be used within BoardProvider");
  return ctx;
}

interface Props {
  user: User;
  onSignedOut: () => void;
  children: ReactNode;
}

export function BoardProvider({ user, onSignedOut, children }: Props) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInvite[]>([]);
  const [pickerRequired, setPickerRequired] = useState(false);
  const [workspacesReady, setWorkspacesReady] = useState(false);
  const [remindedInviteIds, setRemindedInviteIds] = useState<number[]>(() => readRemindedInviteIds());
  const [hasUnsavedCardEdits, setHasUnsavedCardEdits] = useState(false);
  const [switchConfirm, setSwitchConfirm] = useState<SwitchConfirmState>({ open: false });
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [columns, setColumns] = useState<Column[] | null>(null);
  const [metrics, setMetrics] = useState<FlowMetrics | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsMap>({ boardName: "Camel", logoPath: "/logo.png", version: 0 });
  const [settingsVersion, setSettingsVersion] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const hasUnsavedRef = useRef(hasUnsavedCardEdits);
  hasUnsavedRef.current = hasUnsavedCardEdits;

  const activeWorkspace =
    activeWorkspaceId === null
      ? null
      : workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const membershipCount = workspaces.length;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    if (activeWorkspaceId === null) return;
    try {
      const [board, m, a] = await Promise.all([
        api.getBoard(activeWorkspaceId),
        api.getMetrics(activeWorkspaceId),
        api.getActivity(activeWorkspaceId),
      ]);
      setColumns(board.columns);
      setMetrics(m);
      setActivity(a.events);
      setLoadError(false);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSignedOut();
        return;
      }
      setLoadError(true);
    }
  }, [activeWorkspaceId, onSignedOut]);

  const refreshSettings = useCallback(async () => {
    if (activeWorkspaceId === null) return;
    const s = await api.getSettings(activeWorkspaceId);
    setSettings(s);
    setSettingsVersion(s.version);
  }, [activeWorkspaceId]);

  const reloadWorkspaces = useCallback(async () => {
    const { workspaces: list, pendingInvites: invites } = await api.getWorkspaces();
    setWorkspaces(list);
    setPendingInvites(invites);
    return list;
  }, []);

  const switchWorkspace = useCallback((workspaceId: number) => {
    setHasUnsavedCardEdits(false);
    setSwitchConfirm({ open: false });
    setActiveWorkspaceId(workspaceId);
    persistWorkspaceId(workspaceId);
    setPickerRequired(false);
    setColumns(null);
    setMetrics(null);
    setActivity([]);
    setPresence([]);
    setLoadError(false);
  }, []);

  const attemptSwitchWorkspace = useCallback(
    (workspaceId: number) => {
      const state = getSwitchAttemptState({
        activeWorkspaceId,
        targetWorkspaceId: workspaceId,
        hasUnsavedCardEdits: hasUnsavedRef.current,
      });
      if (state.status === "noop") return;
      if (state.status === "confirm-required") {
        setSwitchConfirm({ open: true, pendingWorkspaceId: state.pendingWorkspaceId });
        return;
      }
      switchWorkspace(state.workspaceId);
    },
    [activeWorkspaceId, switchWorkspace],
  );

  const confirmPendingSwitch = useCallback(() => {
    if (!switchConfirm.open) return;
    switchWorkspace(switchConfirm.pendingWorkspaceId);
  }, [switchConfirm, switchWorkspace]);

  const cancelPendingSwitch = useCallback(() => {
    setSwitchConfirm({ open: false });
  }, []);

  const acceptWorkspaceInvite = useCallback(
    async (invite: WorkspaceInvite) => {
      try {
        await api.acceptInvite(invite.workspaceId, invite.id);
        const list = await reloadWorkspaces();
        switchWorkspace(list.find((w) => w.id === invite.workspaceId)?.id ?? invite.workspaceId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          showToast(err.message || CAP_MESSAGE);
          return;
        }
        showToast("Couldn't accept the invite. Try again.");
      }
    },
    [reloadWorkspaces, showToast, switchWorkspace],
  );

  const declineWorkspaceInvite = useCallback(
    async (invite: WorkspaceInvite) => {
      try {
        await api.declineInvite(invite.workspaceId, invite.id);
        await reloadWorkspaces();
      } catch {
        showToast("Couldn't decline the invite. Try again.");
      }
    },
    [reloadWorkspaces, showToast],
  );

  const remindInviteLater = useCallback((invite: WorkspaceInvite) => {
    setRemindedInviteIds((prev) => {
      if (prev.includes(invite.id)) return prev;
      const next = [...prev, invite.id];
      persistRemindedInviteIds(next);
      return next;
    });
  }, []);

  const openCreateWorkspace = useCallback(() => {
    setCreateWorkspaceOpen(true);
  }, []);

  const closeCreateWorkspace = useCallback(() => {
    setCreateWorkspaceOpen(false);
  }, []);

  const submitCreateWorkspace = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const prevIds = workspacesRef.current.map((w) => w.id);
        const created = await api.createWorkspace({ name: trimmed });
        await reloadWorkspaces();
        // .workspaces and .localStorageWrite are unused: reloadWorkspaces() and switchWorkspace() cover them.
        const selection = applyCreatedWorkspaceSelection({
          currentWorkspaceIds: prevIds,
          createdWorkspace: created,
        });
        switchWorkspace(selection.activeWorkspaceId);
        setCreateWorkspaceOpen(false);
        showToast(selection.toast);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          showToast(err.message || CAP_MESSAGE);
          return;
        }
        showToast("Couldn't create the workspace. Try again.");
      }
    },
    [reloadWorkspaces, showToast, switchWorkspace],
  );

  // Load workspace list and restore last-active workspace from localStorage.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { workspaces: list, pendingInvites: invites } = await api.getWorkspaces();
        if (!active) return;
        const selection = chooseInitialWorkspace({
          workspaces: list,
          savedWorkspaceId: readSavedWorkspaceId(),
        });
        if (selection.clearSavedWorkspace) clearSavedWorkspaceId();
        setWorkspaces(list);
        setPendingInvites(invites);
        setPickerRequired(selection.pickerRequired);
        if (selection.activeWorkspaceId !== null) {
          setActiveWorkspaceId(selection.activeWorkspaceId);
          persistWorkspaceId(selection.activeWorkspaceId);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onSignedOut();
          return;
        }
      } finally {
        if (active) setWorkspacesReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [onSignedOut]);

  // Board + collaboration wiring scoped to the active workspace.
  useEffect(() => {
    if (activeWorkspaceId === null) return;

    void refresh();
    void refreshSettings();

    const beat = () => {
      void api.heartbeat(activeWorkspaceId).catch(() => {});
      void api
        .getPresence(activeWorkspaceId)
        .then(({ users }) => setPresence(users))
        .catch(() => {});
    };
    beat();
    const heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const presenceTimer = setInterval(
      () =>
        void api
          .getPresence(activeWorkspaceId)
          .then(({ users }) => setPresence(users))
          .catch(() => {}),
      PRESENCE_REFRESH_MS,
    );

    const stream = new EventSource(`/api/workspaces/${activeWorkspaceId}/events/stream`);
    stream.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as {
          type?: string;
          userId?: number;
          workspaceId?: number;
          workspaceName?: string;
        };
        if (
          data.type === "membership.removed" &&
          data.userId === user.id &&
          data.workspaceId !== undefined &&
          data.workspaceName
        ) {
          const redirect = getRemovalRedirect({
            activeWorkspaceId,
            removedWorkspaceId: data.workspaceId,
            removedWorkspaceName: data.workspaceName,
            workspaces: workspacesRef.current,
          });
          if (redirect) {
            showToast(redirect.toast);
            void reloadWorkspaces().then(() => {
              switchWorkspace(redirect.nextWorkspaceId);
            });
            return;
          }
        }
        if (data.type === "settings.updated") void refreshSettings();
      } catch {
        // non-JSON keep-alive comment
      }
      void refresh();
    };

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(presenceTimer);
      stream.close();
    };
  }, [activeWorkspaceId, refresh, refreshSettings, reloadWorkspaces, showToast, switchWorkspace, user.id]);

  const saveCard = useCallback(
    async (
      id: number,
      patch: { title?: string; description?: string; version?: number },
    ): Promise<SaveCardResult> => {
      if (activeWorkspaceId === null) return "error";
      const current = columns
        ?.flatMap((col) => col.cards)
        .find((c) => c.id === id);
      try {
        await api.updateCard(activeWorkspaceId, id, {
          ...patch,
          version: patch.version ?? current?.version,
        });
        await refresh();
        return "saved";
      } catch (err) {
        if (err instanceof ApiError && err.code === "version_conflict") {
          showToast("Someone else updated this card first — board refreshed.");
          await refresh();
          return "conflict";
        }
        showToast("Couldn't save the card. Check your connection and try again.");
        return "error";
      }
    },
    [activeWorkspaceId, columns, refresh, showToast],
  );

  const deleteCard = useCallback(
    async (id: number) => {
      if (activeWorkspaceId === null) return;
      await api.deleteCard(activeWorkspaceId, id);
      await refresh();
    },
    [activeWorkspaceId, refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // session cookie is gone either way
    }
    onSignedOut();
  }, [onSignedOut]);

  return (
    <BoardContext.Provider
      value={{
        user,
        activeWorkspaceId,
        activeWorkspace,
        workspaces,
        pendingInvites,
        pickerRequired,
        workspacesReady,
        membershipCount,
        remindedInviteIds,
        hasUnsavedCardEdits,
        setHasUnsavedCardEdits,
        switchConfirm,
        attemptSwitchWorkspace,
        confirmPendingSwitch,
        cancelPendingSwitch,
        switchWorkspace,
        reloadWorkspaces,
        acceptWorkspaceInvite,
        declineWorkspaceInvite,
        remindInviteLater,
        openCreateWorkspace,
        closeCreateWorkspace,
        createWorkspaceOpen,
        submitCreateWorkspace,
        columns,
        setColumns,
        metrics,
        activity,
        presence,
        loadError,
        refreshTick,
        refresh,
        saveCard,
        deleteCard,
        toast,
        showToast,
        logout,
        settings,
        settingsVersion,
        refreshSettings,
      }}
    >
      {children}
    </BoardContext.Provider>
  );
}
