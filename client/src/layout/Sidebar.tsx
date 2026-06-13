import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { NavLink } from "react-router";
import {
  Activity,
  Check,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  SquareKanban,
  X,
  type LucideIcon,
} from "lucide-react";
import { useBoard } from "../context/BoardContext";
import {
  getInvitePopoverState,
  getSwitchAttemptState,
  getWorkspaceLimitActionState,
  workspaceInitials,
} from "../lib/workspaceSwitcher";
import type { Workspace, WorkspaceInvite } from "../types";

export const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/board", label: "Board", icon: SquareKanban },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  const base =
    "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600";
  return isActive
    ? `${base} bg-primary-100 font-medium text-primary-800`
    : `${base} text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900`;
}

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

/* ------------------------------------------------------------------ */
/*  Shared popover shell (SignOutPopover pattern)                      */
/* ------------------------------------------------------------------ */

interface PopoverShellProps {
  open: boolean;
  onCancel: () => void;
  placement?: "right" | "top";
  ariaLabel: string;
  children: React.ReactNode;
}

function PopoverShell({
  open,
  onCancel,
  placement = "right",
  ariaLabel,
  children,
}: PopoverShellProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const positionClasses =
    placement === "right"
      ? "left-full ml-2 top-1/2 -translate-y-1/2"
      : "bottom-full mb-2 left-0";

  const arrowClasses =
    placement === "right"
      ? "absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 rotate-45 bg-white border-l border-b border-neutral-200"
      : "absolute left-4 bottom-0 translate-y-1/2 w-2 h-2 rotate-45 bg-white border-r border-b border-neutral-200";

  return (
    <div className={`absolute z-50 ${positionClasses}`} role="dialog" aria-label={ariaLabel}>
      <div className="relative rounded-lg border border-neutral-200 bg-white p-3 shadow-lg w-56">
        <div className={arrowClasses} />
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sign-out confirmation popover                                      */
/* ------------------------------------------------------------------ */

interface SignOutPopoverProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  placement?: "right" | "top";
}

export function SignOutPopover({
  open,
  onConfirm,
  onCancel,
  placement = "right",
}: SignOutPopoverProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => cancelRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  return (
    <PopoverShell open={open} onCancel={onCancel} placement={placement} ariaLabel="Confirm sign out">
      <p className="text-sm font-medium text-neutral-700">Sign out?</p>
      <p className="mt-1 text-xs text-neutral-500">You will be logged out of your account.</p>
      <div className="mt-3 flex gap-2">
        <button
          ref={cancelRef}
          onClick={onCancel}
          className="flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          Sign out
        </button>
      </div>
    </PopoverShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Workspace avatar                                                   */
/* ------------------------------------------------------------------ */

function WorkspaceAvatar({ workspace, logoPath }: { workspace: Workspace; logoPath?: string }) {
  if (logoPath && logoPath !== "/logo.png") {
    return (
      <img
        src={logoPath}
        alt=""
        className="h-6 w-6 shrink-0 rounded object-cover"
      />
    );
  }
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary-100 text-[10px] font-semibold text-primary-800"
      aria-hidden
    >
      {workspaceInitials(workspace.name)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Workspace switcher                                                 */
/* ------------------------------------------------------------------ */

interface WorkspaceSwitcherProps {
  collapsed?: boolean;
  placement?: "right" | "top";
}

function WorkspaceSwitcher({ collapsed = false, placement = "right" }: WorkspaceSwitcherProps) {
  const {
    activeWorkspace,
    activeWorkspaceId,
    workspaces,
    settings,
    pendingInvites,
    remindedInviteIds,
    membershipCount,
    hasUnsavedCardEdits,
    attemptSwitchWorkspace,
    switchConfirm,
    confirmPendingSwitch,
    cancelPendingSwitch,
    openCreateWorkspace,
  } = useBoard();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const invitePopover = getInvitePopoverState({
    switcherOpen: open,
    remindedInviteIds,
    pendingInvites,
  });

  const createLimit = getWorkspaceLimitActionState({
    membershipCount,
    action: "create-workspace",
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        cancelPendingSwitch();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, cancelPendingSwitch]);

  const selectWorkspace = (id: number) => {
    const state = getSwitchAttemptState({
      activeWorkspaceId,
      targetWorkspaceId: id,
      hasUnsavedCardEdits,
    });
    attemptSwitchWorkspace(id);
    if (state.status !== "confirm-required") setOpen(false);
  };

  const labelHidden = collapsed ? "hidden" : "hidden lg:inline";

  if (!activeWorkspace) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
        <span className="h-6 w-6 shrink-0 rounded bg-neutral-200" />
        <span className={`truncate text-base font-semibold text-primary-900 ${labelHidden}`}>
          Choose workspace
        </span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
      >
        <WorkspaceAvatar workspace={activeWorkspace} logoPath={settings.logoPath} />
        <span className={`min-w-0 truncate text-base font-semibold text-primary-900 ${labelHidden}`}>
          {activeWorkspace.name}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""} ${collapsed ? "hidden" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full z-50 mb-1 w-56 rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
          role="listbox"
          aria-label="Workspaces"
        >
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              role="option"
              aria-selected={ws.id === activeWorkspaceId}
              onClick={() => selectWorkspace(ws.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                ws.id === activeWorkspaceId
                  ? "bg-primary-100 font-medium text-primary-800"
                  : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              <WorkspaceAvatar workspace={ws} />
              <span className="min-w-0 truncate">{ws.name}</span>
              {ws.id === activeWorkspaceId && <Check size={14} className="ml-auto shrink-0" aria-hidden />}
            </button>
          ))}
          <div className="my-1 border-t border-neutral-200" />
          <button
            type="button"
            disabled={createLimit.disabled}
            title={createLimit.message ?? undefined}
            onClick={() => {
              setOpen(false);
              openCreateWorkspace();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
          >
            <Plus size={16} aria-hidden />
            Create workspace
          </button>
          {createLimit.disabled && createLimit.message && (
            <p className="px-3 pb-2 text-xs text-neutral-500">{createLimit.message}</p>
          )}
        </div>
      )}

      <PopoverShell
        open={switchConfirm.open}
        onCancel={cancelPendingSwitch}
        placement={placement}
        ariaLabel="Confirm workspace switch"
      >
        <p className="text-sm font-medium text-neutral-700">Switch workspace?</p>
        <p className="mt-1 text-xs text-neutral-500">
          You have unsaved card edits. They will be discarded.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={cancelPendingSwitch}
            className="flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              confirmPendingSwitch();
              setOpen(false);
            }}
            className="flex-1 rounded-md bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            Switch
          </button>
        </div>
      </PopoverShell>

      {invitePopover.visible && (
        <PopoverShell
          open
          onCancel={() => setOpen(false)}
          placement={placement}
          ariaLabel="Pending workspace invites"
        >
          <p className="text-sm font-medium text-neutral-700">Pending invites</p>
          <ul className="mt-2 space-y-2">
            {invitePopover.invites.map((invite) => (
              <li key={invite.id} className="text-xs text-neutral-600">
                <span className="font-medium text-neutral-800">{invite.workspaceName}</span>
                <span className="text-neutral-500"> · {invite.role}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-neutral-500">Open invites from the banner when you sign in.</p>
        </PopoverShell>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Global workspace overlays (picker, invites, create)                  */
/* ------------------------------------------------------------------ */

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}

function BlockingInviteModal({ invite }: { invite: WorkspaceInvite }) {
  const {
    acceptWorkspaceInvite,
    declineWorkspaceInvite,
    remindInviteLater,
    membershipCount,
  } = useBoard();
  const [busy, setBusy] = useState(false);
  const acceptLimit = getWorkspaceLimitActionState({
    membershipCount,
    action: "accept-invite",
  });

  const run = async (action: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalBackdrop>
      <div
        role="dialog"
        aria-label="Workspace invite"
        className="rounded-lg border border-neutral-200 bg-white p-6 shadow-lg"
      >
        <h2 className="text-md font-semibold text-neutral-900">Workspace invite</h2>
        <p className="mt-2 text-sm text-neutral-600">
          You&apos;ve been invited to join{" "}
          <span className="font-medium text-neutral-900">{invite.workspaceName}</span> as{" "}
          {invite.role}.
        </p>
        {acceptLimit.disabled && acceptLimit.message && (
          <p className="mt-3 text-xs font-medium text-error-900">{acceptLimit.message}</p>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={busy || acceptLimit.disabled}
            onClick={() => void run(() => acceptWorkspaceInvite(invite))}
            className="flex-1 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => declineWorkspaceInvite(invite))}
            className="flex-1 rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-neutral-200"
          >
            Decline
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => remindInviteLater(invite)}
            className="flex-1 rounded-md px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100"
          >
            Remind me later
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function WorkspacePickerModal() {
  const {
    workspaces,
    activeWorkspaceId,
    membershipCount,
    attemptSwitchWorkspace,
    openCreateWorkspace,
  } = useBoard();
  const createLimit = getWorkspaceLimitActionState({
    membershipCount,
    action: "create-workspace",
  });

  return (
    <ModalBackdrop>
      <div
        role="dialog"
        aria-label="Choose a workspace"
        className="rounded-lg border border-neutral-200 bg-white p-6 shadow-lg"
      >
        <h2 className="text-md font-semibold text-neutral-900">Choose a workspace</h2>
        <p className="mt-1 text-sm text-neutral-600">Select where you want to work.</p>
        <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <button
                type="button"
                onClick={() => attemptSwitchWorkspace(ws.id)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                  ws.id === activeWorkspaceId
                    ? "bg-primary-100 font-medium text-primary-800"
                    : "text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                <WorkspaceAvatar workspace={ws} />
                <span className="truncate">{ws.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-neutral-200 pt-4">
          <button
            type="button"
            disabled={createLimit.disabled}
            title={createLimit.message ?? undefined}
            onClick={openCreateWorkspace}
            className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100 disabled:cursor-not-allowed disabled:text-neutral-400"
          >
            <Plus size={16} aria-hidden />
            Create workspace
          </button>
          {createLimit.disabled && createLimit.message && (
            <p className="mt-2 text-center text-xs text-neutral-500">{createLimit.message}</p>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}

function CreateWorkspaceModal() {
  const { createWorkspaceOpen, closeCreateWorkspace, submitCreateWorkspace, membershipCount } =
    useBoard();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const limit = getWorkspaceLimitActionState({
    membershipCount,
    action: "create-workspace",
  });

  useEffect(() => {
    if (createWorkspaceOpen) setName("");
  }, [createWorkspaceOpen]);

  if (!createWorkspaceOpen) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || limit.disabled) return;
    setBusy(true);
    try {
      await submitCreateWorkspace(name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalBackdrop onClose={closeCreateWorkspace}>
      <form
        role="dialog"
        aria-label="Create workspace"
        onSubmit={(e) => void submit(e)}
        className="rounded-lg border border-neutral-200 bg-white p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-md font-semibold text-neutral-900">Create workspace</h2>
          <button
            type="button"
            onClick={closeCreateWorkspace}
            aria-label="Close"
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-200"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-neutral-700">Workspace name</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            autoFocus
            required
            disabled={limit.disabled}
          />
        </label>
        {limit.disabled && limit.message && (
          <p className="mt-2 text-xs font-medium text-error-900">{limit.message}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeCreateWorkspace}
            className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-neutral-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || limit.disabled || !name.trim()}
            className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            Create
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

/** Blocking invite, picker, and create modals — mount once at app shell level. */
export function WorkspaceOverlays() {
  const {
    workspacesReady,
    pickerRequired,
    activeWorkspaceId,
    pendingInvites,
    remindedInviteIds,
  } = useBoard();

  if (!workspacesReady) return null;

  const blockingInvite =
    pendingInvites.find((invite) => !remindedInviteIds.includes(invite.id)) ?? null;

  return (
    <>
      {blockingInvite && <BlockingInviteModal invite={blockingInvite} />}
      {!blockingInvite && pickerRequired && activeWorkspaceId === null && <WorkspacePickerModal />}
      <CreateWorkspaceModal />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop sidebar                                                    */
/* ------------------------------------------------------------------ */

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { logout, settings } = useBoard();
  const labelClass = collapsed ? "hidden" : "hidden lg:inline whitespace-nowrap";
  const [showSignOutPopover, setShowSignOutPopover] = useState(false);

  const handleSignOut = useCallback(() => {
    setShowSignOutPopover(false);
    void logout();
  }, [logout]);

  return (
    <aside
      className={`hidden shrink-0 flex-col border-r border-neutral-200 bg-white transition-[width] duration-200 md:flex ${
        collapsed ? "w-14" : "w-14 lg:w-56"
      }`}
    >
      <div className="flex h-14 items-center gap-2 border-b border-neutral-200 px-3">
        <img src={settings.logoPath} alt={settings.boardName} className="h-6 w-6 shrink-0" />
        <span className={`text-base font-semibold text-primary-900 ${labelClass}`}>
          {settings.boardName}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Main">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={navLinkClass} title={label}>
            <Icon size={18} className="shrink-0" aria-hidden />
            <span className={labelClass}>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-neutral-200 p-2">
        <WorkspaceSwitcher collapsed={collapsed} placement="top" />
      </div>

      <div className="relative border-t border-neutral-200 p-2">
        <button
          onClick={() => setShowSignOutPopover((prev) => !prev)}
          title="Sign out"
          aria-label="Sign out"
          className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
        >
          <LogOut size={18} className="shrink-0" aria-hidden />
          <span className={labelClass}>Sign out</span>
        </button>
        <SignOutPopover
          open={showSignOutPopover}
          onConfirm={handleSignOut}
          onCancel={() => setShowSignOutPopover(false)}
          placement="right"
        />
      </div>

      <div className="hidden border-t border-neutral-200 p-2 lg:block">
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
        >
          {collapsed ? (
            <PanelLeftOpen size={18} className="shrink-0" aria-hidden />
          ) : (
            <PanelLeftClose size={18} className="shrink-0" aria-hidden />
          )}
          <span className={labelClass}>Collapse</span>
        </button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile drawer                                                      */
/* ------------------------------------------------------------------ */

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  const { logout, settings } = useBoard();
  const [showSignOutPopover, setShowSignOutPopover] = useState(false);

  const handleSignOut = useCallback(() => {
    setShowSignOutPopover(false);
    onClose();
    void logout();
  }, [logout, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div
        className="absolute inset-0 bg-neutral-900/40"
        onClick={showSignOutPopover ? undefined : onClose}
        aria-hidden
      />
      <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-lg">
        <div className="flex h-14 items-center justify-between gap-2 border-b border-neutral-200 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <img src={settings.logoPath} alt={settings.boardName} className="h-6 w-6 shrink-0" />
            <span className="truncate text-base font-semibold text-primary-900">
              {settings.boardName}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="shrink-0 rounded-md p-2 text-neutral-600 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                `${navLinkClass({ isActive })} min-h-11 text-base`
              }
            >
              <Icon size={20} className="shrink-0" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-neutral-200 p-3">
          <WorkspaceSwitcher placement="top" />
        </div>

        <div className="relative border-t border-neutral-200 p-3">
          <button
            onClick={() => setShowSignOutPopover((prev) => !prev)}
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            <LogOut size={18} className="shrink-0" aria-hidden />
            Sign out
          </button>
          <SignOutPopover
            open={showSignOutPopover}
            onConfirm={handleSignOut}
            onCancel={() => setShowSignOutPopover(false)}
            placement="top"
          />
        </div>
      </div>
    </div>
  );
}
