import { NavLink } from "react-router";
import {
  Activity,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  SquareKanban,
  X,
  type LucideIcon,
} from "lucide-react";

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
  const labelClass = collapsed ? "hidden" : "hidden lg:inline whitespace-nowrap";
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

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

/** Full-label overlay drawer for screens below md. */
export function MobileNav({ open, onClose }: MobileNavProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div
        className="absolute inset-0 bg-neutral-900/40"
        onClick={onClose}
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
        <nav className="flex flex-col gap-1 p-3" aria-label="Main">
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
      </div>
    </div>
  );
}
