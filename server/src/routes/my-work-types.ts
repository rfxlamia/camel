import type {
	MyWorkMarkDoneDeps,
	MyWorkMarkDoneInput,
	MyWorkMarkDoneResult,
} from "../core/my-work-mark-done.js";
import type { DBExecutor } from "../db/kysely.js";
import type { CardAssignee } from "./card-assignees.js";
import type { TrackerItemAssignee } from "./tracker-assignees.js";
import type { VocabularyRow } from "../lib/vocabulary-response.js";
import type { BoardWorkItemRow, TrackerItemRow } from "../lib/work-item-response.js";

export type MyWorkSource = "board" | "tracker";
export type MyWorkScope = "active" | "all";
export type MyWorkStatusCategory =
	| "backlog"
	| "started"
	| "completed"
	| "canceled";
export type MyWorkStatusGroup = MyWorkStatusCategory | "other";

export interface MyWorkWorkspace {
	id: number;
	name: string;
	timezone: string | null;
}

export type MyWorkTrackerRow = TrackerItemRow & {
	workspace_id: number;
	/** Optional test/source hydration; production rows are hydrated in batches. */
	assignees?: TrackerItemAssignee[];
	labels?: VocabularyRow[];
};

export type MyWorkBoardRow = BoardWorkItemRow & {
	workspace_id: number;
	/** Optional test/source hydration; production rows are hydrated in batches. */
	assignees?: CardAssignee[];
	labels?: VocabularyRow[];
};

export type MyWorkCandidate =
	| { source: "tracker"; row: MyWorkTrackerRow }
	| { source: "board"; row: MyWorkBoardRow };

export type MyWorkAssignee = {
	id: number;
	username: string;
	displayName: string;
};

export type MyWorkSerializedItem = Record<string, unknown> & {
	id: number;
	key: string;
	source: MyWorkSource;
	title: string;
	description: string;
	status: Record<string, unknown>;
	updatedAt: string;
	workspace: MyWorkWorkspace;
	workspaceId: number;
	workspaceName: string;
	identity: {
		workspaceId: number;
		source: MyWorkSource;
		key: string;
	};
	statusCategory: MyWorkStatusCategory | null;
	canMarkDone: boolean;
	markDoneReason: "missing_done_mapping" | "terminal" | "pending" | null;
};

export type MyWorkCursor = {
	group: number;
	overdue: boolean;
	dueDate: string | null;
	updatedAt: string;
	workspaceId: number;
	source: MyWorkSource;
	key: string;
	/** Numeric tie-breaker shared by SQL, cursor predicates, and response sorting. */
	keyNumber?: number;
	id: number;
};

export type MyWorkListInput = {
	userId: number;
	scope: MyWorkScope;
	q?: string;
	workspaceId?: number;
	source?: MyWorkSource;
	cursor?: string | null;
	limit?: number;
	now?: Date;
};

export type MyWorkDetailInput = {
	userId: number;
	workspaceId: number;
	source: MyWorkSource;
	key: string;
	keyNumber: number;
};

export type MyWorkSourceQueryInput = {
	userId: number;
	workspaceIds: readonly number[];
	workspaceId?: number;
	q: string;
	scope: MyWorkScope;
	/** Cursor and page size are applied by each set-based source query. */
	cursor?: MyWorkCursor | null;
	limit?: number;
	now?: Date;
	/** Used to keep canonical workspace keys inside the SQL search boundary. */
	workspacePrefixes?: ReadonlyMap<number, string>;
	/** Local calendar dates used by the overdue ordering expression. */
	workspaceLocalDates?: ReadonlyMap<number, string>;
};

export type MyWorkDetailQueryInput = {
	userId: number;
	workspaceId: number;
	key: string;
	keyNumber: number;
};

export type MyWorkDataSource = {
	listAuthorizedWorkspaces: (userId: number) => Promise<MyWorkWorkspace[]>;
	listTrackerRows: (
		input: MyWorkSourceQueryInput,
	) => Promise<MyWorkTrackerRow[]>;
	listBoardRows: (input: MyWorkSourceQueryInput) => Promise<MyWorkBoardRow[]>;
	getTrackerRow: (
		input: MyWorkDetailQueryInput,
	) => Promise<MyWorkTrackerRow | null>;
	getBoardRow: (
		input: MyWorkDetailQueryInput,
	) => Promise<MyWorkBoardRow | null>;
};

export type MyWorkMarkDoneService = (
	input: MyWorkMarkDoneInput,
) => Promise<MyWorkMarkDoneResult>;

export type MyWorkServiceDeps = Partial<MyWorkDataSource> & {
	executor?: DBExecutor;
	hydrateRows?: (
		candidates: readonly MyWorkCandidate[],
		workspaces: ReadonlyMap<number, MyWorkWorkspace>,
	) => Promise<MyWorkSerializedItem[]>;
	markDone?: MyWorkMarkDoneService;
	markDoneDeps?: MyWorkMarkDoneDeps;
};

export type MyWorkListResponse = {
	items: MyWorkSerializedItem[];
	nextCursor: string | null;
};

export type MyWorkService = {
	list: (input: MyWorkListInput) => Promise<MyWorkListResponse>;
	listMyWork: (input: MyWorkListInput) => Promise<MyWorkListResponse>;
	getDetail: (input: MyWorkDetailInput) => Promise<MyWorkSerializedItem | null>;
	getMyWorkItem: (
		input: MyWorkDetailInput,
	) => Promise<MyWorkSerializedItem | null>;
	markDone: MyWorkMarkDoneService;
	markMyWorkDone: MyWorkMarkDoneService;
};

export type MyWorkServiceLike =
	| (Pick<MyWorkService, "list" | "getDetail"> &
			Partial<Pick<MyWorkService, "markDone" | "markMyWorkDone">>)
	| ({
			listMyWork: (input: MyWorkListInput) => Promise<MyWorkListResponse>;
			getMyWorkItem: (
				input: MyWorkDetailInput,
			) => Promise<MyWorkSerializedItem | null>;
	  } & Partial<Pick<MyWorkService, "markDone" | "markMyWorkDone">>);

export type MyWorkRouterOptions = {
	service?: MyWorkServiceLike;
	deps?: MyWorkServiceDeps;
	dbExec?: DBExecutor;
};

export type ParsedMyWorkQuery = {
	scope: MyWorkScope;
	q: string;
	workspaceId?: number;
	source?: MyWorkSource;
	cursor: string | null;
	limit: number;
};
