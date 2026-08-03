import { ListTodo, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { api } from "../api";
import PageHeader from "../components/PageHeader";
import TrackerCreateModal from "../components/tracker/TrackerCreateModal";
import TrackerSection from "../components/tracker/TrackerSection";
import { useBoard } from "../context/BoardContext";
import {
	groupItemsByStatus,
	sortStatusesByPosition,
} from "../lib/trackerUtils";
import type { TrackerItem, TrackerVocabulary } from "../types";

export default function TrackerPage() {
	const { activeWorkspaceId, subscribeTrackerEvents } = useBoard();
	const location = useLocation();
	const [statuses, setStatuses] = useState<TrackerVocabulary[]>([]);
	const [priorities, setPriorities] = useState<TrackerVocabulary[]>([]);
	const [items, setItems] = useState<TrackerItem[]>([]);
	const [search, setSearch] = useState("");
	const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
	const [createOpen, setCreateOpen] = useState(false);
	const [loading, setLoading] = useState(true);

	// Reset in-memory collapse when React Router re-navigates to /tracker.
	// biome-ignore lint/correctness/useExhaustiveDependencies: location.key is the intentional trigger
	useEffect(() => {
		setCollapsedIds(new Set());
	}, [location.key]);

	const loadData = useCallback(async () => {
		if (activeWorkspaceId === null) return;
		setLoading(true);
		try {
			const [statusList, priorityList, itemList] = await Promise.all([
				api.listTrackerVocabularies(activeWorkspaceId, "status"),
				api.listTrackerVocabularies(activeWorkspaceId, "priority"),
				api.listTrackerItems(activeWorkspaceId),
			]);
			setStatuses(sortStatusesByPosition(statusList));
			setPriorities(priorityList);
			setItems(itemList);
		} finally {
			setLoading(false);
		}
	}, [activeWorkspaceId]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	useEffect(() => {
		if (!subscribeTrackerEvents) return;
		return subscribeTrackerEvents((event) => {
			if (
				event.type === "tracker.vocabulary.created" &&
				event.payload &&
				typeof event.payload === "object" &&
				"kind" in event.payload &&
				event.payload.kind === "status"
			) {
				const vocab = event.payload as TrackerVocabulary;
				setStatuses((prev) =>
					sortStatusesByPosition(
						prev.some((s) => s.id === vocab.id) ? prev : [...prev, vocab],
					),
				);
			}
		});
	}, [subscribeTrackerEvents]);

	const filteredItems = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return items;
		return items.filter(
			(item) =>
				item.title.toLowerCase().includes(q) ||
				item.key.toLowerCase().includes(q),
		);
	}, [items, search]);

	const grouped = useMemo(
		() => groupItemsByStatus(filteredItems, statuses),
		[filteredItems, statuses],
	);

	const searchActive = search.trim().length > 0;

	const toggleSection = (statusId: number) => {
		setCollapsedIds((prev) => {
			const next = new Set(prev);
			if (next.has(statusId)) next.delete(statusId);
			else next.add(statusId);
			return next;
		});
	};

	if (activeWorkspaceId === null) return null;

	return (
		<div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
			<PageHeader
				icon={ListTodo}
				title="Tracker"
				subtitle="Workspace issues and tasks"
				actions={
					<button
						type="button"
						aria-label="Create tracker item"
						onClick={() => setCreateOpen(true)}
						className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<Plus size={16} aria-hidden />
					</button>
				}
			/>

			<div className="relative mt-5">
				<Search
					size={14}
					className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400"
					aria-hidden
				/>
				<input
					type="search"
					placeholder="Search tracker items…"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-full rounded-lg border border-neutral-200 bg-white py-2 pr-3 pl-9 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				/>
			</div>

			<div className="mt-5 space-y-3">
				{loading ? (
					<div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
						Loading…
					</div>
				) : (
					statuses.map((status) => {
						const sectionItems = grouped.get(status.id) ?? [];
						if (searchActive && sectionItems.length === 0) return null;
						return (
							<TrackerSection
								key={status.id}
								status={status}
								items={sectionItems}
								collapsed={collapsedIds.has(status.id)}
								onToggle={() => toggleSection(status.id)}
							/>
						);
					})
				)}
			</div>

			{createOpen && (
				<TrackerCreateModal
					workspaceId={activeWorkspaceId}
					statuses={statuses}
					priorities={priorities}
					onClose={() => setCreateOpen(false)}
					onCreated={() => void loadData()}
				/>
			)}
		</div>
	);
}
