import { useEffect, useRef } from "react";

interface Props {
	ariaLabel: string;
	title: string;
	description: string;
	onConfirm: () => void | Promise<void>;
	onCancel: () => void;
	confirmLabel?: string;
	cancelLabel?: string;
}

export default function TrackerConfirmDialog({
	ariaLabel,
	title,
	description,
	onConfirm,
	onCancel,
	confirmLabel = "Delete",
	cancelLabel = "Cancel",
}: Props) {
	const panelRef = useRef<HTMLDivElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		cancelRef.current?.focus();
	}, []);

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onCancel();
				return;
			}
			if (e.key !== "Tab") return;

			const focusable = panel.querySelectorAll<HTMLElement>(
				"button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
			);
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (!first || !last) return;

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else if (document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onCancel]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
			role="dialog"
			aria-modal="true"
			aria-label={ariaLabel}
		>
			<div
				ref={panelRef}
				className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg"
			>
				<p className="font-medium text-error-700">{title}</p>
				<p className="mt-1 text-neutral-600 text-sm">{description}</p>
				<div className="mt-4 flex gap-2">
					<button
						ref={cancelRef}
						type="button"
						onClick={onCancel}
						className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={() => void onConfirm()}
						className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600"
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
