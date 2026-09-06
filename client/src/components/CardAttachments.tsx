import {
	useCallback,
	useId,
	useRef,
	useState,
	type ClipboardEvent,
	type ChangeEvent,
} from "react";
import type { CardAttachmentUploadResponse } from "../api";
import {
	MAX_ATTACHMENT_COUNT,
	prepareImageAttachment,
	type PreparedImagePair,
} from "../lib/imageAttachments";
import type { Card } from "../types";

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
}: CardAttachmentsProps) {
	const inputId = useId();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [batchMessage, setBatchMessage] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);

	const total = attachmentCount(card);

	const processFiles = useCallback(
		async (files: File[]) => {
			if (files.length === 0) return;
			setErrorMessage(null);
			setBatchMessage(null);
			setUploading(true);
			try {
				const pairs: PreparedImagePair[] = [];
				for (const file of files) {
					const result = await prepareImageAttachment(file);
					if (result.kind === "valid") {
						pairs.push(result.prepared);
					}
				}
				if (pairs.length === 0) {
					setErrorMessage("No valid images to upload.");
					return;
				}
				const response = await onUpload(pairs);
				if (response.message) {
					setBatchMessage(response.message);
				}
			} catch (err) {
				setErrorMessage(
					err instanceof Error ? err.message : "Couldn't upload images.",
				);
			} finally {
				setUploading(false);
			}
		},
		[onUpload],
	);

	const onFileInputChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const selected = event.target.files
				? Array.from(event.target.files)
				: [];
			event.target.value = "";
			void processFiles(selected);
		},
		[processFiles],
	);

	const onPaste = useCallback(
		(event: ClipboardEvent<HTMLElement>) => {
			const items = event.clipboardData?.items;
			if (!items) return;
			const imageFiles: File[] = [];
			for (const item of items) {
				if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
				const file = item.getAsFile();
				if (file) imageFiles.push(file);
			}
			if (imageFiles.length === 0) return;
			event.preventDefault();
			void processFiles(imageFiles);
		},
		[processFiles],
	);

	return (
		<section
			aria-label="Images"
			tabIndex={0}
			onPaste={onPaste}
			className="border-t border-neutral-200 px-4 py-4 outline-none focus-visible:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)]"
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

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<input
					ref={fileInputRef}
					id={inputId}
					type="file"
					accept="image/png,image/jpeg"
					multiple
					className="sr-only"
					onChange={onFileInputChange}
					disabled={uploading}
					aria-label="Add images"
				/>
				<button
					type="button"
					onClick={() => fileInputRef.current?.click()}
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
				<p className="mt-3 text-sm text-neutral-500">No images attached yet.</p>
			)}
		</section>
	);
}
