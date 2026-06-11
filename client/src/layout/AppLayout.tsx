import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Menu } from "lucide-react";
import { useBoard } from "../context/BoardContext";
import MetricsBar from "../components/MetricsBar";
import PresenceBar from "../components/PresenceBar";
import Toast from "../components/Toast";
import Sidebar, { MobileNav, NAV_ITEMS } from "./Sidebar";

const SIDEBAR_COLLAPSED_KEY = "camel.sidebar.collapsed";

export default function AppLayout() {
  const { user, metrics, presence, toast, logout } = useBoard();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const pageTitle =
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))?.label ??
    "Board";

  return (
    <div className="flex h-screen">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="rounded-md p-2 text-neutral-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 md:hidden"
            >
              <Menu size={20} aria-hidden />
            </button>
            <h1 className="text-md font-semibold text-primary-900">{pageTitle}</h1>
          </div>

          {/* Quick metrics stay visible on every page. */}
          <div className="hidden lg:block">
            <MetricsBar metrics={metrics} />
          </div>

          <div className="flex items-center gap-3">
            <PresenceBar users={presence} self={user} />
            <span
              className="hidden text-sm text-neutral-700 sm:inline"
              title={`@${user.username}`}
            >
              {user.displayName}
            </span>
            <button
              onClick={() => void logout()}
              className="rounded-md px-2 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}
