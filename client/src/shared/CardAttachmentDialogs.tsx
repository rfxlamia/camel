import { Download, X } from "lucide-react";
import type { RefObject } from "react";
import type { CardAttachment } from "../types";

export function CardAttachmentPreviewDialog({
	attachment,
	closeRef,
	onClose,
}: {
	attachment: CardAttachment;
	closeRef: RefObject<HTMLButtonElement>;
	onClose: () => void;
}) {
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Image preview"
			className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/80 p-4 motion-reduce:animate-none"
			onClick={onClose}
		>
			<div
				className="relative max-h-[90vh] max-w-4xl rounded-lg bg-white p-3 shadow-lg"
				onClick={(event) => event.stopPropagation()}
			>
				<button
					ref={closeRef}
					type="button"
					onClick={onClose}
					className="absolute top-2 right-2 rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					aria-label="Close image preview"
				>
					<X size={18} aria-hidden />
				</button>
				<img
					src={attachment.originalUrl}
					alt={`Attachment ${attachment.id}`}
					className="max-h-[75vh] w-full object-contain"
				/>
				<div className="mt-3 flex justify-end">
					<a
						href={attachment.downloadUrl}
						className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 font-medium text-primary-700 text-sm hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						aria-label="Download original"
					>
						<Download size={14} aria-hidden />
						Download original
					</a>
				</div>
			</div>
		</div>
	);
}

export function CardAttachmentDeleteDialog({
	cancelRef,
	deleting,
	onCancel,
	onConfirm,
}: {
	cancelRef: RefObject<HTMLButtonElement>;
	deleting: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Confirm attachment delete"
			className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4 motion-reduce:animate-none"
		>
			<div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-4 shadow-lg">
				<h4 className="font-medium text-neutral-900 text-sm">
					Delete this image?
				</h4>
				<p className="mt-1 text-neutral-600 text-sm">This cannot be undone.</p>
				<div className="mt-4 flex justify-end gap-2">
					<button
						ref={cancelRef}
						type="button"
						onClick={onCancel}
						className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 font-medium text-primary-700 text-sm hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={deleting}
						className="rounded-md bg-error-500 px-3 py-1.5 font-medium text-sm text-white hover:bg-error-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50"
					>
						Delete
					</button>
				</div>
			</div>
		</div>
	);
}
