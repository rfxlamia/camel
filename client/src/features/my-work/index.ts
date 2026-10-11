import {
	createMyWorkApi,
	type MyWorkActiveCandidateRequest,
	type MyWorkRequest,
} from "./myWork";

// Load transport factories before UI re-exports, which can import the facade.
export { MyWorkPageView, type MyWorkPageViewProps } from "./MyWorkPageView";
export {
	isMyWorkDetailUnavailable,
	type MyWorkDetailSelection,
	type MyWorkDetailState,
	myWorkDetailErrorMessage,
	parseMyWorkDetailState,
	useMyWorkDetailState,
	withMyWorkDetail,
	withoutMyWorkDetail,
} from "./myWorkNavigation";
export { searchMyWorkCandidates } from "./myWorkSearch";
export { sourceItem } from "./myWorkTestSupport";
export {
	type MyWorkViewState,
	parseMyWorkViewState,
	serializeMyWorkViewState,
} from "./myWorkUtils";
export { useDelayedLoading } from "./useDelayedLoading";
export { useMyWorkData } from "./useMyWorkData";
export {
	createMyWorkApi,
	type MyWorkActiveCandidateRequest,
	type MyWorkRequest,
};
