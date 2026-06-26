import { useEffect, useRef } from "react";
import { PopoverShell } from "./shared";

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
		<PopoverShell
			open={open}
			onCancel={onCancel}
			placement={placement}
			ariaLabel="Confirm sign out"
		>
			<p className="text-sm font-medium text-neutral-700">Sign out?</p>
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
		</PopoverShell>
	);
}
