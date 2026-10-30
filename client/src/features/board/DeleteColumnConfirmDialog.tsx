import { useEffect, useState } from "react";

export interface DeleteColumnConfirmDialogProps {
	columnTitle: string;
	/**
	 * Performs the deletion. Must reject when the deletion itself fails so the
	 * dialog can stay open for a retry; post-deletion refresh failures are
	 * handled (and toasted) by the parent and must not keep the dialog open.
	 */
	onConfirm: () => Promise<void>;
	onClose: () => void;
}

export default function DeleteColumnConfirmDialog({
	columnTitle,
	onConfirm,
	onClose,
}: DeleteColumnConfirmDialogProps) {
	const [deleting, setDeleting] = useState(false);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	async function handleDelete() {
		setDeleting(true);
		try {
			await onConfirm();
		} catch {
			// Deletion failed (the parent already toasted). Keep the dialog open
			// so the user can retry.
			setDeleting(false);
			return;
		}
		// Deletion succeeded (refresh failures were surfaced by the parent).
		onClose();
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-delete-column-title"
			onClick={onClose}
		>
			<div
				className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<p
					id="confirm-delete-column-title"
					className="font-medium text-neutral-800"
				>
					Delete {columnTitle}?
				</p>
				<p className="mt-1 text-sm text-neutral-500">
					Cards in this column move to your first remaining column
					automatically, and attachments on those cards are permanently deleted.
					This cannot be undone.
				</p>
				<div className="mt-4 flex gap-2">
					<button
						type="button"
						onClick={onClose}
						className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void handleDelete()}
						disabled={deleting}
						aria-label="Confirm delete column"
						className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
					>
						{deleting ? "Deleting..." : "Delete"}
					</button>
				</div>
			</div>
		</div>
	);
}
