import { Download, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CardAttachmentUploadResponse } from "../api";
import { orderCardAttachments } from "../lib/cardAttachments";
import {
	MAX_ATTACHMENT_COUNT,
	prepareImageAttachment,
	type PreparedImagePair,
} from "../lib/imageAttachments";
import type { Card, CardAttachment } from "../types";
import ImageUploadPopover from "./ImageUploadPopover";

export interface CardAttachmentsProps {
	card: Card;
	workspaceId: number;
	onUpload: (
		pairs: PreparedImagePair[],
	) => Promise<CardAttachmentUploadResponse>;
	onDelete?: (attachmentId: number) => Promise<void>;
}

function attachmentCount(card: Card): number {
	return card.attachments?.length ?? 0;
}

export default function CardAttachments({
	card,
	workspaceId: _workspaceId,
	onUpload,
	onDelete,
}: CardAttachmentsProps) {
	const uploadTriggerRef = useRef<HTMLButtonElement>(null);
	const lightboxCloseRef = useRef<HTMLButtonElement>(null);
	const deleteCancelRef = useRef<HTMLButtonElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const [batchMessage, setBatchMessage] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [uploadPopoverOpen, setUploadPopoverOpen] = useState(false);
	const [previewAttachment, setPreviewAttachment] =
		useState<CardAttachment | null>(null);
	const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
	const [deletingId, setDeletingId] = useState<number | null>(null);

	const total = attachmentCount(card);
	const attachments = orderCardAttachments(card.attachments ?? []);

	useEffect(() => {
		if (
			previewAttachment &&
			!attachments.some((attachment) => attachment.id === previewAttachment.id)
		) {
			setPreviewAttachment(null);
		}
	}, [attachments, previewAttachment]);

	useEffect(() => {
		if (previewAttachment === null && pendingDeleteId === null) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (pendingDeleteId !== null) {
				setPendingDeleteId(null);
				return;
			}
			setPreviewAttachment(null);
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [pendingDeleteId, previewAttachment]);

	useEffect(() => {
		if (!previewAttachment) return;
		returnFocusRef.current = document.activeElement as HTMLElement | null;
		lightboxCloseRef.current?.focus();
		return () => {
			returnFocusRef.current?.focus();
		};
	}, [previewAttachment]);

	useEffect(() => {
		if (pendingDeleteId === null) return;
		returnFocusRef.current = document.activeElement as HTMLElement | null;
		deleteCancelRef.current?.focus();
		return () => {
			returnFocusRef.current?.focus();
		};
	}, [pendingDeleteId]);

	const processFiles = useCallback(
		async (files: File[]) => {
			if (files.length === 0) return;
			setErrorMessage(null);
			setBatchMessage(null);
			setUploading(true);
			try {
				const pairs: PreparedImagePair[] = [];
				const skippedFiles: string[] = [];
				const remainingSlots = Math.max(
					0,
					MAX_ATTACHMENT_COUNT - total,
				);
				for (const [index, file] of files.entries()) {
					if (pairs.length >= remainingSlots) {
						skippedFiles.push(
							...files.slice(index).map((skippedFile) => skippedFile.name),
						);
						break;
					}
					const result = await prepareImageAttachment(file);
					if (result.kind === "valid") {
						pairs.push(result.prepared);
					}
				}
				const skippedMessage =
					skippedFiles.length > 0
						? `Skipped files: ${skippedFiles.join(", ")}`
						: null;
				if (skippedMessage) setBatchMessage(skippedMessage);
				if (pairs.length === 0) {
					if (!skippedMessage) {
						setErrorMessage("No valid images to upload.");
					}
					return;
				}
				const response = await onUpload(pairs);
				const messages = [response.message, skippedMessage].filter(
					(message): message is string => Boolean(message),
				);
				if (messages.length > 0) setBatchMessage(messages.join(" "));
			} catch (err) {
				setErrorMessage(
					err instanceof Error ? err.message : "Couldn't upload images.",
				);
			} finally {
				setUploading(false);
			}
		},
		[onUpload, total],
	);

	const closeUploadPopover = useCallback(() => {
		setUploadPopoverOpen(false);
		uploadTriggerRef.current?.focus();
	}, []);

	const onUploadFiles = useCallback(
		(files: File[]) => {
			closeUploadPopover();
			void processFiles(files);
		},
		[closeUploadPopover, processFiles],
	);

	const confirmDelete = useCallback(async () => {
		if (pendingDeleteId === null || !onDelete) return;
		setDeletingId(pendingDeleteId);
		setErrorMessage(null);
		try {
			await onDelete(pendingDeleteId);
			setPendingDeleteId(null);
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : "Couldn't delete the image.",
			);
		} finally {
			setDeletingId(null);
		}
	}, [onDelete, pendingDeleteId]);

	return (
		<>
			<section
				aria-label="Images"
				className="border-t border-neutral-200 px-4 py-4"
			>
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">
						Images
					</h3>
					<span
						className="text-xs tabular-nums text-neutral-500"
						aria-live="polite"
					>
						{total}/{MAX_ATTACHMENT_COUNT}
					</span>
				</div>

				{attachments.length > 0 && (
					<ul
						className="mt-3 grid grid-cols-3 gap-2"
						aria-label="Attached images"
					>
						{attachments.map((attachment) => (
							<li key={attachment.id} className="group relative">
								<button
									type="button"
									onClick={() => setPreviewAttachment(attachment)}
									className="block w-full overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
									aria-label={`View attachment ${attachment.id}`}
								>
									<img
										src={attachment.thumbnailUrl}
										alt={`Attachment ${attachment.id}`}
										className="aspect-square w-full object-cover"
										onError={(event) => {
											const image = event.currentTarget;
											if (image.dataset.fallbackAttempted === "true") return;
											image.dataset.fallbackAttempted = "true";
											image.src = attachment.originalUrl;
										}}
									/>
								</button>
								{onDelete && (
									<button
										type="button"
										onClick={() => setPendingDeleteId(attachment.id)}
										disabled={deletingId === attachment.id}
										className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-neutral-600 shadow-sm hover:bg-white hover:text-error-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50 motion-reduce:transition-none"
										aria-label={`Delete attachment ${attachment.id}`}
									>
										<Trash2 size={14} aria-hidden />
									</button>
								)}
							</li>
						))}
					</ul>
				)}

				<div className="mt-3 flex flex-wrap items-center gap-2">
					<button
						ref={uploadTriggerRef}
						type="button"
						onClick={() => setUploadPopoverOpen(true)}
						disabled={uploading || total >= MAX_ATTACHMENT_COUNT}
						className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{uploading ? "Uploading…" : "Add images"}
					</button>
				</div>

				{batchMessage && (
					<p
						className="mt-2 text-sm text-neutral-700"
						role="status"
						aria-live="polite"
					>
						{batchMessage}
					</p>
				)}
				{errorMessage && (
					<p className="mt-2 text-sm text-error-500" role="alert">
						{errorMessage}
					</p>
				)}

				{total === 0 && !uploading && (
					<p className="mt-3 text-sm text-neutral-500">
						No images attached yet.
					</p>
				)}
			</section>

			<ImageUploadPopover
				open={uploadPopoverOpen}
				anchorRef={uploadTriggerRef}
				onFilesSelected={onUploadFiles}
				onClose={closeUploadPopover}
			/>

			{previewAttachment && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Image preview"
					className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/80 p-4 motion-reduce:animate-none"
					onClick={() => setPreviewAttachment(null)}
				>
					<div
						className="relative max-h-[90vh] max-w-4xl rounded-lg bg-white p-3 shadow-lg"
						onClick={(event) => event.stopPropagation()}
					>
						<button
							ref={lightboxCloseRef}
							type="button"
							onClick={() => setPreviewAttachment(null)}
							className="absolute right-2 top-2 rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							aria-label="Close image preview"
						>
							<X size={18} aria-hidden />
						</button>
						<img
							src={previewAttachment.originalUrl}
							alt={`Attachment ${previewAttachment.id}`}
							className="max-h-[75vh] w-full object-contain"
						/>
						<div className="mt-3 flex justify-end">
							<a
								href={previewAttachment.downloadUrl}
								className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
								aria-label="Download original"
							>
								<Download size={14} aria-hidden />
								Download original
							</a>
						</div>
					</div>
				</div>
			)}

			{pendingDeleteId !== null && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Confirm attachment delete"
					className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4 motion-reduce:animate-none"
				>
					<div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-4 shadow-lg">
						<h4 className="text-sm font-medium text-neutral-900">
							Delete this image?
						</h4>
						<p className="mt-1 text-sm text-neutral-600">
							This cannot be undone.
						</p>
						<div className="mt-4 flex justify-end gap-2">
							<button
								ref={deleteCancelRef}
								type="button"
								onClick={() => setPendingDeleteId(null)}
								className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void confirmDelete()}
								disabled={deletingId !== null}
								className="rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50"
							>
								Delete
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
