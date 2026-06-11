import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import {
  Activity,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  SquareKanban,
  X,
  type LucideIcon,
} from "lucide-react";
import { useBoard } from "../context/BoardContext";

export const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/board", label: "Board", icon: SquareKanban },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/activity", label: "Activity", icon: Activity },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  const base =
    "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600";
  return isActive
    ? `${base} bg-primary-100 font-medium text-primary-800`
    : `${base} text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900`;
}

/* ------------------------------------------------------------------ */
/*  Sign-out confirmation popover                                      */
/* ------------------------------------------------------------------ */

interface SignOutPopoverProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Where the popover appears: "right" (desktop sidebar) or "top" (mobile) */
  placement?: "right" | "top";
}

export function SignOutPopover({
  open,
  onConfirm,
  onCancel,
  placement = "right",
}: SignOutPopoverProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button when the popover opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => cancelRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Close on Escape key
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

  // Arrow positioning
  const arrowClasses =
    placement === "right"
      ? "absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 rotate-45 bg-white border-l border-b border-neutral-200"
      : "absolute left-4 bottom-0 translate-y-1/2 w-2 h-2 rotate-45 bg-white border-r border-b border-neutral-200";

  return (
    <div
      className={`absolute z-50 ${positionClasses}`}
      role="dialog"
      aria-label="Confirm sign out"
    >
      <div className="relative rounded-lg bg-white p-3 shadow-lg border border-neutral-200 w-52">
        <div className={arrowClasses} />
        <p className="text-sm text-neutral-700 font-medium">Sign out?</p>
        <p className="mt-1 text-xs text-neutral-500">
          You will be logged out of your account.
        </p>
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
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop sidebar                                                    */
/* ------------------------------------------------------------------ */

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Desktop/tablet sidebar. Hidden below md (mobile uses the drawer).
 * On md screens it is always icon-only; on lg+ it expands to 224px
 * unless the user collapsed it.
 */
export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { logout } = useBoard();
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
        <img src="/logo.png" alt="Camel" className="h-6 w-6 shrink-0" />
        <span className={`text-base font-semibold text-primary-900 ${labelClass}`}>
          Camel
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

      {/* Sign out button — above collapse section */}
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

      {/* Collapse button */}
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

/** Full-label overlay drawer for screens below md. */
export function MobileNav({ open, onClose }: MobileNavProps) {
  const { logout } = useBoard();
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
        <div className="flex h-14 items-center justify-between border-b border-neutral-200 px-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Camel" className="h-6 w-6" />
            <span className="text-base font-semibold text-primary-900">Camel</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-md p-2 text-neutral-600 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
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

        {/* Sign out button at bottom of mobile nav */}
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
