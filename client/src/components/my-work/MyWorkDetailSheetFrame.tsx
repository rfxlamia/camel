import { X } from "lucide-react";
import { type RefObject, useSyncExternalStore } from "react";
import {
	getMyWorkMutationSnapshot,
	myWorkMutationIdentity,
	subscribeToMyWorkMutations,
} from "../../lib/workItemMutations";
import type { MyWorkItem } from "../../types/myWork";
import {
	DetailSheetBody,
	type DetailSheetBodyProps,
} from "./MyWorkDetailContent";
import MyWorkDoneAction from "./MyWorkDoneAction";

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

function useProjectedDetailItem(item: MyWorkItem | null): MyWorkItem | null {
	const identity = item ? myWorkMutationIdentity(item) : "";
	const mutation = useSyncExternalStore(
		subscribeToMyWorkMutations,
		() => (identity ? getMyWorkMutationSnapshot(identity) : undefined),
		() => undefined,
	);
	if (mutation?.status === "success") return mutation.item;
	if (mutation?.status === "unavailable") return null;
	return item;
}

async function refreshDetailAfterFailure(
	onRefresh: (() => void | Promise<void>) | undefined,
	onRetry: () => void,
): Promise<void> {
	await Promise.allSettled([
		Promise.resolve().then(async () => {
			await onRefresh?.();
		}),
		Promise.resolve().then(onRetry),
	]);
}

function DetailSheetAction({
	item,
	onRefresh,
	onClose,
}: {
	item: MyWorkItem | null;
	onRefresh: () => void | Promise<void>;
	onClose: () => void;
}) {
	if (!item) return null;
	return (
		<div className="shrink-0 border-neutral-200 border-b bg-white px-4 py-3 md:px-5">
			<MyWorkDoneAction
				item={item}
				onRefresh={onRefresh}
				onUnavailable={() => onClose()}
				className="w-full items-start"
			/>
		</div>
	);
}

type DetailSheetFrameProps = DetailSheetHeaderProps &
	DetailSheetBodyProps & {
		dialogRef: RefObject<HTMLElement>;
		onRefresh?: () => void | Promise<void>;
	};

type DetailSheetSurfaceProps = Omit<
	DetailSheetFrameProps,
	"item" | "onRefresh"
> & {
	projectedItem: MyWorkItem | null;
	onRefresh: () => void | Promise<void>;
};

function DetailSheetPanel({
	state,
	projectedItem,
	keyValue,
	sourceLabel,
	closeButtonRef,
	dialogRef,
	onClose,
	onRetry,
	onNavigate,
	onRefresh,
	pending,
}: DetailSheetSurfaceProps) {
	return (
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
			<DetailSheetAction
				item={projectedItem}
				onRefresh={onRefresh}
				onClose={onClose}
			/>
			<DetailSheetBody
				state={state}
				item={projectedItem}
				keyValue={keyValue}
				onRetry={onRetry}
				onNavigate={onNavigate}
				pending={pending}
			/>
		</aside>
	);
}

function DetailSheetSurface(props: DetailSheetSurfaceProps) {
	return (
		<div
			className={SHEET_BACKDROP}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			<DetailSheetPanel {...props} />
		</div>
	);
}

export function MyWorkDetailSheetFrame({
	item,
	onRefresh,
	onRetry,
	...surfaceProps
}: DetailSheetFrameProps) {
	const projectedItem = useProjectedDetailItem(item);
	const refreshAfterFailure = () =>
		refreshDetailAfterFailure(onRefresh, onRetry);
	return (
		<DetailSheetSurface
			{...surfaceProps}
			onRetry={onRetry}
			projectedItem={projectedItem}
			onRefresh={refreshAfterFailure}
		/>
	);
}
