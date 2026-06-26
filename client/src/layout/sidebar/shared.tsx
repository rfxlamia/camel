import { useEffect } from "react";
import type React from "react";

export type Mode = "kanban" | "agent";

export function navLinkClass({ isActive }: { isActive: boolean }): string {
	const base =
		"flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600";
	return isActive
		? `${base} bg-primary-100 font-medium text-primary-800`
		: `${base} text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900`;
}

export const inputClass =
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

export function PopoverShell({
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
			: "bottom-full mb-4 left-0";

	const arrowClasses =
		placement === "right"
			? "absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 rotate-45 bg-white border-l border-b border-neutral-200"
			: "absolute left-4 bottom-0 translate-y-1/2 w-2 h-2 rotate-45 bg-white border-r border-b border-neutral-200";

	return (
		<div
			className={`absolute z-50 ${positionClasses}`}
			role="dialog"
			aria-label={ariaLabel}
		>
			<div className="relative rounded-lg border border-neutral-200 bg-white p-3 shadow-lg w-56">
				<div className={arrowClasses} />
				{children}
			</div>
		</div>
	);
}
