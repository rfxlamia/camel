import { X } from "lucide-react";
import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";
import { useBoard } from "../../context/BoardContext";
import {
	type MyWorkDetailSelection,
	useMyWorkDetailState,
} from "../../lib/myWorkNavigation";
import { useMyWorkSourceNavigation } from "../../lib/myWorkSourceNavigation";
import {
	getMyWorkMutationSnapshot,
	myWorkMutationIdentity,
	subscribeToMyWorkMutations,
} from "../../lib/workItemMutations";
import {
	DetailSheetBody,
	type DetailSheetBodyProps,
} from "./MyWorkDetailContent";
import MyWorkDoneAction from "./MyWorkDoneAction";
export interface MyWorkDetailSheetProps {
	selection: MyWorkDetailSelection | null;
	onClose: () => void;
	onRefresh?: () => void | Promise<void>;
}
const SHEET_BACKDROP =
	"fixed inset-0 z-40 flex items-end bg-neutral-900/35 overscroll-none md:justify-end";
const SHEET_PANEL =
	"flex max-h-[92vh] w-full flex-col rounded-t-lg border-neutral-200 border-t bg-white shadow-xl animate-panel-in motion-reduce:animate-none md:h-full md:max-h-none md:w-104 md:rounded-none md:border-t-0 md:border-l";
const SHEET_HEADER =
	"flex shrink-0 items-center justify-between gap-3 border-neutral-200 border-b px-4 py-3 md:px-5";
const CLOSE_BUTTON =
	"shrink-0 rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none";
const DETAIL_LABEL =
	"font-medium text-[11px] text-primary-700 uppercase tracking-[0.1em]";
const DETAIL_KEY =
	"mt-0.5 truncate font-mono font-medium text-neutral-900 text-sm tabular-nums";

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
interface DetailSheetHeaderProps {
	keyValue: string;
	sourceLabel: string;
	closeButtonRef: RefObject<HTMLButtonElement>;
	onClose: () => void;
}

function DetailSheetHeader({
	keyValue,
	sourceLabel,
	closeButtonRef,
	onClose,
}: DetailSheetHeaderProps) {
	return (
		<header className={SHEET_HEADER}>
			<div className="min-w-0">
				<p className={DETAIL_LABEL}>My Work · {sourceLabel}</p>
				<h2 id="my-work-detail-title" className={DETAIL_KEY}>
					{keyValue}
				</h2>
			</div>
			<button
				type="button"
				ref={closeButtonRef}
				onClick={onClose}
				aria-label="Close details"
				className={CLOSE_BUTTON}
			>
				<X size={18} aria-hidden />
			</button>
		</header>
	);
}

type DetailSheetFrameProps = DetailSheetHeaderProps &
	DetailSheetBodyProps & {
		dialogRef: RefObject<HTMLElement>;
		onRefresh: () => void | Promise<void>;
	};

function DetailSheetFrame(props: DetailSheetFrameProps) {
	const {
		state,
		item,
		keyValue,
		sourceLabel,
		closeButtonRef,
		dialogRef,
		onClose,
		onRetry,
		onNavigate,
		onRefresh,
		pending,
	} = props;
	const identity = item ? myWorkMutationIdentity(item) : "";
	const mutation = useSyncExternalStore(
		subscribeToMyWorkMutations,
		() => (identity ? getMyWorkMutationSnapshot(identity) : undefined),
		() => undefined,
	);
	const projectedItem =
		mutation?.status === "success"
			? mutation.item
			: mutation?.status === "unavailable"
				? null
				: item;
	return (
		<div
			className={SHEET_BACKDROP}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<aside
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="my-work-detail-title"
				tabIndex={-1}
				className={SHEET_PANEL}
			>
				<DetailSheetHeader
					keyValue={projectedItem?.key ?? keyValue}
					sourceLabel={sourceLabel}
					closeButtonRef={closeButtonRef}
					onClose={onClose}
				/>
				{projectedItem && (
					<div className="shrink-0 border-neutral-200 border-b bg-white px-4 py-3 md:px-5">
						<MyWorkDoneAction
							item={projectedItem}
							onRefresh={onRefresh}
							onUnavailable={() => onClose()}
							className="w-full items-start"
						/>
					</div>
				)}
				<DetailSheetBody
					state={state}
					item={projectedItem}
					keyValue={keyValue}
					onRetry={onRetry}
					onNavigate={onNavigate}
					pending={pending}
				/>
			</aside>
		</div>
	);
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
	useDetailSheetKeyboard(
		selection,
		onClose,
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
	const sourceLabel = source === "board" ? "Board" : "Tracker";
	const retryDetail = () => {
		void retry();
	};
	const refreshAfterFailure = async () => {
		await Promise.allSettled([
			Promise.resolve().then(async () => {
				await onRefresh?.();
			}),
			Promise.resolve().then(retryDetail),
		]);
	};
	return (
		<DetailSheetFrame
			state={state}
			item={item}
			keyValue={key}
			sourceLabel={sourceLabel}
			closeButtonRef={closeButtonRef}
			dialogRef={dialogRef}
			onClose={onClose}
			onRetry={retryDetail}
			onRefresh={refreshAfterFailure}
			onNavigate={handleSourceNavigation}
			pending={pending}
		/>
	);
}
