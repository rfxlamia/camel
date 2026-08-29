import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	POPOVER_WIDTH,
	computePopoverPosition,
} from "../../lib/popoverPlacement";

export type KebabActiveField =
	| "date"
	| "project"
	| "phase"
	| "priority"
	| "assignee"
	| "label"
	| null;

export function useTrackerRowKebabMenuChrome({
	anchorRef,
	idPrefix,
	open,
	onOpenChange,
}: {
	anchorRef: RefObject<HTMLElement>;
	idPrefix: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [activeField, setActiveField] = useState<KebabActiveField>(null);
	const pendingFieldRef = useRef<KebabActiveField>(null);
	const pendingCloseRef = useRef(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const prevOpenRef = useRef(open);
	const [panelCoords, setPanelCoords] = useState<{
		top: number;
		left: number;
	} | null>(null);

	useEffect(() => {
		if (!open) setActiveField(null);
	}, [open]);

	const requestField = useCallback((next: KebabActiveField) => {
		setActiveField((current) => {
			if (current === "date" && next !== "date" && next !== null) {
				pendingFieldRef.current = next;
				return null;
			}
			return next;
		});
	}, []);

	useEffect(() => {
		if (activeField !== null) return;

		if (pendingCloseRef.current) {
			pendingCloseRef.current = false;
			onOpenChange(false);
			return;
		}

		if (pendingFieldRef.current !== null) {
			const pending = pendingFieldRef.current;
			pendingFieldRef.current = null;
			setActiveField(pending);
		}
	}, [activeField, onOpenChange]);

	const closePanel = useCallback(() => {
		if (activeField === "date") {
			pendingCloseRef.current = true;
			setActiveField(null);
			return;
		}
		onOpenChange(false);
	}, [activeField, onOpenChange]);

	useEffect(() => {
		if (prevOpenRef.current && !open) {
			anchorRef.current?.focus();
		}
		prevOpenRef.current = open;
	}, [open, anchorRef]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (panelRef.current?.contains(target)) return;
			if (anchorRef.current?.contains(target)) return;
			const datePopover = document.querySelector(
				`[data-tracker-row-date-popover="${idPrefix}"]`,
			);
			if (datePopover?.contains(target)) return;
			closePanel();
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open, closePanel, anchorRef, idPrefix]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") closePanel();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, closePanel]);

	useLayoutEffect(() => {
		if (!open) {
			setPanelCoords(null);
			return;
		}

		const updatePosition = () => {
			const anchor = anchorRef.current;
			if (!anchor) return;
			const triggerRect = anchor.getBoundingClientRect();
			const position = computePopoverPosition({
				trigger: triggerRect,
				popoverWidth: POPOVER_WIDTH,
				popoverHeight: 400,
				align: "right",
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
			});
			setPanelCoords({ top: position.top, left: position.left });
		};

		updatePosition();
		window.addEventListener("resize", updatePosition);
		document.addEventListener("scroll", updatePosition, true);
		return () => {
			window.removeEventListener("resize", updatePosition);
			document.removeEventListener("scroll", updatePosition, true);
		};
	}, [open, anchorRef]);

	return {
		panelRef,
		panelCoords,
		activeField,
		requestField,
		closePanel,
	};
}
