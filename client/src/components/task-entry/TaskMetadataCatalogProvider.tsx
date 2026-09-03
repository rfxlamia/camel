import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { api } from "../../api";
import type { TrackerProject, TrackerVocabulary, WorkspaceMember } from "../../types";

export type TaskMetadataCatalogKey =
	| "assignee"
	| "priority"
	| "label"
	| "status"
	| "project";

type CatalogItems = {
	assignee: WorkspaceMember[];
	priority: TrackerVocabulary[];
	label: TrackerVocabulary[];
	status: TrackerVocabulary[];
	project: TrackerProject[];
};

export type TaskMetadataCatalogEntry<K extends TaskMetadataCatalogKey> =
	| { status: "loading" }
	| { status: "ready"; items: CatalogItems[K] }
	| { status: "empty" }
	| { status: "failed"; error: string };

export interface TaskMetadataCatalogs {
	assignee: TaskMetadataCatalogEntry<"assignee">;
	priority: TaskMetadataCatalogEntry<"priority">;
	label: TaskMetadataCatalogEntry<"label">;
	status: TaskMetadataCatalogEntry<"status">;
	project: TaskMetadataCatalogEntry<"project">;
	retry: (key: TaskMetadataCatalogKey) => void;
}

const loadingCatalogs = (): Omit<TaskMetadataCatalogs, "retry"> => ({
	assignee: { status: "loading" },
	priority: { status: "loading" },
	label: { status: "loading" },
	status: { status: "loading" },
	project: { status: "loading" },
});

const TaskMetadataCatalogContext = createContext<TaskMetadataCatalogs | null>(null);

const LOADERS: {
	[K in TaskMetadataCatalogKey]: (workspaceId: number) => Promise<CatalogItems[K]>;
} = {
	assignee: (workspaceId) =>
		api.getWorkspaceMembers(workspaceId).then((result) => result.members),
	priority: (workspaceId) => api.listTrackerVocabularies(workspaceId, "priority"),
	label: (workspaceId) => api.listTrackerVocabularies(workspaceId, "label"),
	status: (workspaceId) => api.listTrackerVocabularies(workspaceId, "status"),
	project: (workspaceId) => api.listTrackerProjects(workspaceId),
};

function conciseCatalogError(key: TaskMetadataCatalogKey, error: unknown): string {
	const fallback = {
		assignee: "Couldn't load assignees.",
		priority: "Couldn't load priorities.",
		label: "Couldn't load labels.",
		status: "Couldn't load statuses.",
		project: "Couldn't load projects.",
	}[key];
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	return fallback;
}

function toCatalogEntry<K extends TaskMetadataCatalogKey>(
	key: K,
	items: CatalogItems[K],
): TaskMetadataCatalogEntry<K> {
	if (items.length === 0) {
		return { status: "empty" };
	}
	return { status: "ready", items };
}

export function TaskMetadataCatalogProvider({
	workspaceId,
	children,
}: {
	workspaceId: number | null;
	children: ReactNode;
}) {
	const [catalogs, setCatalogs] = useState<Omit<TaskMetadataCatalogs, "retry">>(
		loadingCatalogs,
	);
	const loadSeqRef = useRef(0);
	const inFlightRef = useRef(
		new Map<string, Promise<TaskMetadataCatalogEntry<TaskMetadataCatalogKey>>>(),
	);

	const loadCatalog = useCallback(
		async (
			key: TaskMetadataCatalogKey,
			activeWorkspaceId: number,
			expectedSeq: number,
		) => {
			const isActive = () => expectedSeq === loadSeqRef.current;
			const cacheKey = `${activeWorkspaceId}:${key}`;
			const existing = inFlightRef.current.get(cacheKey);
			if (existing) {
				const entry = await existing;
				if (!isActive()) return;
				setCatalogs((prev) => ({ ...prev, [key]: entry }));
				return;
			}

			if (!isActive()) return;
			setCatalogs((prev) => ({ ...prev, [key]: { status: "loading" } }));

			const request = LOADERS[key](activeWorkspaceId)
				.then((items) => toCatalogEntry(key, items))
				.catch((error) => ({
					status: "failed" as const,
					error: conciseCatalogError(key, error),
				}))
				.finally(() => {
					inFlightRef.current.delete(cacheKey);
				});

			inFlightRef.current.set(cacheKey, request);
			const entry = await request;
			if (!isActive()) return;
			setCatalogs((prev) => ({ ...prev, [key]: entry }));
		},
		[],
	);

	const retry = useCallback(
		(key: TaskMetadataCatalogKey) => {
			if (workspaceId === null) return;
			const cacheKey = `${workspaceId}:${key}`;
			inFlightRef.current.delete(cacheKey);
			void loadCatalog(key, workspaceId, loadSeqRef.current);
		},
		[loadCatalog, workspaceId],
	);

	useEffect(() => {
		if (workspaceId === null) {
			setCatalogs(loadingCatalogs());
			return;
		}

		const seq = ++loadSeqRef.current;
		setCatalogs(loadingCatalogs());
		const keys = Object.keys(LOADERS) as TaskMetadataCatalogKey[];
		for (const key of keys) {
			void loadCatalog(key, workspaceId, seq);
		}
	}, [loadCatalog, workspaceId]);

	const value = useMemo<TaskMetadataCatalogs>(
		() => ({
			...catalogs,
			retry,
		}),
		[catalogs, retry],
	);

	return (
		<TaskMetadataCatalogContext.Provider value={value}>
			{children}
		</TaskMetadataCatalogContext.Provider>
	);
}

export function useTaskMetadataCatalogs(): TaskMetadataCatalogs {
	const value = useContext(TaskMetadataCatalogContext);
	if (!value) {
		throw new Error("useTaskMetadataCatalogs must be used within TaskMetadataCatalogProvider");
	}
	return value;
}
