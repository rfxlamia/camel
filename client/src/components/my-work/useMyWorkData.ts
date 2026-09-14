import { useCallback, useEffect, useRef, useState } from "react";
import { type MyWorkViewState } from "../../lib/myWorkUtils";
import type { MyWorkItem, MyWorkWorkspace } from "../../types/myWork";
import {
	type AllPageCache,
	activeLoadedPage,
	loadMyWorkRequest,
	mergeWorkspaceOptions,
	myWorkLoadIdentity,
	myWorkRequestKey,
} from "./myWorkDataLoader";

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
	const loadedRequestKeyRef = useRef<string | null>(null);
	const loadedAllPageRef = useRef<number | null>(null);
	const displayedIdentityRef = useRef<string | null>(null);
	const visibilityWasHiddenRef = useRef(
		typeof document !== "undefined" ? document.hidden : false,
	);
	const allCacheRef = useRef<AllPageCache>({ key: "", pages: new Map() });
	const activeCandidatesRef = useRef<ActiveCandidates | null>(null);
	const [detailRefreshToken, setDetailRefreshToken] = useState(0);
	return {
		...data,
		detailRefreshToken,
		setDetailRefreshToken,
		setData,
		loadSeqRef,
		viewRef,
		loadedRequestKeyRef,
		loadedAllPageRef,
		displayedIdentityRef,
		visibilityWasHiddenRef,
		allCacheRef,
		activeCandidatesRef,
		view,
		requestKey: myWorkRequestKey(view),
	};
}

type MyWorkDataState = ReturnType<typeof useMyWorkDataState>;

type LoaderContext = Pick<
	MyWorkDataState,
	| "setData"
	| "loadSeqRef"
	| "viewRef"
	| "allCacheRef"
	| "activeCandidatesRef"
	| "displayedIdentityRef"
	| "setDetailRefreshToken"
>;
type DataSetter = MyWorkDataState["setData"];

function updateData(setData: DataSetter, patch: Partial<DataSnapshot>) {
	setData((previous) => ({ ...previous, ...patch }));
}

function rememberActiveCandidates(
	ref: MyWorkDataState["activeCandidatesRef"],
	key: string,
	items: MyWorkItem[] | undefined,
	candidateSetIncomplete: boolean,
) {
	if (items) ref.current = { key, items, candidateSetIncomplete };
}

async function runMyWorkLoad({
	fresh,
	refreshDetail,
	setData,
	loadSeqRef,
	viewRef,
	requestKey,
	allCacheRef,
	activeCandidatesRef,
	displayedIdentityRef,
	setDetailRefreshToken,
}: LoaderContext & {
	fresh: boolean;
	refreshDetail: boolean;
	requestKey: string;
}) {
	const requestView = viewRef.current;
	const identity = myWorkLoadIdentity(requestView);
	const seq = ++loadSeqRef.current;
	const isCurrent = () => seq === loadSeqRef.current;
	const retainLoaded = displayedIdentityRef.current === identity;
	updateData(setData, {
		loading: true,
		loadError: null,
		...(retainLoaded ? {} : { loaded: null }),
	});
	try {
		const prepared = await loadMyWorkRequest({
			requestView,
			requestViewKey: requestKey,
			fresh,
			currentPage: () => viewRef.current.page,
			allCacheRef,
			isCurrent,
		});
		if (!prepared || !isCurrent()) return;
		rememberActiveCandidates(
			activeCandidatesRef,
			requestKey,
			prepared.activeCandidates,
			Boolean(prepared.loaded.candidateSetIncomplete),
		);
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
	requestKey,
	allCacheRef,
	activeCandidatesRef,
	displayedIdentityRef,
	setDetailRefreshToken,
}: MyWorkDataState) {
	return useCallback(
		({
			fresh = false,
			refreshDetail = fresh,
		}: {
			fresh?: boolean;
			refreshDetail?: boolean;
		} = {}) =>
			runMyWorkLoad({
				fresh,
				refreshDetail,
				setData,
				loadSeqRef,
				viewRef,
				requestKey,
				allCacheRef,
				activeCandidatesRef,
				displayedIdentityRef,
				setDetailRefreshToken,
			}),
		[
			activeCandidatesRef,
			allCacheRef,
			displayedIdentityRef,
			loadSeqRef,
			requestKey,
			setData,
			setDetailRefreshToken,
			viewRef,
		],
	);
}

function useViewLoadEffect(
	{ view, requestKey, loadedRequestKeyRef, loadedAllPageRef }: MyWorkDataState,
	loadData: ReturnType<typeof useMyWorkLoader>,
) {
	useEffect(() => {
		const requestChanged = loadedRequestKeyRef.current !== requestKey;
		const allPageChanged =
			view.scope === "all" && loadedAllPageRef.current !== view.page;
		if (!requestChanged && !allPageChanged) return;
		loadedRequestKeyRef.current = requestKey;
		if (view.scope === "all") loadedAllPageRef.current = view.page;
		void loadData();
	}, [
		loadData,
		view.scope,
		view.page,
		requestKey,
		loadedRequestKeyRef,
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

function useActiveSearchEffect({
	view,
	requestKey,
	activeCandidatesRef,
	setData,
}: MyWorkDataState) {
	useEffect(() => {
		if (view.scope !== "active") return;
		if (activeCandidatesRef.current?.key !== requestKey) return;
		const candidates = activeCandidatesRef.current;
		if (!candidates) return;
		setData((previous) => ({
			...previous,
			loaded: activeLoadedPage(
				candidates.items,
				view,
				candidates.candidateSetIncomplete,
			),
		}));
	}, [view, requestKey, activeCandidatesRef, setData]);
}

function useMyWorkEffects(
	state: MyWorkDataState,
	loadData: ReturnType<typeof useMyWorkLoader>,
) {
	useViewLoadEffect(state, loadData);
	useVisibilityRefresh(state, loadData);
	useActiveSearchEffect(state);
}

function useMyWorkPageChange({
	view,
	requestKey,
	activeCandidatesRef,
	setData,
}: MyWorkDataState) {
	return useCallback(
		(page: number) => {
			if (
				view.scope === "active" &&
				activeCandidatesRef.current?.key === requestKey
			) {
				const candidates = activeCandidatesRef.current;
				if (!candidates) return;
				setData((previous) => ({
					...previous,
					loaded: activeLoadedPage(
						candidates.items,
						{ ...view, page },
						candidates.candidateSetIncomplete,
					),
				}));
			}
		},
		[activeCandidatesRef, requestKey, setData, view],
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
		detailRefreshToken: state.detailRefreshToken,
		loadData,
		handlePageChange,
	};
}
