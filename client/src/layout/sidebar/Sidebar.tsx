import {
	LogOut,
	PanelLeftClose,
	PanelLeftOpen,
} from "lucide-react";
import { useCallback, useState } from "react";
import { NavLink } from "react-router";
import { useBoard } from "../../context/BoardContext";
import { AGENT_NAV, KANBAN_NAV, SETTINGS_ITEM } from "./navItems";
import { type Mode, navLinkClass } from "./shared";
import { ModeSwitcher } from "./ModeSwitcher";
import { SignOutPopover } from "./SignOutPopover";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/* ------------------------------------------------------------------ */
/*  Desktop sidebar                                                    */
/* ------------------------------------------------------------------ */

interface SidebarProps {
	collapsed: boolean;
	onToggle: () => void;
	mode: Mode;
	onModeChange: (m: Mode) => void;
}

export default function Sidebar({
	collapsed,
	onToggle,
	mode,
	onModeChange,
}: SidebarProps) {
	const { logout, settings } = useBoard();
	const labelClass = collapsed
		? "hidden"
		: "hidden lg:inline whitespace-nowrap";
	const [showSignOutPopover, setShowSignOutPopover] = useState(false);

	const handleSignOut = useCallback(() => {
		setShowSignOutPopover(false);
		void logout();
	}, [logout]);

	const activeNav = mode === "kanban" ? KANBAN_NAV : AGENT_NAV;

	return (
		<aside
			className={`hidden shrink-0 flex-col border-r border-neutral-200 bg-white transition-[width] duration-200 md:flex ${
				collapsed ? "w-14" : "w-14 lg:w-56"
			}`}
		>
			{/* Header */}
			<div className="flex h-14 items-center gap-2 border-b border-neutral-200 px-3">
				<img
					src={settings.logoPath}
					alt={settings.boardName}
					className="h-6 w-6 shrink-0"
				/>
				<span className={`text-sm font-medium text-primary-900 ${labelClass}`}>
					{settings.boardName}
				</span>
			</div>

			{/* Mode switcher — only visible when expanded */}
			{!collapsed && (
				<div className="hidden border-b border-neutral-200 px-2 py-2 lg:block">
					<ModeSwitcher mode={mode} onSwitch={onModeChange} />
				</div>
			)}

			{/* Nav items */}
			<nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Main">
				{activeNav.map(({ to, label, icon: Icon }) => (
					<NavLink key={to} to={to} className={navLinkClass} title={label}>
						<Icon size={18} className="shrink-0" aria-hidden />
						<span className={labelClass}>{label}</span>
					</NavLink>
				))}
			</nav>

			{/* Footer */}
			<div className="border-t border-neutral-200 p-2 space-y-1">
				{/* Workspace switcher */}
				<WorkspaceSwitcher collapsed={collapsed} placement="top" />

				{/* Settings */}
				<NavLink
					to={SETTINGS_ITEM.to}
					className={navLinkClass}
					title={SETTINGS_ITEM.label}
				>
					<SETTINGS_ITEM.icon size={18} className="shrink-0" aria-hidden />
					<span className={labelClass}>{SETTINGS_ITEM.label}</span>
				</NavLink>

				{/* Sign out */}
				<div className="relative">
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

				{/* Collapse toggle — desktop only */}
				<button
					onClick={onToggle}
					title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					className="hidden lg:flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
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
