import { Check } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	computePopoverPosition,
	POPOVER_WIDTH,
	type ViewportRect,
} from "../../lib/popoverPlacement";

export type TaskFieldCatalogState =
	| "loading"
	| "ready"
	| "empty"
	| "failed"
	| "disabled";

export interface TaskFieldCommandOption {
	id: string;
	label: string;
	hint?: string;
	/** Leading glyph, using the same vocabulary as the tracker pickers. */
	icon?: ReactNode;
}

export interface TaskFieldCommandPopoverProps {
	stage: "field" | "value";
	listLabel: string;
	/**
	 * Visible section title. Shown in the value stage so the second layer says
	 * which field is being filled; the field stage needs no title.
	 */
	heading?: string;
	options: TaskFieldCommandOption[];
	activeIndex: number;
	selectedIds: string[];
	multiple?: boolean;
	catalogState?: TaskFieldCatalogState;
	onRetry?: () => void;
	listboxId: string;
	anchorRef: RefObject<HTMLElement>;
	/**
	 * Preferred anchor, re-measured on every reposition. Lets the caller point
	 * the popover at the caret instead of the whole field. Falls back to
	 * `anchorRef` when it returns null.
	 */
	getAnchorRect?: () => ViewportRect | null;
	popoverRef?: RefObject<HTMLDivElement>;
	/** Commit the option at this index — the pointer equivalent of Enter. */
	onSelect?: (index: number) => void;
	/**
	 * Move the active option under the pointer. Hover drives the same highlight
	 * the keyboard does, so there is only ever one active row.
	 */
	onHoverIndex?: (index: number) => void;
}

const PANEL_CLASS =
	"w-60 rounded-lg border border-neutral-200 bg-white shadow-[0_8px_24px_rgba(23,42,62,0.12)]";

export function TaskFieldCommandPopover({
	stage: _stage,
	listLabel,
	heading,
	options,
	activeIndex,
	selectedIds,
	multiple = false,
	catalogState = "ready",
	onRetry,
	listboxId,
	anchorRef,
	getAnchorRect,
	popoverRef: popoverRefProp,
	onSelect,
	onHoverIndex,
}: TaskFieldCommandPopoverProps) {
	const internalPopoverRef = useRef<HTMLDivElement>(null);
	const popoverRef = popoverRefProp ?? internalPopoverRef;
	const [coords, setCoords] = useState<{
		top: number;
		left: number;
		/** Anchor offset inside the panel, so the panel grows from the caret. */
		originX: number;
		placement: "below" | "above";
	} | null>(null);
	const [positioned, setPositioned] = useState(false);
	const optionId = (id: string) => `${listboxId}-${id}`;
	const getAnchorRectRef = useRef(getAnchorRect);
	getAnchorRectRef.current = getAnchorRect;

	useLayoutEffect(() => {
		const updatePosition = () => {
			const anchor = anchorRef.current;
			const popover = popoverRef.current;
			if (!anchor) return;
			const triggerRect =
				getAnchorRectRef.current?.() ?? anchor.getBoundingClientRect();
			const popoverHeight = popover?.offsetHeight ?? 280;
			const popoverWidth = popover?.offsetWidth ?? POPOVER_WIDTH;
			const position = computePopoverPosition({
				trigger: triggerRect,
				popoverWidth,
				popoverHeight,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
			});
			const ORIGIN_INSET = 8;
			setCoords({
				top: position.top,
				left: position.left,
				originX: Math.min(
					Math.max(triggerRect.left - position.left, ORIGIN_INSET),
					Math.max(popoverWidth - ORIGIN_INSET, ORIGIN_INSET),
				),
				placement: position.placement,
			});
			setPositioned(true);
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
	}, [anchorRef, popoverRef]);

	let panel: ReactNode;

	if (catalogState === "loading") {
		panel = (
			<div
				role="listbox"
				aria-label={listLabel}
				id={listboxId}
				className={`${PANEL_CLASS} p-2 text-neutral-500 text-sm`}
			>
				Loading…
			</div>
		);
	} else if (catalogState === "failed") {
		panel = (
			<div
				role="listbox"
				aria-label={listLabel}
				id={listboxId}
				className={`${PANEL_CLASS} p-2 text-sm`}
			>
				<p className="text-neutral-700">Could not load options.</p>
				{onRetry ? (
					<button
						type="button"
						onClick={onRetry}
						className="mt-1 text-primary-600 text-sm hover:underline"
					>
						Retry
					</button>
				) : null}
			</div>
		);
	} else if (catalogState === "disabled") {
		panel = (
			<div
				role="listbox"
				aria-label={listLabel}
				id={listboxId}
				className={`${PANEL_CLASS} p-2 text-neutral-500 text-sm`}
			>
				Unavailable
			</div>
		);
	} else if (catalogState === "empty" || options.length === 0) {
		panel = (
			<div
				role="listbox"
				aria-label={listLabel}
				id={listboxId}
				className={`${PANEL_CLASS} p-2 text-neutral-500 text-sm`}
			>
				No options
			</div>
		);
	} else {
		panel = (
			<div className={PANEL_CLASS}>
				{heading ? (
					<p className="px-3 pt-2 pb-1 font-medium text-[10px] text-neutral-500 uppercase tracking-wide">
						{heading}
					</p>
				) : null}
				<ul
					id={listboxId}
					role="listbox"
					aria-label={listLabel}
					aria-multiselectable={multiple || undefined}
					className="max-h-64 overflow-y-auto p-1"
				>
					{options.map((option, index) => {
						const selected = selectedIds.includes(option.id);
						return (
							<li key={option.id} role="presentation">
								<div
									id={optionId(option.id)}
									role="option"
									aria-selected={selected}
									// Keyboard handling stays on the combobox that owns
									// aria-activedescendant; these are pointer affordances.
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => onSelect?.(index)}
									onMouseEnter={() => onHoverIndex?.(index)}
									className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-neutral-900 text-sm ${
										index === activeIndex ? "bg-primary-100" : ""
									}`}
								>
									{option.icon ? (
										<span className="flex w-4 shrink-0 justify-center">
											{option.icon}
										</span>
									) : null}
									<span className="min-w-0 flex-1 truncate">
										{option.label}
									</span>
									{option.hint ? (
										<span className="shrink-0 text-neutral-500 text-xs">
											{option.hint}
										</span>
									) : null}
									{selected ? (
										<Check
											size={13}
											className="shrink-0 text-primary-600"
											aria-hidden
										/>
									) : null}
								</div>
							</li>
						);
					})}
				</ul>
			</div>
		);
	}

	return createPortal(
		<div
			ref={popoverRef}
			// The materialize animation is attached only once `positioned` flips,
			// so it never plays while the panel is still hidden for measurement.
			className={
				positioned ? "animate-popover-in motion-reduce:animate-none" : undefined
			}
			style={{
				position: "fixed",
				top: coords?.top ?? 0,
				left: coords?.left ?? 0,
				zIndex: 50,
				visibility: positioned ? "visible" : "hidden",
				transformOrigin: coords
					? `${coords.originX}px ${coords.placement === "below" ? "top" : "bottom"}`
					: undefined,
				willChange: positioned ? "transform, opacity" : undefined,
			}}
		>
			{panel}
		</div>,
		document.body,
	);
}

export function isPickerUnavailable(
	catalogState: TaskFieldCatalogState | undefined,
	options: TaskFieldCommandOption[],
): boolean {
	if (!catalogState || catalogState === "ready") {
		return options.length === 0;
	}
	return (
		catalogState === "loading" ||
		catalogState === "failed" ||
		catalogState === "disabled" ||
		catalogState === "empty"
	);
}
