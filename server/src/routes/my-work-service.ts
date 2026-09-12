import { createMyWorkMarkDoneService } from "../core/my-work-mark-done.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { createMyWorkDataSource } from "./my-work-data-source.js";
import { hydrateMyWorkRows } from "./my-work-response-hydration.js";
import { createMyWorkDetail } from "./my-work-service-detail.js";
import { createMyWorkList } from "./my-work-service-list.js";
import type { MyWorkHydrate } from "./my-work-service-support.js";
import type {
	MyWorkCandidate,
	MyWorkMarkDoneService,
	MyWorkSerializedItem,
	MyWorkService,
	MyWorkServiceDeps,
	MyWorkWorkspace,
} from "./my-work-types.js";

export { MyWorkUnavailableError } from "./my-work-service-support.js";

function isDbExecutor(value: unknown): value is DBExecutor {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { selectFrom?: unknown }).selectFrom === "function"
	);
}

export function createMyWorkService(
	options: MyWorkServiceDeps | DBExecutor = {},
): MyWorkService {
	const executor = isDbExecutor(options) ? options : (options.executor ?? db);
	const overrides = isDbExecutor(options) ? {} : options;
	const source = {
		...createMyWorkDataSource(executor),
		...overrides,
	};
	const usesBoundedSourceQueries =
		!isDbExecutor(options) &&
		options.listTrackerRows === undefined &&
		options.listBoardRows === undefined;
	const customHydrate = !isDbExecutor(options)
		? options.hydrateRows
		: undefined;
	const hydrate: MyWorkHydrate =
		customHydrate ??
		((
			candidates: readonly MyWorkCandidate[],
			workspaces: ReadonlyMap<number, MyWorkWorkspace>,
		) => hydrateMyWorkRows(executor, candidates, workspaces));
	const list = createMyWorkList(source, hydrate, usesBoundedSourceQueries);
	const getDetail = createMyWorkDetail(source, hydrate);
	const markDone =
		overrides.markDone ??
		createMyWorkMarkDoneService({
			...overrides.markDoneDeps,
			executor: overrides.markDoneDeps?.executor ?? executor,
		}).markDone;
	return {
		list,
		listMyWork: list,
		getDetail,
		getMyWorkItem: getDetail,
		markDone,
		markMyWorkDone: markDone,
	};
}

export type {
	MyWorkMarkDoneService,
	MyWorkSerializedItem,
	MyWorkService,
	MyWorkServiceDeps,
	MyWorkWorkspace,
};
