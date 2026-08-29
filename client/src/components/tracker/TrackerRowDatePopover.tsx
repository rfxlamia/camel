import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	POPOVER_WIDTH,
	computePopoverPosition,
} from "../../lib/popoverPlacement";
import TrackerDateFields from "./TrackerDateFields";

export interface TrackerRowDatePopoverProps {
	startDate: string | null;
	endDate: string | null;
	triggerLabel: string;
	idPrefix: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCommit: (dates: {
		startDate: string | null;
		endDate: string | null;
	}) => void;
}

function draftMatchesProp(prop: string | null, draft: string): boolean {
	return (prop ?? "") === draft;
}

function isOrderedRange(draftStart: string, draftEnd: string): boolean {
	if (!draftStart || !draftEnd) return true;
	return draftStart <= draftEnd;
}

function draftChanged(
	draftStart: string,
	draftEnd: string,
	startDate: string | null,
	endDate: string | null,
): boolean {
	return (
		!draftMatchesProp(startDate, draftStart) ||
		!draftMatchesProp(endDate, draftEnd)
	);
}

export function TrackerRowDatePopover({
	startDate,
	endDate,
	triggerLabel,
	idPrefix,
	open,
	onOpenChange,
	onCommit,
}: TrackerRowDatePopoverProps) {
	const [draftStart, setDraftStart] = useState(startDate ?? "");
	const [draftEnd, setDraftEnd] = useState(endDate ?? "");
	const [validationError, setValidationError] = useState<string | null>(null);
	const [popoverCoords, setPopoverCoords] = useState<{
		top: number;
		left: number;
	} | null>(null);
	const [popoverPositioned, setPopoverPositioned] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const prevOpenRef = useRef(open);
	const closeHandledRef = useRef(false);

	useEffect(() => {
		if (open) {
			setDraftStart(startDate ?? "");
			setDraftEnd(endDate ?? "");
			setValidationError(null);
			closeHandledRef.current = false;
		}
	}, [open, startDate, endDate]);

	const close = useCallback(
		({ notifyParent = true }: { notifyParent?: boolean } = {}) => {
			if (closeHandledRef.current) return true;
			if (!isOrderedRange(draftStart, draftEnd)) {
				setValidationError("End date must be on or after start date");
				return false;
			}
			setValidationError(null);
			if (draftChanged(draftStart, draftEnd, startDate, endDate)) {
				onCommit({
					startDate: draftStart || null,
					endDate: draftEnd || null,
				});
			}
			closeHandledRef.current = true;
			if (notifyParent) onOpenChange(false);
			return true;
		},
		[draftStart, draftEnd, startDate, endDate, onCommit, onOpenChange],
	);

	useEffect(() => {
		if (prevOpenRef.current && !open) {
			close({ notifyParent: false });
		}
		prevOpenRef.current = open;
	}, [open, close]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (rootRef.current?.contains(target)) return;
			if (popoverRef.current?.contains(target)) return;
			close();
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open, close]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, close]);

	useLayoutEffect(() => {
		if (!open) {
			setPopoverCoords(null);
			setPopoverPositioned(false);
			return;
		}

		const updatePosition = () => {
			const trigger = triggerRef.current;
			const popover = popoverRef.current;
			if (!trigger) return;
			const triggerRect = trigger.getBoundingClientRect();
			const popoverHeight = popover?.offsetHeight ?? 200;
			const popoverWidth = popover?.offsetWidth ?? POPOVER_WIDTH;
			const position = computePopoverPosition({
				trigger: triggerRect,
				popoverWidth,
				popoverHeight,
				align: "left",
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
			});
			setPopoverCoords({ top: position.top, left: position.left });
			setPopoverPositioned(true);
		};

		updatePosition();
		const raf = requestAnimationFrame(updatePosition);
		window.addEventListener("resize", updatePosition);
		document.addEventListener("scroll", updatePosition, true);
		const popover = popoverRef.current;
		const resizeObserver =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(updatePosition)
				: null;
		if (popover && resizeObserver) resizeObserver.observe(popover);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", updatePosition);
			document.removeEventListener("scroll", updatePosition, true);
			resizeObserver?.disconnect();
		};
	}, [open]);

	return (
		<div ref={rootRef} className="relative">
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-label={`Date: ${triggerLabel}`}
				data-testid={`row-date-${idPrefix}`}
				onClick={() => {
					if (open) close();
					else onOpenChange(true);
				}}
			>
				{triggerLabel}
			</button>

			{open &&
				createPortal(
					<div
						ref={popoverRef}
						data-tracker-row-date-popover={idPrefix}
						style={{
							position: "fixed",
							top: popoverCoords?.top ?? 0,
							left: popoverCoords?.left ?? 0,
							zIndex: 50,
							visibility: popoverPositioned ? "visible" : "hidden",
						}}
						className="w-60 rounded-lg border border-neutral-200 bg-white p-3 shadow-[0_8px_24px_rgba(23,42,62,0.12)]"
					>
						<TrackerDateFields
							layout="rail"
							idPrefix={idPrefix}
							startDate={draftStart}
							endDate={draftEnd}
							onStartDateChange={setDraftStart}
							onEndDateChange={setDraftEnd}
						/>
						{validationError && (
							<p className="mt-2 text-red-600 text-xs">{validationError}</p>
						)}
						<button
							type="button"
							aria-label="Close date picker"
							className="mt-3 text-neutral-600 text-sm"
							onClick={() => close()}
						>
							Close date picker
						</button>
					</div>,
					document.body,
				)}
		</div>
	);
}
