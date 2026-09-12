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

export interface MyWorkRowProps {
	item: MyWorkItem;
	/** Called when the row's read-only selection action is activated. */
	onSelect?: (item: MyWorkItem) => void;
	/** Alias kept for callers that describe the row action as opening it. */
	onOpen?: (item: MyWorkItem) => void;
	/** Compact mode keeps the same metadata while tightening the mobile rhythm. */
	compact?: boolean;
}

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

type StatusMetadata = (typeof STATUS_META)[MyWorkStatusGroup];

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

function formatDueDate(value: string | null): string {
	if (!value) return "No due date";
	const parsedDate = dateOnly(value);
	const parsed = parsedDate
		? new Date(`${parsedDate}T00:00:00Z`)
		: new Date(value);
	if (Number.isNaN(parsed.getTime())) return "No due date";
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	}).format(parsed);
}

function rowIdentity(item: MyWorkItem): string {
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
	return (
		<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
			<span className="shrink-0 font-mono text-neutral-600 text-xs tabular-nums">
				{item.key}
			</span>
			<span
				className={`inline-flex max-w-[12rem] items-center rounded-md px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide ${statusMeta.badge}`}
				data-testid={`my-work-status-${rowIdentity(item)}`}
			>
				{item.status.name || statusMeta.label}
			</span>
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
			<span
				className="inline-flex min-w-0 max-w-[16rem] items-center gap-1 truncate"
				title={workspaceName}
			>
				<span className="shrink-0 text-neutral-400" aria-hidden>
					{workspaceName.slice(0, 1).toUpperCase()}
				</span>
				<span className="truncate">{workspaceName}</span>
			</span>
			<span className="text-neutral-300" aria-hidden>
				·
			</span>
			<span className="inline-flex shrink-0 items-center rounded-md bg-primary-100 px-1.5 py-0.5 font-medium text-primary-800">
				{sourceLabel}
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
			<RowIdentityMeta item={item} statusMeta={statusMeta} />
			<span
				className="mt-1 block truncate font-medium text-neutral-900 text-sm leading-snug"
				title={item.title}
			>
				{item.title}
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
	return (
		<span className="flex w-[5.75rem] shrink-0 flex-col items-end gap-1 text-right text-xs tabular-nums sm:w-28">
			<span
				className={`inline-flex items-center gap-1 ${overdue ? "font-medium text-error-900" : "text-neutral-600"}`}
				aria-label={
					overdue
						? `Overdue, due ${formatDueDate(dueValue)}`
						: `Due ${formatDueDate(dueValue)}`
				}
			>
				<CalendarDays size={13} aria-hidden />
				{overdue ? "Overdue" : formatDueDate(dueValue)}
			</span>
			<span className="inline-flex items-center gap-1 text-primary-700 opacity-0 transition-opacity motion-reduce:transition-none group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
				Open
				<ArrowUpRight size={13} aria-hidden />
			</span>
		</span>
	);
}

/** A read-only, responsive work row. Detail and mutation actions live elsewhere. */
export default function MyWorkRow({
	item,
	onSelect,
	onOpen,
	compact = false,
}: MyWorkRowProps) {
	const group = normalizeMyWorkStatus(item);
	const statusMeta = STATUS_META[group];
	const dueValue =
		item.source === "board" ? (item.dueDate ?? null) : (item.endDate ?? null);
	const overdue = isMyWorkItemOverdue(item);
	const workspaceName = item.workspaceName || item.workspace.name;
	const sourceLabel = item.source === "board" ? "Board" : "Tracker";
	const sourceContext =
		item.source === "board" ? item.columnName || "Board" : item.status.name;
	const handleSelect = () => {
		if (onSelect) onSelect(item);
		else onOpen?.(item);
	};

	return (
		<li
			data-testid={`my-work-row-${rowIdentity(item)}`}
			data-work-item-key={item.key}
			className="border-neutral-200 border-b last:border-b-0"
		>
			<button
				type="button"
				onClick={handleSelect}
				aria-label={`Open ${item.key} ${item.title}`}
				className={`group/row relative flex w-full min-w-0 items-start gap-3 bg-white text-left transition-colors hover:bg-primary-100/35 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600 motion-reduce:transition-none ${
					compact ? "px-3 py-2.5" : "px-4 py-3 md:px-5"
				}`}
			>
				<span
					className={`absolute inset-y-0 left-0 w-0.5 bg-primary-600 opacity-0 transition-opacity motion-reduce:transition-none group-hover/row:opacity-100 group-focus-visible/row:opacity-100 ${
						overdue ? "opacity-100" : ""
					}`}
					aria-hidden
				/>
				<StatusMark statusMeta={statusMeta} />
				<RowSummary
					item={item}
					statusMeta={statusMeta}
					workspaceName={workspaceName}
					sourceLabel={sourceLabel}
					sourceContext={sourceContext}
				/>
				<RowDueMeta dueValue={dueValue} overdue={overdue} />
				<span
					className="flex shrink-0 items-center gap-1 text-primary-700 sm:hidden"
					aria-hidden
				>
					<ArrowUpRight size={15} />
				</span>
			</button>
		</li>
	);
}
