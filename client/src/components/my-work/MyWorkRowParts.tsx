import {
	ArrowUpRight,
	Ban,
	CalendarDays,
	CheckCircle2,
	Circle,
	CircleDot,
	Clock3,
} from "lucide-react";
import { isMyWorkItemOverdue } from "../../lib/myWorkOrdering";
import {
	type MyWorkStatusGroup,
	normalizeMyWorkStatus,
} from "../../lib/myWorkStatus";
import type { MyWorkItem } from "../../types/myWork";

export type StatusMetadata = (typeof STATUS_META)[MyWorkStatusGroup];

const STATUS_META: Record<
	MyWorkStatusGroup,
	{ label: string; badge: string; icon: typeof Circle }
> = {
	backlog: {
		label: "Backlog",
		badge: "bg-neutral-100 text-neutral-700",
		icon: Circle,
	},
	started: {
		label: "In progress",
		badge: "bg-warning-100 text-warning-900",
		icon: CircleDot,
	},
	completed: {
		label: "Done",
		badge: "bg-success-100 text-success-900",
		icon: CheckCircle2,
	},
	canceled: {
		label: "Canceled",
		badge: "bg-error-100 text-error-900",
		icon: Ban,
	},
	other: {
		label: "Other",
		badge: "bg-primary-100 text-primary-800",
		icon: Clock3,
	},
};

function dateOnly(value: string): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return null;
	const candidate = new Date(
		Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
	);
	if (
		candidate.getUTCFullYear() !== Number(match[1]) ||
		candidate.getUTCMonth() !== Number(match[2]) - 1 ||
		candidate.getUTCDate() !== Number(match[3])
	) {
		return null;
	}
	return value;
}

export function formatDueDate(value: string | null): string | null {
	if (!value) return null;
	const parsedDate = dateOnly(value);
	const parsed = parsedDate
		? new Date(`${parsedDate}T00:00:00Z`)
		: new Date(value);
	if (Number.isNaN(parsed.getTime())) return null;
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	}).format(parsed);
}

export function rowIdentity(item: MyWorkItem): string {
	return `${item.workspaceId}-${item.source}-${item.key}`;
}

function StatusMark({ statusMeta }: { statusMeta: StatusMetadata }) {
	const StatusIcon = statusMeta.icon;
	return (
		<span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-primary-700">
			<StatusIcon size={16} aria-hidden />
		</span>
	);
}

function RowIdentityMeta({
	item,
	statusMeta,
}: {
	item: MyWorkItem;
	statusMeta: StatusMetadata;
}) {
	const statusLabel = item.status.name.trim() || statusMeta.label;
	const showStatusBadge =
		statusLabel.toLowerCase() !== statusMeta.label.toLowerCase();
	return (
		<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
			<span className="shrink-0 font-mono text-neutral-600 text-xs tabular-nums">
				{item.key}
			</span>
			{showStatusBadge && (
				<span
					className={`inline-flex max-w-[12rem] items-center rounded-md px-1.5 py-0.5 font-medium text-[10px] ${statusMeta.badge}`}
					data-testid={`my-work-status-${rowIdentity(item)}`}
				>
					{statusLabel}
				</span>
			)}
		</span>
	);
}

function RowWorkspaceMeta({
	workspaceName,
	sourceLabel,
	sourceContext,
}: {
	workspaceName: string;
	sourceLabel: string;
	sourceContext: string;
}) {
	return (
		<span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-neutral-600 text-xs">
			<span className="min-w-0 max-w-[16rem] truncate" title={workspaceName}>
				{workspaceName}
			</span>
			<span className="text-neutral-300" aria-hidden>
				·
			</span>
			<span className="shrink-0">{sourceLabel}</span>
			<span className="text-neutral-300" aria-hidden>
				·
			</span>
			<span className="min-w-0 max-w-[15rem] truncate" title={sourceContext}>
				{sourceContext}
			</span>
		</span>
	);
}

function RowSummary({
	item,
	statusMeta,
	workspaceName,
	sourceLabel,
	sourceContext,
}: {
	item: MyWorkItem;
	statusMeta: StatusMetadata;
	workspaceName: string;
	sourceLabel: string;
	sourceContext: string;
}) {
	return (
		<span className="min-w-0 flex-1">
			<span
				className="block truncate font-medium text-neutral-900 text-sm leading-snug"
				title={item.title}
			>
				{item.title}
			</span>
			<span className="mt-1 block">
				<RowIdentityMeta item={item} statusMeta={statusMeta} />
			</span>
			<RowWorkspaceMeta
				workspaceName={workspaceName}
				sourceLabel={sourceLabel}
				sourceContext={sourceContext}
			/>
		</span>
	);
}

function RowDueMeta({
	dueValue,
	overdue,
}: {
	dueValue: string | null;
	overdue: boolean;
}) {
	const formatted = formatDueDate(dueValue);
	return (
		<span className="flex w-[5.75rem] shrink-0 flex-col items-end gap-1 text-right text-xs tabular-nums sm:w-28">
			{formatted ? (
				<span
					className={`inline-flex items-center gap-1 ${overdue ? "font-medium text-error-900" : "text-neutral-600"}`}
					aria-label={
						overdue ? `Overdue, due ${formatted}` : `Due ${formatted}`
					}
				>
					<CalendarDays size={13} aria-hidden />
					{overdue ? "Overdue" : formatted}
				</span>
			) : null}
			<span className="inline-flex items-center gap-1 text-primary-700 opacity-0 transition-opacity motion-reduce:transition-none group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
				Open
				<ArrowUpRight size={13} aria-hidden />
			</span>
		</span>
	);
}

export interface RowView {
	statusMeta: StatusMetadata;
	dueValue: string | null;
	overdue: boolean;
	workspaceName: string;
	sourceLabel: string;
	sourceContext: string;
}

export function createRowView(item: MyWorkItem): RowView {
	const group = normalizeMyWorkStatus(item);
	return {
		statusMeta: STATUS_META[group],
		dueValue:
			item.source === "board" ? (item.dueDate ?? null) : (item.endDate ?? null),
		overdue: isMyWorkItemOverdue(item),
		workspaceName: item.workspaceName || item.workspace.name,
		sourceLabel: item.source === "board" ? "Board" : "Tracker",
		sourceContext:
			item.source === "board" ? item.columnName || "Board" : item.status.name,
	};
}

export function RowButton({
	item,
	compact,
	view,
	onActivate,
}: {
	item: MyWorkItem;
	compact: boolean;
	view: RowView;
	onActivate: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onActivate}
			aria-label={`Open ${item.key} ${item.title}`}
			className={`group/row relative flex min-w-0 flex-1 items-start gap-3 bg-white text-left transition-colors hover:bg-primary-100/35 active:bg-primary-100/55 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600 motion-reduce:transition-none ${
				compact ? "px-3 py-2.5" : "px-4 py-3 md:px-5"
			}`}
		>
			<span
				className={`absolute inset-y-0 left-0 w-0.5 bg-primary-600 opacity-0 transition-opacity motion-reduce:transition-none group-hover/row:opacity-100 group-focus-visible/row:opacity-100 ${
					view.overdue ? "opacity-100" : ""
				}`}
				aria-hidden
			/>
			<StatusMark statusMeta={view.statusMeta} />
			<RowSummary
				item={item}
				statusMeta={view.statusMeta}
				workspaceName={view.workspaceName}
				sourceLabel={view.sourceLabel}
				sourceContext={view.sourceContext}
			/>
			<RowDueMeta dueValue={view.dueValue} overdue={view.overdue} />
			<span
				className="flex shrink-0 items-center gap-1 text-primary-700 sm:hidden"
				aria-hidden
			>
				<ArrowUpRight size={15} />
			</span>
		</button>
	);
}
