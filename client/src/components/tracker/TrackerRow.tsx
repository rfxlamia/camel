import { useNavigate } from "react-router";
import type { TrackerItem } from "../../types";

interface Props {
	item: TrackerItem;
}

export default function TrackerRow({ item }: Props) {
	const navigate = useNavigate();

	return (
		<button
			type="button"
			data-testid={`tracker-row-${item.key}`}
			onClick={() => navigate(`/tracker/${item.key}`)}
			className="flex w-full items-center gap-3 border-b border-neutral-200 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600"
		>
			<span className="w-16 shrink-0 font-mono text-xs text-neutral-500 tabular-nums">
				{item.key}
			</span>
			<span
				className="h-2 w-2 shrink-0 rounded-full"
				style={{ backgroundColor: item.status.colour }}
				aria-label={item.status.name}
				title={item.status.name}
			/>
			<span className="min-w-0 flex-1 truncate font-medium text-neutral-900">
				{item.title}
			</span>
			<div className="hidden shrink-0 items-center gap-1.5 sm:flex">
				{item.labels.map((label) => (
					<span
						key={label.id}
						className="rounded px-1.5 py-0.5 text-xs text-neutral-700"
						style={{ backgroundColor: label.colour }}
					>
						{label.name}
					</span>
				))}
			</div>
			<div className="hidden w-24 shrink-0 items-center justify-end gap-1 md:flex">
				{item.assignees.slice(0, 2).map((a) => (
					<span
						key={a.id}
						className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-[10px] font-medium text-primary-700"
						title={a.displayName}
					>
						{a.displayName.charAt(0).toUpperCase()}
					</span>
				))}
			</div>
			{/* TODO: due date preference on date column */}
			<time className="hidden w-20 shrink-0 text-right text-xs text-neutral-500 tabular-nums lg:block">
				{new Date(item.createdAt).toLocaleDateString(undefined, {
					month: "short",
					day: "numeric",
				})}
			</time>
		</button>
	);
}
