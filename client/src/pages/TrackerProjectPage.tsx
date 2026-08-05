import { ArrowLeft, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api";
import TrackerPhaseSection from "../components/tracker/TrackerPhaseSection";
import { useBoard } from "../context/BoardContext";
import type { TrackerItem, TrackerProject } from "../types";

const NO_PHASE_KEY = "no-phase";

const RELOAD_EVENTS = new Set([
	"tracker.project.created",
	"tracker.project.updated",
	"tracker.project.deleted",
	"tracker.phase.created",
	"tracker.phase.updated",
	"tracker.phase.deleted",
	"tracker.created",
	"tracker.updated",
	"tracker.deleted",
]);

function collapseStorageKey(projectId: number): string {
	return `tracker:phase-collapse:${projectId}`;
}

function readCollapsedPhases(projectId: number): Set<string> {
	try {
		const raw = sessionStorage.getItem(collapseStorageKey(projectId));
		if (!raw) return new Set();
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((v): v is string => typeof v === "string"));
	} catch {
		return new Set();
	}
}

function writeCollapsedPhases(projectId: number, collapsed: Set<string>): void {
	sessionStorage.setItem(
		collapseStorageKey(projectId),
		JSON.stringify([...collapsed]),
	);
}

export default function TrackerProjectPage() {
	const { projectId: projectIdParam } = useParams<{ projectId: string }>();
	const navigate = useNavigate();
	const { activeWorkspaceId, subscribeTrackerEvents } = useBoard();
	const [projects, setProjects] = useState<TrackerProject[]>([]);
	const [items, setItems] = useState<TrackerItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

	const projectId = Number(projectIdParam);
	const projectIdValid = Number.isInteger(projectId) && projectId > 0;

	useEffect(() => {
		if (!projectIdValid) return;
		setCollapsedKeys(readCollapsedPhases(projectId));
	}, [projectId, projectIdValid]);

	const loadData = useCallback(async () => {
		if (activeWorkspaceId === null) return;
		setLoading(true);
		try {
			const [projectList, itemList] = await Promise.all([
				api.listTrackerProjects(activeWorkspaceId),
				api.listTrackerItems(activeWorkspaceId),
			]);
			setProjects(projectList);
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
			if (RELOAD_EVENTS.has(event.type)) {
				void loadData();
			}
		});
	}, [subscribeTrackerEvents, loadData]);

	const project = useMemo(
		() =>
			projectIdValid
				? projects.find((candidate) => candidate.id === projectId)
				: undefined,
		[projects, projectId, projectIdValid],
	);

	const projectItems = useMemo(
		() =>
			project
				? items.filter((item) => item.projectId === project.id)
				: [],
		[items, project],
	);

	const itemsByPhase = useMemo(() => {
		const map = new Map<number | null, TrackerItem[]>();
		for (const item of projectItems) {
			const key = item.phaseId ?? null;
			const bucket = map.get(key) ?? [];
			bucket.push(item);
			map.set(key, bucket);
		}
		return map;
	}, [projectItems]);

	const togglePhase = (key: string) => {
		if (!projectIdValid) return;
		setCollapsedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			writeCollapsedPhases(projectId, next);
			return next;
		});
	};

	if (activeWorkspaceId === null) return null;

	if (!projectIdValid || (!loading && !project)) {
		return (
			<div className="min-h-full bg-white px-4 py-16 text-center md:px-6">
				<p className="text-neutral-600 text-sm">Project not found.</p>
				<button
					type="button"
					onClick={() => navigate("/tracker")}
					className="mt-4 inline-flex items-center gap-1.5 text-primary-600 text-sm hover:text-primary-700"
				>
					<ArrowLeft size={14} aria-hidden />
					Back to Tracker
				</button>
			</div>
		);
	}

	if (loading && !project) {
		return (
			<p className="px-4 py-8 text-center text-neutral-500 text-sm md:px-6">
				Loading…
			</p>
		);
	}

	if (!project) return null;

	const noPhaseItems = itemsByPhase.get(null) ?? [];
	const showNoPhase = noPhaseItems.length > 0;
	const isEmpty = project.phases.length === 0 && projectItems.length === 0;

	return (
		<div className="min-h-full bg-white">
			<div className="sticky top-0 z-20 border-neutral-200 border-b bg-white px-4 py-3 md:px-6">
				<div className="flex items-start gap-3">
					<button
						type="button"
						aria-label="Back to Tracker"
						onClick={() => navigate("/tracker")}
						className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<ArrowLeft size={16} aria-hidden />
					</button>
					<h1 className="min-w-0 flex-1 truncate font-medium text-neutral-900 text-sm">
						{project.name}
					</h1>
				</div>
			</div>

			{isEmpty ? (
				<div className="px-4 py-16 text-center md:px-6">
					<p className="text-neutral-600 text-sm">
						Nothing here yet — add your first phase.
					</p>
					<button
						type="button"
						aria-label="Create first phase"
						className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary-600 px-3 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<Plus size={15} aria-hidden />
						Create phase
					</button>
				</div>
			) : (
				<div>
					{project.phases.map((phase) => {
						const phaseItems = itemsByPhase.get(phase.id) ?? [];
						const phaseKey = String(phase.id);
						return (
							<TrackerPhaseSection
								key={phase.id}
								phase={phase}
								label={phase.name}
								items={phaseItems}
								statuses={[]}
								priorities={[]}
								collapsed={collapsedKeys.has(phaseKey)}
								onToggle={() => togglePhase(phaseKey)}
							/>
						);
					})}
					{showNoPhase && (
						<TrackerPhaseSection
							phase={null}
							label="No phase"
							items={noPhaseItems}
							statuses={[]}
							priorities={[]}
							collapsed={collapsedKeys.has(NO_PHASE_KEY)}
							onToggle={() => togglePhase(NO_PHASE_KEY)}
						/>
					)}
				</div>
			)}
		</div>
	);
}
