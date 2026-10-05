import { useCallback, useEffect, useRef, useState } from "react";
import type { MyWorkItem, MyWorkWorkspace } from "../../shared/myWorkTypes";
import {
	type AllPageCache,
	activeLoadedPage,
	loadMyWorkRequest,
	mergeWorkspaceOptions,
	myWorkLoadIdentity,
	myWorkRequestKey,
} from "./myWorkDataLoader";
import type { MyWorkViewState } from "./myWorkUtils";

export interface LoadedPage {
	items: MyWorkItem[];
	page: number;
	pageCount: number;
	total: number;
	hasPrevious: boolean;
	hasNext: boolean;
	candidateSetIncomplete?: boolean;
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

type ActiveCandidates = {
	key: string;
	items: MyWorkItem[];
	candidateSetIncomplete: boolean;
};

interface LoadOptions {
	fresh?: boolean;
	refreshDetail?: boolean;
}

/** Personal request state for the route-driven page; it never reads BoardContext. */
export function useMyWorkData(view: MyWorkViewState) {
	const [data, setData] = useState<DataSnapshot>({
		loaded: null,
		loading: true,
		loadError: null,
		workspaceOptions: [],
	});
	const [detailRefreshToken, setDetailRefreshToken] = useState(0);
	const loadSeqRef = useRef(0);
	const viewRef = useRef(view);
	const loadedRequestKeyRef = useRef<string | null>(null);
	const loadedAllPageRef = useRef<number | null>(null);
	const displayedIdentityRef = useRef<string | null>(null);
	const visibilityWasHiddenRef = useRef(
		typeof document !== "undefined" ? document.hidden : false,
	);
	const allCacheRef = useRef<AllPageCache>({ key: "", pages: new Map() });
	const activeCandidatesRef = useRef<ActiveCandidates | null>(null);
	const requestKey = myWorkRequestKey(view);

	// Declared before the effects below so they read the committed view. loadData
	// derives its request key from the same snapshot it reads, so a caller that
	// runs before this effect flushes can't cache one view's data under another's key.
	useEffect(() => {
		viewRef.current = view;
	}, [view]);

	const patchData = useCallback((patch: Partial<DataSnapshot>) => {
		setData((previous) => ({ ...previous, ...patch }));
	}, []);

	const loadData = useCallback(
		async ({ fresh = false, refreshDetail = fresh }: LoadOptions = {}) => {
			const requestView = viewRef.current;
			const requestViewKey = myWorkRequestKey(requestView);
			const identity = myWorkLoadIdentity(requestView);
			const seq = ++loadSeqRef.current;
			const isCurrent = () => seq === loadSeqRef.current;
			const retainLoaded = displayedIdentityRef.current === identity;
			patchData({
				loading: true,
				loadError: null,
				...(retainLoaded ? {} : { loaded: null }),
			});
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
				if (prepared.activeCandidates) {
					activeCandidatesRef.current = {
						key: requestViewKey,
						items: prepared.activeCandidates,
						candidateSetIncomplete: Boolean(
							prepared.loaded.candidateSetIncomplete,
						),
					};
				}
				displayedIdentityRef.current = identity;
				setData((previous) => ({
					...previous,
					loaded: prepared.loaded,
					workspaceOptions: mergeWorkspaceOptions(
						previous.workspaceOptions,
						prepared.workspaceItems,
					),
				}));
				if (fresh && refreshDetail) {
					setDetailRefreshToken((token) => token + 1);
				}
			} catch (error) {
				if (!isCurrent()) return;
				patchData({ loaded: null, loadError: classifyLoadError(error) });
			} finally {
				if (isCurrent()) patchData({ loading: false });
			}
		},
		[patchData],
	);

	useEffect(() => {
		const requestChanged = loadedRequestKeyRef.current !== requestKey;
		const allPageChanged =
			view.scope === "all" && loadedAllPageRef.current !== view.page;
		if (!requestChanged && !allPageChanged) return;
		loadedRequestKeyRef.current = requestKey;
		if (view.scope === "all") loadedAllPageRef.current = view.page;
		void loadData();
	}, [loadData, view.scope, view.page, requestKey]);

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
	}, [loadData]);

	useEffect(() => {
		if (view.scope !== "active") return;
		const candidates = activeCandidatesRef.current;
		if (candidates?.key !== requestKey) return;
		setData((previous) => ({
			...previous,
			loaded: activeLoadedPage(
				candidates.items,
				view,
				candidates.candidateSetIncomplete,
			),
		}));
	}, [view, requestKey]);

	const handlePageChange = useCallback(
		(page: number) => {
			const candidates = activeCandidatesRef.current;
			if (view.scope !== "active" || candidates?.key !== requestKey) return;
			setData((previous) => ({
				...previous,
				loaded: activeLoadedPage(
					candidates.items,
					{ ...view, page },
					candidates.candidateSetIncomplete,
				),
			}));
		},
		[requestKey, view],
	);

	return {
		loaded: data.loaded,
		loading: data.loading,
		loadError: data.loadError,
		workspaceOptions: data.workspaceOptions,
		detailRefreshToken,
		loadData,
		handlePageChange,
	};
}
