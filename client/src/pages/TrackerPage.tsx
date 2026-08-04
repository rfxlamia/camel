import { ListTodo, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { ApiError, api } from "../api";
import EmptyState from "../components/EmptyState";
import TrackerCreateModal from "../components/tracker/TrackerCreateModal";
import TrackerSection from "../components/tracker/TrackerSection";
import { useBoard } from "../context/BoardContext";
import {
	groupItemsByStatus,
	sortStatusesByPosition,
} from "../lib/trackerUtils";
import type { TrackerItem, TrackerVocabulary } from "../types";

export default function TrackerPage() {
	const {
		activeWorkspaceId,
		subscribeTrackerEvents,
		registerRefreshTrackerList,
		showToast,
	} = useBoard();
	const location = useLocation();
	const [statuses, setStatuses] = useState<TrackerVocabulary[]>([]);
	const [priorities, setPriorities] = useState<TrackerVocabulary[]>([]);
	const [items, setItems] = useState<TrackerItem[]>([]);
	const [search, setSearch] = useState("");
	const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
	const [createOpen, setCreateOpen] = useState(false);
	const [createStatusId, setCreateStatusId] = useState<number | undefined>();
	const [loading, setLoading] = useState(true);
	/** Item ids with a status request in flight, and the pick waiting on it. */
	const inFlightStatusRef = useRef<Set<number>>(new Set());
	const queuedStatusRef = useRef<Map<number, number>>(new Map());

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
		registerRefreshTrackerList(() => {
			void loadData();
		});
		return () => registerRefreshTrackerList(null);
	}, [loadData, registerRefreshTrackerList]);

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
				return;
			}

			if (event.type === "tracker.deleted") {
				const payload = event.payload as { key?: string } | undefined;
				const { trackerItemId } = event;
				setItems((prev) =>
					prev.filter((item) => {
						if (payload?.key) return item.key !== payload.key;
						if (trackerItemId != null) return item.id !== trackerItemId;
						return true;
					}),
				);
				return;
			}

			if (
				event.type === "tracker.created" ||
				event.type === "tracker.updated"
			) {
				void loadData();
			}
		});
	}, [subscribeTrackerEvents, loadData]);

	const filteredItems = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return items;
		return items.filter(
			(item) =>
				item.title.toLowerCase().includes(q) ||
				item.key.toLowerCase().includes(q) ||
				(item.description?.toLowerCase().includes(q) ?? false),
		);
	}, [items, search]);

	const grouped = useMemo(
		() => groupItemsByStatus(filteredItems, statuses),
		[filteredItems, statuses],
	);

	const searchActive = search.trim().length > 0;
	const noSearchResults = searchActive && filteredItems.length === 0;

	const openCreate = (statusId?: number) => {
		setCreateStatusId(statusId);
		setCreateOpen(true);
	};

	// Status changes land in the list before the request resolves — the row
	// jumps to its new group at once, and a failure puts it back.
	//
	// One request per item at a time: the rollback restores a snapshot taken
	// before the request, so a slow failure overlapping a newer success would
	// resurrect a stale status. A pick made while a request is in flight waits
	// for it and then runs against the settled item.
	const changeStatus = async (item: TrackerItem, statusId: number) => {
		if (activeWorkspaceId === null || statusId === item.status.id) return;
		const nextStatus = statuses.find((s) => s.id === statusId);
		if (!nextStatus) return;

		if (inFlightStatusRef.current.has(item.id)) {
			queuedStatusRef.current.set(item.id, statusId);
			return;
		}
		inFlightStatusRef.current.add(item.id);
		let settled = item;

		setItems((prev) =>
			prev.map((it) =>
				it.id === item.id ? { ...it, status: nextStatus } : it,
			),
		);
		// Never let a moved row disappear into a collapsed group.
		setCollapsedIds((prev) => {
			if (!prev.has(statusId)) return prev;
			const next = new Set(prev);
			next.delete(statusId);
			return next;
		});
		try {
			const updated = await api.updateTrackerItem(activeWorkspaceId, item.key, {
				statusId,
				version: item.version,
			});
			settled = updated;
			setItems((prev) =>
				prev.map((it) => (it.id === updated.id ? updated : it)),
			);
		} catch (err) {
			setItems((prev) => prev.map((it) => (it.id === item.id ? item : it)));
			if (err instanceof ApiError && err.code === "version_conflict") {
				showToast(
					"Someone else updated this item first — refreshed.",
					"warning",
				);
				// loadData brings fresh versions; a queued pick would carry a stale
				// one straight into another conflict, so it is dropped.
				queuedStatusRef.current.delete(item.id);
				await loadData();
			} else {
				showToast(
					"Couldn't change the status. Check your connection and try again.",
					"error",
				);
			}
		} finally {
			inFlightStatusRef.current.delete(item.id);
			const queued = queuedStatusRef.current.get(item.id);
			if (queued !== undefined) {
				queuedStatusRef.current.delete(item.id);
				void changeStatus(settled, queued);
			}
		}
	};

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
		<div className="min-h-full bg-white">
			{/* Toolbar carries the page's only chrome — the global topbar already
			    names the page, so no hero header competes with the list. */}
			<div className="sticky top-0 z-20 flex items-center gap-3 border-neutral-200 border-b bg-white px-4 py-2 md:px-6">
				<div className="relative min-w-0 flex-1 sm:max-w-xs">
					<Search
						size={14}
						className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-500"
						aria-hidden
					/>
					<input
						type="search"
						placeholder="Search tracker items…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="h-8 w-full rounded-md border border-transparent bg-neutral-100 pr-3 pl-8 text-neutral-900 text-sm placeholder:text-neutral-500 hover:bg-neutral-200/70 focus:border-primary-600 focus:bg-white focus-visible:outline-none"
					/>
				</div>
				<span className="hidden text-neutral-500 text-xs tabular-nums sm:inline">
					{filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}
				</span>
				<button
					type="button"
					aria-label="Create tracker item"
					onClick={() => openCreate()}
					className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary-600 pr-3 pl-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					<Plus size={15} aria-hidden />
					New item
				</button>
			</div>

			{/* Only the first load blanks the list — a refresh triggered by an SSE
			    echo of your own edit must not flash the rows away. */}
			{loading && items.length === 0 ? (
				<p className="px-4 py-8 text-center text-neutral-500 text-sm md:px-6">
					Loading…
				</p>
			) : items.length === 0 ? (
				<EmptyState
					className="px-4 py-16 md:px-6"
					icon={ListTodo}
					title="No items yet"
					description="Track issues and tasks alongside your board. Create the first one to get started."
					action={
						<button
							type="button"
							onClick={() => openCreate()}
							className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary-600 pr-4 pl-3 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<Plus size={16} aria-hidden />
							New item
						</button>
					}
				/>
			) : noSearchResults ? (
				<p className="px-4 py-16 text-center text-neutral-600 text-sm md:px-6">
					No items match “{search.trim()}”.
				</p>
			) : (
				<div>
					{statuses.map((status) => {
						const sectionItems = grouped.get(status.id) ?? [];
						if (searchActive && sectionItems.length === 0) return null;
						return (
							<TrackerSection
								key={status.id}
								status={status}
								items={sectionItems}
								statuses={statuses}
								priorities={priorities}
								collapsed={collapsedIds.has(status.id)}
								onToggle={() => toggleSection(status.id)}
								onCreate={() => openCreate(status.id)}
								onStatusChange={(item, statusId) =>
									void changeStatus(item, statusId)
								}
							/>
						);
					})}
				</div>
			)}

			{createOpen && (
				<TrackerCreateModal
					workspaceId={activeWorkspaceId}
					statuses={statuses}
					priorities={priorities}
					defaultStatusId={createStatusId}
					onClose={() => setCreateOpen(false)}
					onCreated={() => void loadData()}
				/>
			)}
		</div>
	);
}
