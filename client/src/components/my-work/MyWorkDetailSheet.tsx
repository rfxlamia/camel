import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useBoard } from "../../context/BoardContext";
import {
	type MyWorkDetailSelection,
	useMyWorkDetailState,
} from "../../lib/myWorkNavigation";
import { useMyWorkSourceNavigation } from "../../lib/myWorkSourceNavigation";
import { MyWorkDetailSheetFrame } from "./MyWorkDetailSheetFrame";

export interface MyWorkDetailSheetProps {
	selection: MyWorkDetailSelection | null;
	onClose: () => void;
	onRefresh?: () => void | Promise<void>;
}

const SHEET_EXIT_DURATION_MS = 200;
const DIALOG_FOCUSABLE_SELECTOR =
	"button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function getDialogFocusableElements(dialog: HTMLElement): HTMLElement[] {
	return Array.from(
		dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
	).filter((element) => !element.hasAttribute("disabled"));
}

function captureDetailTrigger(
	triggerRef: { current: HTMLElement | null },
	dialogRef: RefObject<HTMLElement>,
) {
	const activeElement = document.activeElement;
	if (
		activeElement instanceof HTMLElement &&
		!dialogRef.current?.contains(activeElement)
	) {
		triggerRef.current = activeElement;
	}
}

function restoreDetailTrigger(triggerRef: { current: HTMLElement | null }) {
	const trigger = triggerRef.current;
	triggerRef.current = null;
	if (trigger?.isConnected) trigger.focus();
}

function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function trapDetailSheetFocus(
	event: KeyboardEvent,
	dialog: HTMLElement | null,
	onClose: () => void,
	higherPriorityOverlayOpen: boolean,
) {
	if (higherPriorityOverlayOpen || !dialog) return;
	if (!(event.target instanceof Node) || !dialog.contains(event.target)) return;
	if (event.key === "Escape") {
		event.preventDefault();
		onClose();
		return;
	}
	if (event.key !== "Tab") return;
	const focusable = getDialogFocusableElements(dialog);
	if (focusable.length === 0) {
		event.preventDefault();
		dialog.focus();
		return;
	}
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	const activeElement = document.activeElement;
	if (event.shiftKey && activeElement === first) {
		event.preventDefault();
		last?.focus();
		return;
	}
	if (!event.shiftKey && activeElement === last) {
		event.preventDefault();
		first?.focus();
	}
}

function useDetailSheetFocusLifecycle(
	selection: MyWorkDetailSelection | null,
	closeButtonRef: RefObject<HTMLButtonElement>,
	dialogRef: RefObject<HTMLElement>,
	triggerRef: { current: HTMLElement | null },
) {
	useEffect(() => {
		if (!selection) return;
		captureDetailTrigger(triggerRef, dialogRef);
		closeButtonRef.current?.focus();
		return () => restoreDetailTrigger(triggerRef);
	}, [closeButtonRef, dialogRef, selection, triggerRef]);
}

function useDetailSheetKeyboard(
	selection: MyWorkDetailSelection | null,
	onClose: () => void,
	closeButtonRef: RefObject<HTMLButtonElement>,
	dialogRef: RefObject<HTMLElement>,
	higherPriorityOverlayOpen: boolean,
) {
	const triggerRef = useRef<HTMLElement | null>(null);
	const onCloseRef = useRef(onClose);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);
	useDetailSheetFocusLifecycle(
		selection,
		closeButtonRef,
		dialogRef,
		triggerRef,
	);
	useEffect(() => {
		if (!selection) return;
		const onKeyDown = (event: KeyboardEvent) =>
			trapDetailSheetFocus(
				event,
				dialogRef.current,
				onCloseRef.current,
				higherPriorityOverlayOpen,
			);
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [dialogRef, higherPriorityOverlayOpen, selection]);
}

export default function MyWorkDetailSheet({
	selection,
	onClose,
	onRefresh,
}: MyWorkDetailSheetProps) {
	const { state, retry, workspaceId, source, key } =
		useMyWorkDetailState(selection);
	const { switchConfirm } = useBoard();
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	const closeTimerRef = useRef<number | null>(null);
	const closeStartedRef = useRef(false);
	const [closing, setClosing] = useState(false);
	const selectionIdentity = selection
		? `${selection.workspaceId}:${selection.source}:${selection.key}`
		: "";
	const selectionIdentityRef = useRef(selectionIdentity);
	const clearCloseTimer = useCallback(() => {
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}, []);
	useEffect(() => {
		if (selectionIdentityRef.current === selectionIdentity) return;
		selectionIdentityRef.current = selectionIdentity;
		closeStartedRef.current = false;
		setClosing(false);
		clearCloseTimer();
	}, [clearCloseTimer, selectionIdentity]);
	useEffect(() => clearCloseTimer, [clearCloseTimer]);
	const requestClose = useCallback(() => {
		if (closeStartedRef.current) return;
		closeStartedRef.current = true;
		if (prefersReducedMotion()) {
			onClose();
			return;
		}
		setClosing(true);
		closeTimerRef.current = window.setTimeout(() => {
			closeTimerRef.current = null;
			onClose();
		}, SHEET_EXIT_DURATION_MS);
	}, [onClose]);
	useDetailSheetKeyboard(
		selection,
		requestClose,
		closeButtonRef,
		dialogRef,
		switchConfirm.open,
	);
	const { handleSourceNavigation, pending } = useMyWorkSourceNavigation(
		state.status === "ready" ? state.item : null,
	);
	if (!selection || workspaceId === null || source === null || key === null) {
		return null;
	}

	const item = state.status === "ready" ? state.item : null;
	const retryDetail = () => {
		void retry();
	};
	return (
		<MyWorkDetailSheetFrame
			state={state}
			item={item}
			keyValue={key}
			closeButtonRef={closeButtonRef}
			dialogRef={dialogRef}
			onClose={requestClose}
			onRetry={retryDetail}
			onRefresh={onRefresh}
			onNavigate={handleSourceNavigation}
			pending={pending}
			closing={closing}
		/>
	);
}
