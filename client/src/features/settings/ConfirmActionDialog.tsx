import { useEffect } from "react";

export interface ConfirmActionDialogProps {
	/** DOM id of the title element, referenced by aria-labelledby. */
	titleId: string;
	title: string;
	description: string;
	confirmLabel: string;
	/** Button label shown while the action is in flight. */
	busyLabel: string;
	/** Accessible name of the confirm button (distinct from other buttons). */
	confirmAriaLabel: string;
	busy: boolean;
	tone?: "primary" | "error";
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * Modal confirmation dialog shared by destructive/impactful member actions
 * (remove member, transfer ownership). Escape, backdrop clicks, and the
 * Cancel button dismiss the dialog only while the action is NOT in flight —
 * once `busy` is set the operation cannot be dismissed away (it is not
 * cancellable), and the parent stays responsible for closing the dialog when
 * the action settles.
 */
export default function ConfirmActionDialog({
	titleId,
	title,
	description,
	confirmLabel,
	busyLabel,
	confirmAriaLabel,
	busy,
	tone = "primary",
	onConfirm,
	onCancel,
}: ConfirmActionDialogProps) {
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape" && !busy) onCancel();
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onCancel, busy]);

	function handleBackdropCancel() {
		if (!busy) onCancel();
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			onClick={handleBackdropCancel}
		>
			<div
				className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<p id={titleId} className="font-medium text-neutral-800">
					{title}
				</p>
				<p className="mt-1 text-sm text-neutral-500">{description}</p>
				<div className="mt-4 flex gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={busy}
						className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={busy}
						aria-label={confirmAriaLabel}
						className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 ${
							tone === "error"
								? "bg-error-500 hover:bg-error-600"
								: "bg-primary-600 hover:bg-primary-700"
						}`}
					>
						{busy ? busyLabel : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
