import { CloudOff, ListTodo, Plus, Rows3, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { ApiError, api } from "../api";
import TrackerCreateModal from "../components/tracker/TrackerCreateModal";
import TrackerProjectCreateModal from "../components/tracker/TrackerProjectCreateModal";
import TrackerProjectsTab from "../components/tracker/TrackerProjectsTab";
import {
	type PickerOption,
	TrackerPropertyPicker,
} from "../components/tracker/TrackerPropertyPicker";
import TrackerSection from "../components/tracker/TrackerSection";
import TrackerTabs, {
	type TrackerTab,
} from "../components/tracker/TrackerTabs";
import { useBoard } from "../context/BoardContext";
import { partitionTrackerSearch } from "../lib/trackerSearch";
import { createItemMutationQueue } from "../lib/trackerItemMutationQueue";
import {
	groupItems,
	priorityGroupKey,
	projectGroupKey,
	sortStatusesByPosition,
	statusGroupKey,
	TRACKER_GROUP_BY_LABELS,
	type TrackerGroupBy,
} from "../lib/trackerUtils";
import {
	readTrackerGroupBy,
	writeTrackerGroupBy,
} from "../lib/trackerViewPrefs";
import type { TrackerItem, TrackerProject, TrackerVocabulary } from "../types";

const GROUP_BY_ORDER: TrackerGroupBy[] = ["status", "project", "priority"];

const PROJECT_RELOAD_EVENTS = new Set([
	"tracker.project.created",
	"tracker.project.updated",
	"tracker.project.deleted",
	"tracker.phase.created",
	"tracker.phase.updated",
	"tracker.phase.deleted",
]);

interface CreateDefaults {
	statusId?: number;
	projectId?: number;
}

export default function TrackerPage() {
	const {
		activeWorkspaceId,
		subscribeTrackerEvents,
		registerRefreshTrackerList,
		showToast,
	} = useBoard();
	const location = useLocation();
	const [searchParams, setSearchParams] = useSearchParams();
	const [statuses, setStatuses] = useState<TrackerVocabulary[]>([]);
	const [priorities, setPriorities] = useState<TrackerVocabulary[]>([]);
	const [items, setItems] = useState<TrackerItem[]>([]);
	const [projects, setProjects] = useState<TrackerProject[]>([]);
	const [search, setSearch] = useState("");
	const [groupBy, setGroupBy] = useState<TrackerGroupBy>("status");
	const [groupByOpen, setGroupByOpen] = useState(false);
	const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
	const [createOpen, setCreateOpen] = useState(false);
	const [projectCreateOpen, setProjectCreateOpen] = useState(false);
	const [createDefaults, setCreateDefaults] = useState<CreateDefaults>({});
	const [loading, setLoading] = useState(true);
	const [loadFailed, setLoadFailed] = useState(false);
	const mutationQueueRef = useRef(createItemMutationQueue());
	const itemsRef = useRef<TrackerItem[]>(items);
	itemsRef.current = items;
	const recoveryBlockedItemIdsRef = useRef(new Set<number>());
	/** Set while this page is the one changing the location, not the router. */
	const skipCollapseResetRef = useRef(false);
	/**
	 * Status ids created via a live SSE event this session. A freshly-created
	 * status stays visible even at zero items — same reasoning as an empty
	 * project — while a status that was already empty on load is noise.
	 */
	const sessionCreatedStatusIdsRef = useRef<Set<number>>(new Set());
	/** Monotonic id so a slower stale loadData cannot clobber a newer one. */
	const loadSeqRef = useRef(0);
	const itemsLenRef = useRef(0);
	const projectsLenRef = useRef(0);
	itemsLenRef.current = items.length;
	projectsLenRef.current = projects.length;

	const tab: TrackerTab =
		searchParams.get("tab") === "projects" ? "projects" : "items";

	const selectTab = (next: TrackerTab) => {
		// Rewriting the query string mints a fresh location key, which would
		// otherwise read as a re-navigation to /tracker and wipe collapse state.
		skipCollapseResetRef.current = true;
		setSearchParams(
			(prev) => {
				const params = new URLSearchParams(prev);
				if (next === "items") params.delete("tab");
				else params.set("tab", next);
				return params;
			},
			{ replace: true },
		);
	};

	// Reset in-memory collapse when React Router re-navigates to /tracker,
	// but not when this page rewrote the query string itself.
	// biome-ignore lint/correctness/useExhaustiveDependencies: location.key is the intentional trigger
	useEffect(() => {
		if (skipCollapseResetRef.current) {
			skipCollapseResetRef.current = false;
			return;
		}
		setCollapsedKeys(new Set());
	}, [location.key]);

	useEffect(() => {
		if (activeWorkspaceId === null) return;
		setGroupBy(readTrackerGroupBy(activeWorkspaceId));
	}, [activeWorkspaceId]);

	const changeGroupBy = (next: TrackerGroupBy) => {
		setGroupBy(next);
		if (activeWorkspaceId !== null)
			writeTrackerGroupBy(activeWorkspaceId, next);
	};

	const replaceItems = useCallback((next: TrackerItem[]) => {
		itemsRef.current = next;
		setItems(next);
	}, []);

	const updateItems = useCallback(
		(updater: (prev: TrackerItem[]) => TrackerItem[]) => {
			const next = updater(itemsRef.current);
			itemsRef.current = next;
			setItems(next);
		},
		[],
	);

	const loadData = useCallback(async (): Promise<boolean> => {
		if (activeWorkspaceId === null) return false;
		const seq = ++loadSeqRef.current;
		// Only the empty first paint needs a full-page spinner; background
		// refreshes keep whatever is already on screen.
		if (itemsLenRef.current === 0 && projectsLenRef.current === 0) {
			setLoading(true);
		}
		try {
			const [statusList, priorityList, itemList, projectList] =
				await Promise.all([
					api.listTrackerVocabularies(activeWorkspaceId, "status"),
					api.listTrackerVocabularies(activeWorkspaceId, "priority"),
					api.listTrackerItems(activeWorkspaceId),
					api.listTrackerProjects(activeWorkspaceId),
				]);
			if (seq !== loadSeqRef.current) return false;
			setStatuses(sortStatusesByPosition(statusList));
			setPriorities(priorityList);
			replaceItems(itemList);
			for (const item of itemList) {
				recoveryBlockedItemIdsRef.current.delete(item.id);
			}
			setProjects(projectList);
			setLoadFailed(false);
			return true;
		} catch {
			if (seq !== loadSeqRef.current) return false;
			// A failed background refresh must not blank a page that already has
			// rows on it, so the retry panel is gated on having nothing to show.
			setLoadFailed(true);
			showToast(
				"Couldn't load the tracker. Check your connection and try again.",
				"error",
			);
			return false;
		} finally {
			if (seq === loadSeqRef.current) {
				setLoading(false);
			}
		}
	}, [activeWorkspaceId, showToast, replaceItems]);

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
				sessionCreatedStatusIdsRef.current.add(vocab.id);
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
				updateItems((prev) =>
					prev.filter((item) => {
						if (payload?.key) return item.key !== payload.key;
						if (trackerItemId != null) return item.id !== trackerItemId;
						return true;
					}),
				);
				return;
			}

			if (PROJECT_RELOAD_EVENTS.has(event.type)) {
				void loadData();
				return;
			}

			if (
				event.type === "tracker.created" ||
				event.type === "tracker.updated"
			) {
				void loadData();
			}
		});
	}, [subscribeTrackerEvents, loadData, updateItems]);

	const { filteredItems, visibleProjects, searchActive } = useMemo(
		() => partitionTrackerSearch(items, projects, search),
		[items, projects, search],
	);

	const groups = useMemo(
		() =>
			groupItems(filteredItems, groupBy, { statuses, priorities, projects }),
		[filteredItems, groupBy, statuses, priorities, projects],
	);

	type ItemPatchBuild = (current: TrackerItem) => {
		request: {
			version: number;
			statusId?: number;
			startDate?: string | null;
			endDate?: string | null;
			projectId?: number | null;
			phaseId?: number | null;
			priorityId?: number | null;
		};
		optimistic: TrackerItem;
		rollback: (latest: TrackerItem) => TrackerItem;
	} | null;

	const uncollapseGroupFor = (
		targetGroupBy: TrackerGroupBy,
		groupKey: string,
	) => {
		setCollapsedKeys((prev) => {
			if (groupBy !== targetGroupBy) return prev;
			if (!prev.has(groupKey)) return prev;
			const next = new Set(prev);
			next.delete(groupKey);
			return next;
		});
	};

	const applyItemPatch = async (
		itemId: number,
		build: ItemPatchBuild,
		errorMessage: string,
	): Promise<void> => {
		if (activeWorkspaceId === null) return;
		if (recoveryBlockedItemIdsRef.current.has(itemId)) return;
		const current = itemsRef.current.find((it) => it.id === itemId);
		if (!current) return;
		const built = build(current);
		if (!built) return;

		const workspaceId = activeWorkspaceId;
		const { request, optimistic, rollback } = built;

		updateItems((prev) =>
			prev.map((it) => (it.id === itemId ? optimistic : it)),
		);
		try {
			const updated = await api.updateTrackerItem(
				workspaceId,
				current.key,
				request,
			);
			updateItems((prev) =>
				prev.map((it) => (it.id === updated.id ? updated : it)),
			);
		} catch (err) {
			updateItems((prev) =>
				prev.map((it) => (it.id === itemId ? rollback(it) : it)),
			);
			if (err instanceof ApiError && err.code === "version_conflict") {
				recoveryBlockedItemIdsRef.current.add(itemId);
				showToast(
					"Someone else updated this item first — refreshed.",
					"warning",
				);
				await loadData();
			} else {
				showToast(errorMessage, "error");
			}
		}
	};

	const groupByOptions: PickerOption[] = GROUP_BY_ORDER.map((option) => ({
		id: option,
		label: TRACKER_GROUP_BY_LABELS[option],
		selected: option === groupBy,
	}));

	const openCreate = (defaults: CreateDefaults = {}) => {
		setCreateDefaults(defaults);
		setCreateOpen(true);
	};

	const changeDate = (
		item: TrackerItem,
		dates: { startDate: string | null; endDate: string | null },
	) => {
		const nextStart = dates.startDate;
		const nextEnd = dates.endDate;
		void mutationQueueRef.current.enqueue(item.id, async () => {
			await applyItemPatch(
				item.id,
				(current) => {
					if (
						(current.startDate ?? null) === nextStart &&
						(current.endDate ?? null) === nextEnd
					) {
						return null;
					}
					return {
						request: {
							startDate: nextStart,
							endDate: nextEnd,
							version: current.version,
						},
						optimistic: {
							...current,
							startDate: nextStart,
							endDate: nextEnd,
						},
						rollback: (latest) => ({
							...latest,
							startDate: current.startDate,
							endDate: current.endDate,
						}),
					};
				},
				"Couldn't update the date. Check your connection and try again.",
			);
		});
	};

	const changeStatus = (item: TrackerItem, statusId: number) => {
		void mutationQueueRef.current.enqueue(item.id, async () => {
			const current = itemsRef.current.find((it) => it.id === item.id);
			if (!current || current.status.id === statusId) return;
			const nextStatus = statuses.find((s) => s.id === statusId);
			if (!nextStatus) return;

			setCollapsedKeys((prev) => {
				const key = statusGroupKey(statusId);
				if (!prev.has(key)) return prev;
				const next = new Set(prev);
				next.delete(key);
				return next;
			});

			await applyItemPatch(
				item.id,
				(c) => ({
					request: { statusId, version: c.version },
					optimistic: { ...c, status: nextStatus },
					rollback: (latest) => ({ ...latest, status: current.status }),
				}),
				"Couldn't change the status. Check your connection and try again.",
			);
		});
	};

	const changeProject = (item: TrackerItem, projectId: number) => {
		void mutationQueueRef.current.enqueue(item.id, async () => {
			const current = itemsRef.current.find((it) => it.id === item.id);
			if (!current || current.projectId === projectId) return;

			uncollapseGroupFor("project", projectGroupKey(projectId));

			await applyItemPatch(
				item.id,
				(c) => ({
					request: {
						projectId,
						phaseId: null,
						version: c.version,
					},
					optimistic: { ...c, projectId, phaseId: null },
					rollback: (latest) => ({
						...latest,
						projectId: current.projectId ?? null,
						phaseId: current.phaseId ?? null,
					}),
				}),
				"Couldn't change the project. Check your connection and try again.",
			);
		});
	};

	const changePriority = (item: TrackerItem, priorityId: number | null) => {
		void mutationQueueRef.current.enqueue(item.id, async () => {
			const current = itemsRef.current.find((it) => it.id === item.id);
			if (!current) return;

			uncollapseGroupFor("priority", priorityGroupKey(priorityId));

			await applyItemPatch(
				item.id,
				(c) => {
					const currentPriorityId = c.priority?.id ?? null;
					if (currentPriorityId === priorityId) return null;

					const nextPriority =
						priorityId === null
							? null
							: (priorities.find((p) => p.id === priorityId) ?? null);
					if (priorityId !== null && nextPriority === null) return null;

					return {
						request: { priorityId, version: c.version },
						optimistic: { ...c, priority: nextPriority },
						rollback: (latest) => ({ ...latest, priority: current.priority }),
					};
				},
				"Couldn't change the priority. Check your connection and try again.",
			);
		});
	};

	const changePhase = (item: TrackerItem, phaseId: number) => {
		void mutationQueueRef.current.enqueue(item.id, async () => {
			await applyItemPatch(
				item.id,
				(current) => {
					if (current.phaseId === phaseId) return null;
					return {
						request: {
							projectId: current.projectId ?? null,
							phaseId,
							version: current.version,
						},
						optimistic: { ...current, phaseId },
						rollback: (latest) => ({
							...latest,
							phaseId: current.phaseId ?? null,
						}),
					};
				},
				"Couldn't change the phase. Check your connection and try again.",
			);
		});
	};

	const toggleSection = (key: string) => {
		setCollapsedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	if (activeWorkspaceId === null) return null;

	const projectsTab = tab === "projects";

	return (
		<div className="min-h-full">
			<div className="sticky top-0 z-20 bg-white">
				<TrackerTabs
					value={tab}
					itemCount={items.length}
					projectCount={projects.length}
					onChange={selectTab}
				/>
				<div className="flex items-center gap-3 border-neutral-200 border-b px-4 py-2 md:px-6">
					<div className="relative min-w-0 flex-1 sm:max-w-xs">
						<Search
							size={14}
							className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-500"
							aria-hidden
						/>
						<input
							type="search"
							aria-label={
								projectsTab
									? "Search projects or items"
									: "Search tracker items"
							}
							placeholder={
								projectsTab
									? "Search projects or items…"
									: "Search tracker items…"
							}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="h-8 w-full rounded-md border border-transparent bg-neutral-100 pr-3 pl-8 text-neutral-900 text-sm placeholder:text-neutral-500 hover:bg-neutral-200/70 focus:border-primary-600 focus:bg-white focus-visible:outline-none"
						/>
					</div>
					{!projectsTab && (
						<TrackerPropertyPicker
							placeholder="Group by"
							triggerLabel={`Group by: ${TRACKER_GROUP_BY_LABELS[groupBy]}`}
							value={TRACKER_GROUP_BY_LABELS[groupBy]}
							icon={
								<Rows3 size={14} className="text-neutral-500" aria-hidden />
							}
							searchPlaceholder="Group by…"
							options={groupByOptions}
							open={groupByOpen}
							onOpenChange={setGroupByOpen}
							onSelect={(id) => changeGroupBy(id as TrackerGroupBy)}
						/>
					)}
					<span className="hidden text-neutral-500 text-xs tabular-nums sm:inline">
						{projectsTab
							? `${visibleProjects.length} project${visibleProjects.length === 1 ? "" : "s"}`
							: `${filteredItems.length} item${filteredItems.length === 1 ? "" : "s"}`}
					</span>
					{projectsTab ? (
						<button
							type="button"
							aria-label="New project"
							onClick={() => setProjectCreateOpen(true)}
							className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary-600 pr-3 pl-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-700 active:bg-primary-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<Plus size={15} aria-hidden />
							New project
						</button>
					) : (
						<button
							type="button"
							onClick={() => openCreate()}
							className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary-600 pr-3 pl-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-700 active:bg-primary-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<Plus size={15} aria-hidden />
							New item
						</button>
					)}
				</div>
			</div>

			{loadFailed && items.length === 0 && projects.length === 0 ? (
				<div className="flex flex-col items-center px-4 py-16 text-center md:px-6">
					<CloudOff size={20} className="text-neutral-400" aria-hidden />
					<p className="mt-3 font-medium text-neutral-900 text-sm">
						Couldn't load the tracker
					</p>
					<p className="mt-1 max-w-sm text-neutral-600 text-sm">
						Check your connection and try again.
					</p>
					<button
						type="button"
						onClick={() => void loadData()}
						disabled={loading}
						className="mt-4 inline-flex h-8 items-center rounded-md border border-neutral-300 bg-neutral-100 px-3 font-medium text-primary-700 text-sm transition-colors hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:text-neutral-400"
					>
						{loading ? "Retrying…" : "Try again"}
					</button>
				</div>
			) : loading && items.length === 0 && projects.length === 0 ? (
				<p className="px-4 py-8 text-center text-neutral-500 text-sm md:px-6">
					Loading…
				</p>
			) : projectsTab ? (
				<TrackerProjectsTab
					visibleProjects={visibleProjects}
					items={items}
					searchActive={searchActive}
					search={search}
					onNewProject={() => setProjectCreateOpen(true)}
				/>
			) : searchActive && filteredItems.length === 0 ? (
				<p className="px-4 py-16 text-center text-neutral-600 text-sm md:px-6">
					No items match “{search.trim()}”.
				</p>
			) : items.length === 0 ? (
				<div className="flex flex-col items-center px-4 py-16 text-center md:px-6">
					<ListTodo size={20} className="text-neutral-400" aria-hidden />
					<p className="mt-3 font-medium text-neutral-900 text-sm">
						Nothing tracked yet
					</p>
					<p className="mt-1 max-w-sm text-neutral-600 text-sm">
						Items live here whether or not they belong to a project. Create one
						to get started.
					</p>
					<button
						type="button"
						onClick={() => openCreate()}
						className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary-600 pr-3 pl-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<Plus size={15} aria-hidden />
						Create your first item
					</button>
				</div>
			) : (
				<div>
					{groups.map((group) => {
						// A group with no hits is noise while searching (any kind), and
						// an empty status/priority band is noise even outside search —
						// but an empty project, or a status just created this session,
						// keeps its header: it's a real thing the user made, not a vocab
						// bucket that has always been empty.
						const isFreshlyCreatedStatus =
							group.status != null &&
							sessionCreatedStatusIdsRef.current.has(group.status.id);
						if (
							group.items.length === 0 &&
							(searchActive ||
								(group.projectId == null && !isFreshlyCreatedStatus))
						) {
							return null;
						}
						const createDefaultsForGroup: CreateDefaults | null = group.status
							? { statusId: group.status.id }
							: group.projectId != null
								? { projectId: group.projectId }
								: null;
						return (
							<TrackerSection
								key={group.key}
								group={group}
								statuses={statuses}
								priorities={priorities}
								collapsed={collapsedKeys.has(group.key)}
								onToggle={() => toggleSection(group.key)}
								onCreate={
									createDefaultsForGroup
										? () => openCreate(createDefaultsForGroup)
										: undefined
								}
								onStatusChange={(item, statusId) =>
									void changeStatus(item, statusId)
								}
								onDateChange={(item, dates) => changeDate(item, dates)}
								onPriorityChange={(item, priorityId) =>
									changePriority(item, priorityId)
								}
								onProjectChange={(item, projectId) =>
									changeProject(item, projectId)
								}
								onPhaseChange={(item, phaseId) => changePhase(item, phaseId)}
								projects={projects}
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
					defaultStatusId={createDefaults.statusId}
					defaultProjectId={createDefaults.projectId}
					onClose={() => setCreateOpen(false)}
					onCreated={() => void loadData()}
				/>
			)}

			{projectCreateOpen && (
				<TrackerProjectCreateModal
					workspaceId={activeWorkspaceId}
					onClose={() => setProjectCreateOpen(false)}
					onCreated={() => void loadData()}
				/>
			)}
		</div>
	);
}
