import { useCallback, useEffect, useRef, useState } from "react";
import { paginateMyWorkItems } from "../../lib/myWorkSearch";
import { type MyWorkViewState } from "../../lib/myWorkUtils";
import type { MyWorkItem, MyWorkWorkspace } from "../../types/myWork";
import {
	type AllPageCache,
	loadMyWorkRequest,
	myWorkViewKey,
} from "./myWorkDataLoader";

export interface LoadedPage {
	items: MyWorkItem[];
	page: number;
	pageCount: number;
	total: number;
	hasPrevious: boolean;
	hasNext: boolean;
}

export interface LoadError {
	kind: "auth" | "transient";
	message: string;
}

function isSessionError(error: unknown): boolean {
	if (error === null || typeof error !== "object") return false;
	const candidate = error as { status?: number; code?: string };
	return (
		candidate.status === 401 ||
		candidate.code === "unauthorized" ||
		candidate.code === "auth_required" ||
		candidate.code === "session_expired" ||
		candidate.code === "not_authenticated"
	);
}

export function classifyLoadError(error: unknown): LoadError {
	if (isSessionError(error)) {
		return {
			kind: "auth",
			message: "Your session has expired. Sign in again to see your work.",
		};
	}
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message) {
			return { kind: "transient", message };
		}
	}
	return {
		kind: "transient",
		message: "Couldn't load your work. Check your connection and try again.",
	};
}

type DataSnapshot = {
	loaded: LoadedPage | null;
	loading: boolean;
	loadError: LoadError | null;
	workspaceOptions: MyWorkWorkspace[];
};

function useMyWorkDataState(view: MyWorkViewState) {
	const [data, setData] = useState<DataSnapshot>({
		loaded: null,
		loading: true,
		loadError: null,
		workspaceOptions: [],
	});
	const loadSeqRef = useRef(0);
	const viewRef = useRef(view);
	viewRef.current = view;
	const loadedViewKeyRef = useRef<string | null>(null);
	const loadedAllPageRef = useRef<number | null>(null);
	const visibilityWasHiddenRef = useRef(
		typeof document !== "undefined" ? document.hidden : false,
	);
	const allCacheRef = useRef<AllPageCache>({ key: "", pages: new Map() });
	const activeCandidatesRef = useRef<{
		key: string;
		items: MyWorkItem[];
	} | null>(null);
	return {
		...data,
		setData,
		loadSeqRef,
		viewRef,
		loadedViewKeyRef,
		loadedAllPageRef,
		visibilityWasHiddenRef,
		allCacheRef,
		activeCandidatesRef,
		view,
		viewKey: myWorkViewKey(view),
	};
}

type MyWorkDataState = ReturnType<typeof useMyWorkDataState>;

type LoaderContext = Pick<
	MyWorkDataState,
	"setData" | "loadSeqRef" | "viewRef" | "allCacheRef" | "activeCandidatesRef"
>;
type DataSetter = MyWorkDataState["setData"];

function updateData(setData: DataSetter, patch: Partial<DataSnapshot>) {
	setData((previous) => ({ ...previous, ...patch }));
}

function rememberActiveCandidates(
	ref: MyWorkDataState["activeCandidatesRef"],
	key: string,
	items: MyWorkItem[] | undefined,
) {
	if (items) ref.current = { key, items };
}

async function runMyWorkLoad({
	fresh,
	setData,
	loadSeqRef,
	viewRef,
	allCacheRef,
	activeCandidatesRef,
}: LoaderContext & { fresh: boolean }) {
	const requestView = viewRef.current;
	const requestViewKey = myWorkViewKey(requestView);
	const seq = ++loadSeqRef.current;
	const isCurrent = () => seq === loadSeqRef.current;
	updateData(setData, { loading: true, loadError: null, loaded: null });
	try {
		const prepared = await loadMyWorkRequest({
			requestView,
			requestViewKey,
			fresh,
			currentPage: () => viewRef.current.page,
			allCacheRef,
			isCurrent,
		});
		if (!prepared || !isCurrent()) return;
		rememberActiveCandidates(
			activeCandidatesRef,
			requestViewKey,
			prepared.activeCandidates,
		);
		updateData(setData, {
			loaded: prepared.loaded,
			workspaceOptions: prepared.workspaceOptions,
		});
	} catch (error) {
		if (!isCurrent()) return;
		updateData(setData, {
			loaded: null,
			loadError: classifyLoadError(error),
		});
	} finally {
		if (isCurrent()) updateData(setData, { loading: false });
	}
}

function useMyWorkLoader({
	setData,
	loadSeqRef,
	viewRef,
	allCacheRef,
	activeCandidatesRef,
}: MyWorkDataState) {
	return useCallback(
		({ fresh = false }: { fresh?: boolean } = {}) =>
			runMyWorkLoad({
				fresh,
				setData,
				loadSeqRef,
				viewRef,
				allCacheRef,
				activeCandidatesRef,
			}),
		[activeCandidatesRef, allCacheRef, loadSeqRef, setData, viewRef],
	);
}

function useViewLoadEffect(
	{ view, viewKey, loadedViewKeyRef, loadedAllPageRef }: MyWorkDataState,
	loadData: ReturnType<typeof useMyWorkLoader>,
) {
	useEffect(() => {
		const viewChanged = loadedViewKeyRef.current !== viewKey;
		const allPageChanged =
			view.scope === "all" && loadedAllPageRef.current !== view.page;
		if (!viewChanged && !allPageChanged) return;
		loadedViewKeyRef.current = viewKey;
		if (view.scope === "all") loadedAllPageRef.current = view.page;
		void loadData();
	}, [
		loadData,
		view.page,
		view.scope,
		viewKey,
		loadedViewKeyRef,
		loadedAllPageRef,
	]);
}

function useVisibilityRefresh(
	{ visibilityWasHiddenRef }: MyWorkDataState,
	loadData: ReturnType<typeof useMyWorkLoader>,
) {
	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.hidden) {
				visibilityWasHiddenRef.current = true;
				return;
			}
			if (!visibilityWasHiddenRef.current) return;
			visibilityWasHiddenRef.current = false;
			void loadData({ fresh: true });
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange);
	}, [loadData, visibilityWasHiddenRef]);
}

function useMyWorkEffects(
	state: MyWorkDataState,
	loadData: ReturnType<typeof useMyWorkLoader>,
) {
	useViewLoadEffect(state, loadData);
	useVisibilityRefresh(state, loadData);
}

function useMyWorkPageChange({
	view,
	viewKey,
	activeCandidatesRef,
	setData,
}: MyWorkDataState) {
	return useCallback(
		(page: number) => {
			if (
				view.scope === "active" &&
				activeCandidatesRef.current?.key === viewKey
			) {
				const candidates = activeCandidatesRef.current;
				if (!candidates) return;
				setData((previous) => ({
					...previous,
					loaded: paginateMyWorkItems(candidates.items, page),
				}));
			}
		},
		[activeCandidatesRef, setData, view.scope, viewKey],
	);
}

/** Personal request state for the route-driven page; it never reads BoardContext. */
export function useMyWorkData(view: MyWorkViewState) {
	const state = useMyWorkDataState(view);
	const loadData = useMyWorkLoader(state);
	useMyWorkEffects(state, loadData);
	const handlePageChange = useMyWorkPageChange(state);
	return {
		loaded: state.loaded,
		loading: state.loading,
		loadError: state.loadError,
		workspaceOptions: state.workspaceOptions,
		loadData,
		handlePageChange,
	};
}
