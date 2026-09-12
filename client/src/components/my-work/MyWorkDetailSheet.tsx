import { AlertTriangle, ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import {
	type MyWorkDetailSelection,
	type MyWorkDetailState,
	myWorkDetailErrorMessage,
	useMyWorkDetailState,
	useMyWorkSourceNavigation,
} from "../../lib/myWorkNavigation";
import type { MyWorkItem } from "../../types/myWork";
export interface MyWorkDetailSheetProps {
	selection: MyWorkDetailSelection | null;
	onClose: () => void;
}
const STATUS_SURFACE =
	"flex flex-1 flex-col items-center justify-center px-6 py-16 text-center";
const SHEET_BACKDROP =
	"fixed inset-0 z-40 flex items-end bg-neutral-900/35 overscroll-none md:justify-end";
const SHEET_PANEL =
	"flex max-h-[92vh] w-full flex-col rounded-t-lg border-neutral-200 border-t bg-white shadow-xl animate-panel-in motion-reduce:animate-none md:h-full md:max-h-none md:w-104 md:rounded-none md:border-t-0 md:border-l";
const SHEET_HEADER =
	"flex shrink-0 items-center justify-between gap-3 border-neutral-200 border-b px-4 py-3 md:px-5";
const CLOSE_BUTTON =
	"shrink-0 rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none";
const SOURCE_BUTTON =
	"inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 font-medium text-sm text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-wait disabled:bg-primary-300 motion-reduce:transition-none";
const DETAIL_LABEL =
	"font-medium text-[11px] text-primary-700 uppercase tracking-[0.1em]";
const DETAIL_KEY =
	"mt-0.5 truncate font-mono font-medium text-neutral-900 text-sm tabular-nums";
const SHEET_FOOTER =
	"flex shrink-0 border-neutral-200 border-t bg-white px-4 py-3 md:px-5";
type DetailMessageStatus = "loading" | "unavailable" | "error";

function getDetailStateCopy(
	status: DetailMessageStatus,
	keyValue: string,
	error?: unknown,
) {
	if (status === "loading") return { title: `Loading ${keyValue}…`, message: null };
	if (status === "unavailable") {
		return {
			title: "Work item unavailable",
			message: "This work item is no longer available to you.",
		};
	}
	return { title: "Couldn't load this work", message: myWorkDetailErrorMessage(error) };
}

function DetailStateIcon({ status }: { status: DetailMessageStatus }) {
	if (status === "loading") {
		return (
			<LoaderCircle
				size={20}
				className="animate-spin text-primary-600 motion-reduce:animate-none"
				aria-hidden
			/>
		);
	}
	return (
		<AlertTriangle
			size={22}
			className={
				status === "unavailable" ? "text-warning-500" : "text-error-500"
			}
			aria-hidden
		/>
	);
}

function DetailRetryButton({ onRetry }: { onRetry: () => void }) {
	return (
		<button
			type="button"
			onClick={onRetry}
			className="mt-4 inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 font-medium text-primary-700 text-sm shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none"
		>
			Try again
		</button>
	);
}

function DetailStateMessage({
	status,
	keyValue,
	error,
	onRetry,
}: {
	status: DetailMessageStatus;
	keyValue: string;
	error?: unknown;
	onRetry: () => void;
}) {
	const { title, message } = getDetailStateCopy(status, keyValue, error);
	return (
		<div
			data-testid={`my-work-detail-${status}`}
			role={status === "loading" ? undefined : "alert"}
			className={STATUS_SURFACE}
			aria-live={status === "loading" ? "polite" : undefined}
		>
			<DetailStateIcon status={status} />
			<h3 className="mt-3 font-semibold text-neutral-900 text-base">{title}</h3>
			{message && (
				<p className="mt-1 max-w-sm text-neutral-600 text-sm">{message}</p>
			)}
			{status === "error" && <DetailRetryButton onRetry={onRetry} />}
		</div>
	);
}
function DetailContent({ item }: { item: MyWorkItem }) {
	const workspaceName = item.workspaceName || item.workspace.name;
	const sourceName = item.source === "board" ? "Board" : "Tracker";
	const sourceContext =
		item.source === "board" ? item.columnName || "Board" : item.status.name;
	return (
		<div className="space-y-5 px-4 py-5 md:px-5">
			<section
				aria-label="Work context"
				className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3"
			>
				<p className="text-neutral-700 text-sm">
					<span
						data-testid="my-work-detail-workspace"
						className="font-medium text-neutral-900"
					>
						{workspaceName}
					</span>
					<span className="mx-1 text-neutral-300" aria-hidden>
						·
					</span>
					<span className="text-neutral-500">{sourceName}</span>
					<span className="mx-1 text-neutral-300" aria-hidden>
						·
					</span>
					<span className="text-neutral-500">{sourceContext}</span>
				</p>
			</section>
			<section aria-label="Details">
				<h3 className="font-semibold text-neutral-900 text-lg leading-snug">
					{item.title}
				</h3>
				{item.description ? (
					<p className="mt-3 whitespace-pre-wrap text-neutral-700 text-sm leading-relaxed">
						{item.description}
					</p>
				) : (
					<p className="mt-3 text-neutral-500 text-sm">No description.</p>
				)}
			</section>
		</div>
	);
}
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
) {
	if (event.key === "Escape") {
		event.preventDefault();
		onClose();
		return;
	}
	if (event.key !== "Tab" || !dialog) return;
	const focusable = getDialogFocusableElements(dialog);
	if (focusable.length === 0) {
		event.preventDefault();
		dialog.focus();
		return;
	}
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	const activeElement = document.activeElement;
	const focusIsOutside = !activeElement || !dialog.contains(activeElement);
	if (event.shiftKey) {
		if (activeElement === first || focusIsOutside) {
			event.preventDefault();
			last?.focus();
		}
		return;
	}
	if (activeElement === last || focusIsOutside) {
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
			trapDetailSheetFocus(event, dialogRef.current, onCloseRef.current);
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [dialogRef, selection]);
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
function DetailSheetActions({
	item,
	onNavigate,
	pending,
}: {
	item: MyWorkItem;
	onNavigate: () => void;
	pending: boolean;
}) {
	return (
		<footer className={SHEET_FOOTER}>
			<button
				type="button"
				onClick={onNavigate}
				disabled={pending}
				className={SOURCE_BUTTON}
			>
				Open in {item.source === "board" ? "Board" : "Tracker"}
				<ArrowUpRight size={14} aria-hidden />
			</button>
		</footer>
	);
}
interface DetailSheetBodyProps {
	state: MyWorkDetailState;
	item: MyWorkItem | null;
	keyValue: string;
	onRetry: () => void;
	onNavigate: () => void;
	pending: boolean;
}

function DetailSheetReadyContent({
	item,
	onNavigate,
	pending,
}: Pick<DetailSheetBodyProps, "item" | "onNavigate" | "pending">) {
	if (!item) return null;
	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<DetailContent item={item} />
			</div>
			<DetailSheetActions
				item={item}
				onNavigate={onNavigate}
				pending={pending}
			/>
		</>
	);
}

function DetailSheetBody({
	state,
	item,
	keyValue,
	onRetry,
	onNavigate,
	pending,
}: DetailSheetBodyProps) {
	return (
		<>
			{state.status !== "ready" && (
				<DetailStateMessage
					status={state.status}
					keyValue={keyValue}
					error={state.status === "error" ? state.error : undefined}
					onRetry={onRetry}
				/>
			)}
			<DetailSheetReadyContent
				item={item}
				onNavigate={onNavigate}
				pending={pending}
			/>
		</>
	);
}

type DetailSheetFrameProps = DetailSheetHeaderProps &
	DetailSheetBodyProps & {
		dialogRef: RefObject<HTMLElement>;
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
		pending,
	} = props;
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
					keyValue={item?.key ?? keyValue}
					sourceLabel={sourceLabel}
					closeButtonRef={closeButtonRef}
					onClose={onClose}
				/>
				<DetailSheetBody
					state={state}
					item={item}
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
}: MyWorkDetailSheetProps) {
	const { state, retry, workspaceId, source, key } =
		useMyWorkDetailState(selection);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	useDetailSheetKeyboard(selection, onClose, closeButtonRef, dialogRef);
	const { handleSourceNavigation, pending } = useMyWorkSourceNavigation(
		state.status === "ready" ? state.item : null,
	);
	if (!selection || workspaceId === null || source === null || key === null) {
		return null;
	}

	const item = state.status === "ready" ? state.item : null;
	const sourceLabel = source === "board" ? "Board" : "Tracker";
	return (
		<DetailSheetFrame
			state={state}
			item={item}
			keyValue={key}
			sourceLabel={sourceLabel}
			closeButtonRef={closeButtonRef}
			dialogRef={dialogRef}
			onClose={onClose}
			onRetry={() => void retry()}
			onNavigate={handleSourceNavigation}
			pending={pending}
		/>
	);
}
