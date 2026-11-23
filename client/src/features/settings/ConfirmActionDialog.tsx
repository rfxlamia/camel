import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
	);
}

function restoreFocus(previouslyFocused: HTMLElement | null) {
	if (previouslyFocused?.isConnected) {
		previouslyFocused.focus();
		return;
	}
	document
		.querySelector<HTMLElement>(
			"button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
		)
		?.focus();
}

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
 * the action settles. Focus moves into the dialog on open, Tab stays inside
 * it, and focus returns to the trigger — or another remaining control if that
 * trigger is gone.
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
	const panelRef = useRef<HTMLDivElement>(null);
	const onCancelRef = useRef(onCancel);
	const busyRef = useRef(busy);
	onCancelRef.current = onCancel;
	busyRef.current = busy;

	useEffect(() => {
		const previouslyFocused =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const panel = panelRef.current;
		const initial = panel ? focusableIn(panel)[0] : undefined;
		(initial ?? panel)?.focus();

		// Capture runs before the panel stops keydown propagation, so Escape
		// from a focused dialog button still reaches this handler.
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				if (!busyRef.current) onCancelRef.current();
				return;
			}
			if (event.key !== "Tab" || !panel) return;
			const items = focusableIn(panel);
			const first = items[0];
			const last = items[items.length - 1];
			if (!first || !last) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const active = document.activeElement;
			const inside = active instanceof Node && panel.contains(active);
			if (event.shiftKey && (!inside || active === first)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (!inside || active === last)) {
				event.preventDefault();
				first.focus();
			}
		}

		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			restoreFocus(previouslyFocused);
		};
	}, []);

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
				ref={panelRef}
				tabIndex={-1}
				className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg outline-none"
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
