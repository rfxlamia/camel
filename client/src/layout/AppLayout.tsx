import { Menu, SquareKanban } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import PresenceBar from "../components/PresenceBar";
import Toast from "../components/Toast";
import { useBoard } from "../context/BoardContext";
import { formatTitle, getFaviconLink } from "../lib/title";
import Sidebar, { MobileNav, NAV_ITEMS, WorkspaceOverlays } from "./sidebar";
import { useSidebarMode } from "./sidebar/useSidebarMode";

const SIDEBAR_COLLAPSED_KEY = "camel.sidebar.collapsed";

export default function AppLayout() {
	const { user, presence, toast, settings } = useBoard();
	const [mode, setMode] = useSidebarMode();
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
	);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	const location = useLocation();

	const onSettings = location.pathname.startsWith("/settings");

	useEffect(() => {
		localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
	}, [collapsed]);

	useEffect(() => {
		// Spec Story 5: the Settings page tab reads "Settings — <board>";
		// every other route uses the default "<board> — Kanban".
		document.title = onSettings
			? `Settings — ${settings.boardName}`
			: formatTitle(settings.boardName);

		// Update favicon
		let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
		if (!link) {
			link = document.createElement("link");
			link.rel = "icon";
			document.head.appendChild(link);
		}
		link.href = getFaviconLink(settings.logoPath);
	}, [settings.boardName, settings.logoPath, onSettings]);

	const activeItem = NAV_ITEMS.find((item) =>
		location.pathname.startsWith(item.to),
	);
	const PageIcon = activeItem?.icon ?? SquareKanban;
	const pageTitle = activeItem?.label ?? "Board";

	return (
		<div className="flex h-screen">
			<WorkspaceOverlays />
			<Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} mode={mode} onModeChange={setMode} />
			<MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} mode={mode} onModeChange={setMode} />

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
						<span className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
							<PageIcon size={15} className="text-neutral-400" aria-hidden />
							{pageTitle}
						</span>
					</div>

					<div className="flex items-center gap-3">
						<PresenceBar users={presence} self={user} />
					</div>
				</header>

				<main className="min-h-0 flex-1 overflow-auto">
					<Outlet />
				</main>
			</div>

			{toast && <Toast message={toast.message} type={toast.type} />}
		</div>
	);
}
