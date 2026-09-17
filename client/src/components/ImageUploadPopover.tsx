import { Image, X } from "lucide-react";
import {
	type ChangeEvent,
	type ClipboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	computePopoverPosition,
	type ViewportRect,
} from "../shared/popoverPlacement";
import { MAX_ATTACHMENT_BYTES } from "../lib/imageAttachments";

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 250;

export interface ImageUploadPopoverProps {
	open: boolean;
	anchorRef: RefObject<HTMLElement>;
	accept?: string;
	multiple?: boolean;
	onFilesSelected: (files: File[]) => void;
	onClose: () => void;
}

function imageDescription(accept: string): string {
	const acceptsPng = accept.includes("image/png");
	const acceptsJpeg = accept.includes("image/jpeg");
	if (acceptsPng && acceptsJpeg) return "PNG or JPEG";
	if (acceptsPng) return "PNG";
	if (acceptsJpeg) return "JPEG";
	return "Images";
}

export default function ImageUploadPopover({
	open,
	anchorRef,
	accept = "image/png,image/jpeg",
	multiple = true,
	onFilesSelected,
	onClose,
}: ImageUploadPopoverProps) {
	const popoverRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const selectButtonRef = useRef<HTMLButtonElement>(null);
	const [position, setPosition] = useState<{
		top: number;
		left: number;
		originX: number;
		placement: "above" | "below";
	} | null>(null);

	useLayoutEffect(() => {
		if (!open) return;

		const updatePosition = () => {
			const anchor = anchorRef.current;
			if (!anchor) return;
			const trigger: ViewportRect = anchor.getBoundingClientRect();
			const popover = popoverRef.current;
			const popoverWidth = popover?.offsetWidth || POPOVER_WIDTH;
			const popoverHeight = popover?.offsetHeight || POPOVER_HEIGHT;
			const next = computePopoverPosition({
				trigger,
				popoverWidth,
				popoverHeight,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
			});
			const top = Math.min(
				Math.max(next.top, 8),
				Math.max(8, window.innerHeight - popoverHeight - 8),
			);
			setPosition({
				top,
				left: next.left,
				originX: Math.min(
					Math.max(trigger.left - next.left, 8),
					Math.max(popoverWidth - 8, 8),
				),
				placement: next.placement,
			});
		};

		setPosition(null);
		updatePosition();
		const raf = requestAnimationFrame(updatePosition);
		window.addEventListener("resize", updatePosition);
		document.addEventListener("scroll", updatePosition, true);
		const resizeObserver =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(updatePosition)
				: null;
		if (popoverRef.current && resizeObserver) {
			resizeObserver.observe(popoverRef.current);
		}
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", updatePosition);
			document.removeEventListener("scroll", updatePosition, true);
			resizeObserver?.disconnect();
		};
	}, [anchorRef, open]);

	useEffect(() => {
		if (!open) return;
		const frame = requestAnimationFrame(() => selectButtonRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const input = fileInputRef.current;
		if (!input) return;
		const handleCancel = () => onClose();
		input.addEventListener("cancel", handleCancel);
		return () => input.removeEventListener("cancel", handleCancel);
	}, [onClose, open]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (popoverRef.current?.contains(target)) return;
			if (anchorRef.current?.contains(target)) return;
			onClose();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		};
		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [anchorRef, onClose, open]);

	const handlePaste = useCallback(
		(event: ClipboardEvent<HTMLDivElement>) => {
			const items = event.clipboardData?.items;
			if (!items) return;
			const imageFiles = Array.from(items)
				.filter(
					(item) => item.kind === "file" && item.type.startsWith("image/"),
				)
				.map((item) => item.getAsFile())
				.filter((file): file is File => file !== null);
			if (imageFiles.length === 0) return;
			event.preventDefault();
			onFilesSelected(imageFiles);
		},
		[onFilesSelected],
	);

	const handleInputChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(event.currentTarget.files ?? []);
			event.currentTarget.value = "";
			if (files.length > 0) onFilesSelected(files);
		},
		[onFilesSelected],
	);

	if (!open) return null;

	const panel = (
		<div
			ref={popoverRef}
			role="dialog"
			aria-label="Upload images"
			className="max-h-[calc(100vh-1rem)] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3 shadow-[0_8px_24px_rgba(23,42,62,0.14)] animate-popover-in motion-reduce:animate-none"
			style={{
				position: "fixed",
				top: position?.top ?? 0,
				left: position?.left ?? 0,
				zIndex: 50,
				visibility: position ? "visible" : "hidden",
				transformOrigin: position
					? `${position.originX}px ${position.placement === "below" ? "top" : "bottom"}`
					: undefined,
			}}
			onPaste={handlePaste}
		>
			<div className="flex items-start justify-between gap-3 px-1 pb-2">
				<div>
					<h2 className="text-base font-semibold text-neutral-900">Upload images</h2>
					<p className="mt-0.5 text-xs text-neutral-600">
						{imageDescription(accept)} up to {MAX_ATTACHMENT_BYTES / 1024 / 1024}MB
					</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					aria-label="Close upload dialog"
				>
					<X size={16} aria-hidden />
				</button>
			</div>
			<div className="rounded-md border border-dashed border-neutral-300 bg-neutral-100/70 px-4 py-5 text-center">
				<div className="mx-auto flex w-fit rounded-lg bg-primary-100 p-3 text-primary-700">
					<Image size={28} strokeWidth={1.8} aria-hidden />
				</div>
				<p className="mt-3 text-sm text-neutral-700">Choose from your computer</p>
				<input
					ref={fileInputRef}
					type="file"
					accept={accept}
					multiple={multiple}
					onChange={handleInputChange}
					className="sr-only"
					aria-label="Select images"
					tabIndex={-1}
					aria-hidden="true"
				/>
				<button
					ref={selectButtonRef}
					type="button"
					onClick={() => fileInputRef.current?.click()}
					className="mt-3 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Select images
				</button>
				<p className="mt-3 text-xs text-neutral-600">or paste your image now</p>
			</div>
		</div>
	);

	return createPortal(panel, document.body);
}
