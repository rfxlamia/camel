import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { MyWorkPageView } from "../components/my-work/MyWorkPageView";
import { useMyWorkData } from "../components/my-work/useMyWorkData";
import {
	parseMyWorkDetailState,
	withMyWorkDetail,
	withoutMyWorkDetail,
} from "../lib/myWorkNavigation";
import type { MyWorkViewState } from "../lib/myWorkUtils";
import {
	parseMyWorkViewState,
	serializeMyWorkViewState,
} from "../lib/myWorkUtils";
import type { MyWorkItem } from "../shared/myWorkTypes";

type SearchParamSetter = ReturnType<typeof useSearchParams>[1];

/** Global, route-driven personal work list. It never reads the active workspace. */
export default function MyWorkPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const view = useMemo(
		() => parseMyWorkViewState(searchParams),
		[searchParams],
	);
	const detailSelection = useMemo(
		() => parseMyWorkDetailState(searchParams),
		[searchParams],
	);
	const {
		loaded,
		loading,
		loadError,
		workspaceOptions,
		loadData,
		handlePageChange: setLoadedPage,
		detailRefreshToken,
	} = useMyWorkData(view);
	const { updateView, handlePageChange } = useMyWorkViewActions(
		view,
		setSearchParams,
		setLoadedPage,
	);
	const openDetail = useCallback(
		(item: MyWorkItem) => {
			setSearchParams(withMyWorkDetail(searchParams, item.identity));
		},
		[searchParams, setSearchParams],
	);
	const closeDetail = useCallback(() => {
		setSearchParams(withoutMyWorkDetail(searchParams), { replace: true });
	}, [searchParams, setSearchParams]);
	return (
		<MyWorkPageView
			view={view}
			detailSelection={detailSelection}
			loaded={loaded}
			loading={loading}
			loadError={loadError}
			workspaceOptions={workspaceOptions}
			updateView={updateView}
			handlePageChange={handlePageChange}
			onRefresh={() => void loadData({ fresh: true, refreshDetail: true })}
			onListRefresh={() => void loadData({ fresh: true, refreshDetail: false })}
			onRetry={() => void loadData({ fresh: true, refreshDetail: true })}
			onSelect={openDetail}
			onCloseDetail={closeDetail}
			detailRefreshToken={detailRefreshToken}
		/>
	);
}

function useMyWorkViewActions(
	view: MyWorkViewState,
	setSearchParams: SearchParamSetter,
	setLoadedPage: (page: number) => void,
) {
	const updateView = useCallback(
		(
			patch: Partial<MyWorkViewState>,
			{ resetPage = true }: { resetPage?: boolean } = {},
		) => {
			const next = { ...view, ...patch };
			if (resetPage) next.page = 1;
			setSearchParams(serializeMyWorkViewState(next), { replace: true });
		},
		[setSearchParams, view],
	);
	const handlePageChange = useCallback(
		(page: number) => {
			setLoadedPage(page);
			updateView({ page }, { resetPage: false });
		},
		[setLoadedPage, updateView],
	);
	return { updateView, handlePageChange };
}
