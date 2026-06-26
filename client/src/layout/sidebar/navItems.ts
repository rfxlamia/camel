import {
	Activity,
	Bot,
	History,
	LayoutDashboard,
	Settings,
	type LucideIcon,
	SquareKanban,
} from "lucide-react";
import type { Mode } from "./shared";

export const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
	{ to: "/board", label: "Board", icon: SquareKanban },
	{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ to: "/activity", label: "Activity", icon: Activity },
	{ to: "/agent", label: "Agent", icon: Bot },
	{ to: "/history", label: "History", icon: History },
	{ to: "/settings", label: "Settings", icon: Settings },
];

// Items grouped by mode (Settings lives in footer, kept in NAV_ITEMS for AppLayout pageTitle)
// Activity is intentionally not a top-level nav item — it's a board changelog,
// reachable from the Dashboard "View all" drill-down rather than a primary peer.
export const KANBAN_NAV = NAV_ITEMS.filter((i) =>
	["/board", "/dashboard"].includes(i.to),
);
export const AGENT_NAV = NAV_ITEMS.filter((i) =>
	["/agent", "/history"].includes(i.to),
);
export const AGENT_PATHS = ["/agent", "/history"];
export const SETTINGS_ITEM = NAV_ITEMS.find((i) => i.to === "/settings")!;

export function getModeFromPath(pathname: string): Mode {
	return AGENT_PATHS.some((p) => pathname.startsWith(p)) ? "agent" : "kanban";
}
