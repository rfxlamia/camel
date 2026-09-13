import { useEffect, useRef } from "react";
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

const POPOVER_FOCUSABLE_SELECTOR =
	"button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function trapPopoverFocus(event: KeyboardEvent, panel: HTMLElement) {
	const focusable = Array.from(
		panel.querySelectorAll<HTMLElement>(POPOVER_FOCUSABLE_SELECTOR),
	).filter((element) => !element.hasAttribute("disabled"));
	const first = focusable[0];
	const last = focusable.at(-1);
	if (!first || !last) return;
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}

function handlePopoverKeyDown(
	event: React.KeyboardEvent<HTMLDivElement>,
	panel: HTMLElement | null,
	onCancel: () => void,
) {
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		onCancel();
		return;
	}
	if (event.key !== "Tab" || !panel) return;
	event.stopPropagation();
	trapPopoverFocus(event.nativeEvent, panel);
}

function usePopoverFocusLifecycle(
	open: boolean,
	panelRef: React.RefObject<HTMLDivElement>,
	onCancel: () => void,
) {
	useEffect(() => {
		if (!open) return;
		const panel = panelRef.current;
		panel?.querySelector<HTMLElement>(POPOVER_FOCUSABLE_SELECTOR)?.focus();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onCancel();
				return;
			}
			if (event.key !== "Tab" || !panel?.contains(event.target as Node)) return;
			event.stopPropagation();
			trapPopoverFocus(event, panel);
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [open, onCancel, panelRef]);
}

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
	const panelRef = useRef<HTMLDivElement>(null);
	usePopoverFocusLifecycle(open, panelRef, onCancel);

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
			ref={panelRef}
			onKeyDown={(event) =>
				handlePopoverKeyDown(event, panelRef.current, onCancel)
			}
			data-overlay-layer="popover"
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
