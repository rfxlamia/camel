import { LogOut, X } from "lucide-react";
import { useCallback, useState } from "react";
import { NavLink } from "react-router";
import { useBoard } from "../../context/BoardContext";
import { AGENT_NAV, KANBAN_NAV, SETTINGS_ITEM } from "./navItems";
import { type Mode, navLinkClass } from "./shared";
import { ModeSwitcher } from "./ModeSwitcher";
import { SignOutPopover } from "./SignOutPopover";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

interface MobileNavProps {
	open: boolean;
	onClose: () => void;
	mode: Mode;
	onModeChange: (m: Mode) => void;
}

export function MobileNav({ open, onClose, mode, onModeChange }: MobileNavProps) {
	const { logout, settings } = useBoard();
	const [showSignOutPopover, setShowSignOutPopover] = useState(false);

	const handleSignOut = useCallback(() => {
		setShowSignOutPopover(false);
		onClose();
		void logout();
	}, [logout, onClose]);

	const activeNav = mode === "kanban" ? KANBAN_NAV : AGENT_NAV;

	if (!open) return null;
	return (
		<div className="fixed inset-0 z-40 md:hidden">
			<div
				className="absolute inset-0 bg-neutral-900/40"
				onClick={showSignOutPopover ? undefined : onClose}
				aria-hidden
			/>
			<div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-lg">
				{/* Header */}
				<div className="flex h-14 items-center justify-between gap-2 border-b border-neutral-200 px-4">
					<div className="flex min-w-0 flex-1 items-center gap-2">
						<img
							src={settings.logoPath}
							alt={settings.boardName}
							className="h-6 w-6 shrink-0"
						/>
						<span className="truncate text-sm font-medium text-primary-900">
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

				{/* Mode switcher */}
				<div className="border-b border-neutral-200 px-3 py-2">
					<ModeSwitcher mode={mode} onSwitch={onModeChange} />
				</div>

				{/* Nav items */}
				<nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
					{activeNav.map(({ to, label, icon: Icon }) => (
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

				{/* Footer */}
				<div className="border-t border-neutral-200 p-3 space-y-1">
					<NavLink
						to={SETTINGS_ITEM.to}
						onClick={onClose}
						className={({ isActive }) =>
							`${navLinkClass({ isActive })} min-h-11 text-base`
						}
					>
						<SETTINGS_ITEM.icon size={20} className="shrink-0" aria-hidden />
						{SETTINGS_ITEM.label}
					</NavLink>

					<WorkspaceSwitcher placement="top" />

					<div className="relative">
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
		</div>
	);
}
