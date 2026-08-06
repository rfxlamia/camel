import { ListTodo, Plus, Rows3, Search } from "lucide-react";
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
import {
	TRACKER_GROUP_BY_LABELS,
	type TrackerGroupBy,
	groupItems,
	sortStatusesByPosition,
	statusGroupKey,
} from "../lib/trackerUtils";
import {
	readTrackerGroupBy,
	writeTrackerGroupBy,
} from "../lib/trackerViewPrefs";
import type { TrackerItem, TrackerProject, TrackerVocabulary } from "../types";

const TRACKER_PROJECT_LIMIT = 10;
const TRACKER_PROJECT_CAP_MESSAGE = `You've reached the project limit (${TRACKER_PROJECT_LIMIT}).`;

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
	/** Item ids with a status request in flight, and the pick waiting on it. */
	const inFlightStatusRef = useRef<Set<number>>(new Set());
	const queuedStatusRef = useRef<Map<number, number>>(new Map());
	/** Set while this page is the one changing the location, not the router. */
	const skipCollapseResetRef = useRef(false);

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
		if (activeWorkspaceId !== null) writeTrackerGroupBy(activeWorkspaceId, next);
	};

	const loadData = useCallback(async () => {
		if (activeWorkspaceId === null) return;
		setLoading(true);
		try {
			const [statusList, priorityList, itemList, projectList] =
				await Promise.all([
					api.listTrackerVocabularies(activeWorkspaceId, "status"),
					api.listTrackerVocabularies(activeWorkspaceId, "priority"),
					api.listTrackerItems(activeWorkspaceId),
					api.listTrackerProjects(activeWorkspaceId),
				]);
			setStatuses(sortStatusesByPosition(statusList));
			setPriorities(priorityList);
			setItems(itemList);
			setProjects(projectList);
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
	}, [subscribeTrackerEvents, loadData]);

	const { filteredItems, visibleProjects, searchActive } = useMemo(
		() => partitionTrackerSearch(items, projects, search),
		[items, projects, search],
	);

	const groups = useMemo(
		() => groupItems(filteredItems, groupBy, { statuses, priorities, projects }),
		[filteredItems, groupBy, statuses, priorities, projects],
	);

	const projectNames = useMemo(
		() => new Map(projects.map((project) => [project.id, project.name])),
		[projects],
	);

	const groupByOptions: PickerOption[] = GROUP_BY_ORDER.map((option) => ({
		id: option,
		label: TRACKER_GROUP_BY_LABELS[option],
		selected: option === groupBy,
	}));

	const atProjectCap = projects.length >= TRACKER_PROJECT_LIMIT;

	const openCreate = (defaults: CreateDefaults = {}) => {
		setCreateDefaults(defaults);
		setCreateOpen(true);
	};

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
		setCollapsedKeys((prev) => {
			const key = statusGroupKey(statusId);
			if (!prev.has(key)) return prev;
			const next = new Set(prev);
			next.delete(key);
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
			const priorStatus = item.status;
			setItems((prev) =>
				prev.map((it) =>
					it.id === item.id ? { ...it, status: priorStatus } : it,
				),
			);
			if (err instanceof ApiError && err.code === "version_conflict") {
				showToast(
					"Someone else updated this item first — refreshed.",
					"warning",
				);
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
		<div className="min-h-full bg-white">
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
							placeholder={
								projectsTab ? "Search projects…" : "Search tracker items…"
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
							disabled={atProjectCap}
							title={atProjectCap ? TRACKER_PROJECT_CAP_MESSAGE : undefined}
							onClick={() => setProjectCreateOpen(true)}
							className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary-600 pr-3 pl-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Plus size={15} aria-hidden />
							New project
						</button>
					) : (
						<button
							type="button"
							aria-label="Create tracker item"
							onClick={() => openCreate()}
							className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary-600 pr-3 pl-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<Plus size={15} aria-hidden />
							New item
						</button>
					)}
				</div>
			</div>

			{loading && items.length === 0 ? (
				<p className="px-4 py-8 text-center text-neutral-500 text-sm md:px-6">
					Loading…
				</p>
			) : projectsTab ? (
				<TrackerProjectsTab
					visibleProjects={visibleProjects}
					items={items}
					searchActive={searchActive}
					search={search}
					atProjectCap={atProjectCap}
					capMessage={TRACKER_PROJECT_CAP_MESSAGE}
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
						New item
					</button>
				</div>
			) : (
				<div>
					{groups.map((group) => {
						// While searching, a group with no hits is noise.
						if (searchActive && group.items.length === 0) return null;
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
								projectNames={projectNames}
								showProjectChip={groupBy !== "project"}
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
