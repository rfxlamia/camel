import { RefreshCw } from "lucide-react";

export default function MyWorkHeader({
	loading,
	onRefresh,
}: {
	loading: boolean;
	onRefresh: () => void;
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0">
				<h1 className="text-xl font-semibold tracking-tight text-neutral-900 md:text-[25px]">
					My Work
				</h1>
				<p className="mt-1 max-w-xl text-neutral-600 text-sm">
					Assigned to you.
				</p>
			</div>
			<button
				type="button"
				onClick={onRefresh}
				disabled={loading}
				className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 font-medium text-primary-600 text-sm transition-[background-color,color,transform] motion-safe:active:scale-[0.97] motion-reduce:transition-none hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:text-neutral-400"
				aria-label="Refresh My Work"
			>
				<RefreshCw
					size={14}
					className={loading ? "animate-spin motion-reduce:animate-none" : ""}
					aria-hidden
				/>
				{loading ? "Refreshing…" : "Refresh"}
			</button>
		</div>
	);
}
