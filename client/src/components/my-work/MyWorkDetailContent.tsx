import { AlertTriangle, ArrowUpRight, LoaderCircle } from "lucide-react";
import {
	myWorkDetailErrorMessage,
	type MyWorkDetailState,
} from "../../lib/myWorkNavigation";
import type { MyWorkItem } from "../../types/myWork";

const STATUS_SURFACE =
	"flex flex-1 flex-col items-center justify-center px-6 py-16 text-center";
const SHEET_FOOTER =
	"flex shrink-0 border-neutral-200 border-t bg-white px-4 py-3 md:px-5";
const SOURCE_BUTTON =
	"inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 font-medium text-sm text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-wait disabled:bg-primary-300 motion-reduce:transition-none";

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
	return {
		title: "Couldn't load this work",
		message: myWorkDetailErrorMessage(error),
	};
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

export interface DetailSheetBodyProps {
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

export function DetailSheetBody({
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
