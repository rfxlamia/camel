import { Check } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	POPOVER_WIDTH,
	computePopoverPosition,
} from "../../lib/popoverPlacement";

export interface PickerOption {
	id: string;
	label: string;
	hint?: string;
	icon?: ReactNode;
	selected: boolean;
}

interface Props {
	/** Chip content when nothing is chosen yet. */
	placeholder: string;
	/** Chip content once a value is chosen. */
	value?: string;
	icon: ReactNode;
	searchPlaceholder: string;
	options: PickerOption[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (id: string) => void;
	/** Keeps the popover open after a choice, for multi-value properties. */
	multiple?: boolean;
	/**
	 * "chip" is the labelled pill used in forms; "inline" is an icon-only
	 * trigger for dense surfaces such as a list row.
	 */
	variant?: "chip" | "inline";
	/**
	 * Accessible name for the trigger. Required for the inline variant, which
	 * has no visible label; optional on chips whose value alone is ambiguous.
	 */
	triggerLabel?: string;
	/** Anchors the popover to the trigger's right edge instead of its left. */
	align?: "left" | "right";
	/** Compact matches label chips in the detail rail. */
	size?: "default" | "compact";
}

export function TrackerPropertyPicker({
	placeholder,
	value,
	icon,
	searchPlaceholder,
	options,
	open,
	onOpenChange,
	onSelect,
	multiple = false,
	variant = "chip",
	triggerLabel,
	align = "left",
	size = "default",
}: Props) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [popoverCoords, setPopoverCoords] = useState<{
		top: number;
		left: number;
	} | null>(null);
	const [popoverPositioned, setPopoverPositioned] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const listboxId = useId();

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return options;
		return options.filter(
			(o) =>
				o.label.toLowerCase().includes(q) ||
				(o.hint?.toLowerCase().includes(q) ?? false),
		);
	}, [options, query]);

	useEffect(() => {
		if (!open) setQuery("");
		setActive(0);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (rootRef.current?.contains(target)) return;
			if (popoverRef.current?.contains(target)) return;
			onOpenChange(false);
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open, onOpenChange]);

	useLayoutEffect(() => {
		if (!open || variant !== "inline") {
			setPopoverCoords(null);
			setPopoverPositioned(false);
			return;
		}

		const updatePosition = () => {
			const trigger = triggerRef.current;
			const popover = popoverRef.current;
			if (!trigger) return;
			const triggerRect = trigger.getBoundingClientRect();
			const popoverHeight = popover?.offsetHeight ?? 280;
			const popoverWidth = popover?.offsetWidth ?? POPOVER_WIDTH;
			const position = computePopoverPosition({
				trigger: triggerRect,
				popoverWidth,
				popoverHeight,
				align,
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
	}, [open, variant, align]);

	const close = () => {
		onOpenChange(false);
		triggerRef.current?.focus();
	};

	const choose = (id: string) => {
		onSelect(id);
		if (!multiple) close();
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			// The picker only closes itself and restores focus. Owners with their
			// own Escape handling (a dialog, say) must check whether a picker is
			// open before acting — this does not stop the event reaching them.
			close();
			return;
		}
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (filtered.length === 0) return;
			const step = e.key === "ArrowDown" ? 1 : -1;
			setActive((i) => (i + step + filtered.length) % filtered.length);
			return;
		}
		if (e.key === "Enter") {
			// Keeps Cmd+Enter from submitting the form behind an open picker.
			e.preventDefault();
			e.stopPropagation();
			const option = filtered[active];
			if (option) choose(option.id);
			return;
		}
		if (/^[1-9]$/.test(e.key) && query === "") {
			const option = filtered[Number(e.key) - 1];
			if (option) {
				e.preventDefault();
				choose(option.id);
			}
		}
	};

	const chosen = value !== undefined;
	const inline = variant === "inline";
	const compact = size === "compact";
	const popoverPanelClassName =
		"w-60 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_8px_24px_rgba(23,42,62,0.12)]";

	const popoverPanel = (
		<>
			<input
				autoFocus
				type="text"
				value={query}
				role="combobox"
				aria-label={searchPlaceholder}
				aria-expanded
				aria-controls={listboxId}
				aria-autocomplete="list"
				aria-activedescendant={
					filtered[active]
						? `${listboxId}-${filtered[active].id}`
						: undefined
				}
				placeholder={searchPlaceholder}
				onChange={(e) => {
					setQuery(e.target.value);
					setActive(0);
				}}
				onKeyDown={onKeyDown}
				className="w-full border-neutral-200 border-b px-3 py-2.5 text-neutral-900 text-sm placeholder:text-neutral-500 focus:outline-none"
			/>
			<ul
				id={listboxId}
				role="listbox"
				aria-label={placeholder}
				aria-multiselectable={multiple || undefined}
				className="max-h-64 overflow-y-auto overscroll-contain p-1"
			>
				{filtered.length === 0 ? (
					<li className="px-2 py-2 text-neutral-500 text-sm">No matches</li>
				) : (
					filtered.map((option, i) => (
						<li key={option.id} role="presentation">
							<button
								type="button"
								id={`${listboxId}-${option.id}`}
								role="option"
								aria-selected={option.selected}
								onMouseEnter={() => setActive(i)}
								onClick={() => choose(option.id)}
								className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-neutral-900 text-sm ${
									i === active ? "bg-neutral-100" : ""
								}`}
							>
								{option.icon}
								<span className="min-w-0 flex-1 truncate">
									{option.label}
								</span>
								{option.hint && (
									<span className="shrink-0 text-neutral-500 text-xs">
										{option.hint}
									</span>
								)}
								{option.selected && (
									<Check
										size={14}
										className="shrink-0 text-primary-600"
										aria-hidden
									/>
								)}
								{i < 9 && (
									<span
										aria-hidden
										className="w-3 shrink-0 text-right text-neutral-400 text-xs tabular-nums"
									>
										{i + 1}
									</span>
								)}
							</button>
						</li>
					))
				)}
			</ul>
		</>
	);

	return (
		<div ref={rootRef} className="relative">
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={triggerLabel}
				title={inline ? placeholder : undefined}
				onClick={() => onOpenChange(!open)}
				className={
					inline
						? `flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 ${
								open ? "bg-neutral-200" : ""
							}`
						: compact
							? `inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-neutral-600 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
									chosen
										? "border-neutral-200 bg-white hover:bg-neutral-50"
										: "border-neutral-200 bg-white hover:bg-neutral-50"
								} ${open ? "border-primary-600 shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.12)]" : ""}`
							: `inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
									chosen
										? "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50"
										: "border-neutral-200 bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
								} ${open ? "border-primary-600 shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.12)]" : ""}`
				}
			>
				{icon}
				{!inline && (
					<span className="max-w-40 truncate">{value ?? placeholder}</span>
				)}
			</button>

			{open &&
				(inline
					? createPortal(
							<div
								ref={popoverRef}
								style={{
									position: "fixed",
									top: popoverCoords?.top ?? 0,
									left: popoverCoords?.left ?? 0,
									zIndex: 50,
									visibility: popoverPositioned ? "visible" : "hidden",
								}}
								className={popoverPanelClassName}
							>
								{popoverPanel}
							</div>,
							document.body,
						)
					: (
							<div
								className={`absolute top-full z-50 mt-1.5 ${popoverPanelClassName} ${
									align === "right" ? "right-0" : "left-0"
								}`}
							>
								{popoverPanel}
							</div>
						))}
		</div>
	);
}
