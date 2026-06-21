import { Activity as ActivityIcon, ArrowRight } from "lucide-react";
import { Link } from "react-router";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { useBoard } from "../context/BoardContext";
import type { ActivityEvent } from "../types";
import { formatRelativeTime } from "../types";

export function describeEvent(e: ActivityEvent): string {
	const card = e.cardTitle ? `“${e.cardTitle}”` : "a card";
	switch (e.type) {
		case "create":
			return `added ${card}${e.toColumn ? ` to ${e.toColumn}` : ""}`;
		case "move":
			return `moved ${card}${e.fromColumn ? ` from ${e.fromColumn}` : ""}${
				e.toColumn ? ` to ${e.toColumn}` : ""
			}`;
		case "update":
			return `updated ${card}`;
		case "delete":
			return `deleted ${card}`;
		default:
			return `changed ${card}`;
	}
}

const TYPE_META: Record<
	ActivityEvent["type"],
	{ label: string; badge: string; dot: string }
> = {
	create: {
		label: "Added",
		badge: "bg-success-100 text-success-900",
		dot: "bg-success-500",
	},
	move: {
		label: "Moved",
		badge: "bg-info-100 text-info-900",
		dot: "bg-info-500",
	},
	update: {
		label: "Updated",
		badge: "bg-primary-100 text-primary-800",
		dot: "bg-primary-500",
	},
	delete: {
		label: "Deleted",
		badge: "bg-error-100 text-error-900",
		dot: "bg-error-500",
	},
};

export default function ActivityPage() {
	const { activity } = useBoard();

	return (
		<div className="mx-auto max-w-2xl p-6 md:p-8">
			<PageHeader
				icon={ActivityIcon}
				title="Activity"
				subtitle="Everything your team changed on the board, newest first."
				actions={
					<Link
						to="/board"
						className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Back to board
						<ArrowRight size={14} aria-hidden />
					</Link>
				}
			/>

			{activity.length === 0 ? (
				<div className="mt-10 rounded-xl border border-neutral-200 bg-white px-6 py-14">
					<EmptyState
						icon={ActivityIcon}
						title="No activity yet"
						description="Once your team starts adding and moving cards, every change lands here as a running timeline."
						action={
							<Link
								to="/board"
								className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								Go to board
								<ArrowRight size={14} aria-hidden />
							</Link>
						}
					/>
				</div>
			) : (
				<ol className="mt-8 ml-1.5 border-l border-neutral-200">
					{activity.map((e) => {
						const meta = TYPE_META[e.type] ?? TYPE_META.update;
						return (
							<li key={e.id} className="relative py-3 pl-6 last:pb-0">
								<span
									className={`absolute -left-[5px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-neutral-100 ${meta.dot}`}
									aria-hidden
								/>
								<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
									<span
										className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${meta.badge}`}
									>
										{meta.label}
									</span>
									<p className="min-w-0 text-sm text-neutral-800">
										<span className="font-medium text-neutral-900">
											{e.actor?.displayName ?? "Someone"}
										</span>{" "}
										{describeEvent(e)}
									</p>
								</div>
								<p className="mt-1 text-xs text-neutral-500">
									{formatRelativeTime(e.createdAt)}
								</p>
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
}
