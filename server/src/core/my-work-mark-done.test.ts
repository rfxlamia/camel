import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DBExecutor } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";
import {
	createMyWorkRouter,
	type MyWorkSerializedItem,
	type MyWorkServiceLike,
} from "../modules/my-work/index.js";
import { createMyWorkMarkDoneService } from "./my-work-mark-done.js";

const mockPublishEvent = vi.hoisted(() => vi.fn());
const mockRecordCardActivity = vi.hoisted(() => vi.fn());
const mockRecordTrackerActivity = vi.hoisted(() => vi.fn());
vi.mock("../realtime.js", () => ({
	publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
	clearPresence: vi.fn(),
}));
vi.mock("../lib/helpers.js", () => ({
	recordActivity: (...args: unknown[]) => mockRecordCardActivity(...args),
}));
vi.mock("../lib/tracker-activity.js", () => ({
	recordTrackerActivity: (...args: unknown[]) =>
		mockRecordTrackerActivity(...args),
}));

const actor = {
	id: 42,
	username: "alice",
	displayName: "Alice",
	email: "alice@example.com",
	emailVerified: true,
	needsUsername: false,
};

function chainable(result: unknown, onExecute?: () => void) {
	const builder: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of [
		"where",
		"select",
		"orderBy",
		"forUpdate",
		"returning",
		"innerJoin",
		"leftJoin",
	]) {
		builder[method] = vi.fn(() => builder);
	}
	const resolve = () =>
		typeof result === "function" ? (result as () => unknown)() : result;
	const rows = (value: unknown) =>
		Array.isArray(value) ? value : value == null ? [] : [value];
	builder.execute = vi.fn().mockImplementation(async () => {
		const value = resolve();
		onExecute?.();
		return rows(value);
	});
	builder.executeTakeFirst = vi.fn().mockImplementation(async () => {
		const value = resolve();
		onExecute?.();
		return Array.isArray(value) ? value[0] : value;
	});
	return builder;
}

type CommandDbOptions = {
	membership?: unknown;
	cardAssignment?: unknown;
	trackerAssignment?: unknown;
	boardItem?: unknown;
	trackerItem?: unknown;
	columns?: unknown[];
	statuses?: unknown[];
};

function makeDb(options: CommandDbOptions = {}) {
	const trx = {
		selectFrom: vi.fn((table: string) => {
			if (table === "workspace_members") {
				return chainable(
					options.membership !== undefined
						? options.membership
						: { user_id: 42 },
				);
			}
			if (table === "card_assignees") {
				return chainable(
					options.cardAssignment !== undefined
						? options.cardAssignment
						: { card_id: 200 },
				);
			}
			if (table === "cards") {
				return chainable(
					options.boardItem ?? {
						id: 200,
						column_id: 11,
						status_id: 101,
						title: "Board work",
						version: 4,
					},
				);
			}
			if (table === "columns") {
				return chainable(
					options.columns ?? [
						{
							id: 11,
							workspace_id: 7,
							workspaceId: 7,
							board_id: null,
							boardId: null,
							position: 1,
							is_done: false,
						},
						{
							id: 12,
							workspace_id: 7,
							workspaceId: 7,
							board_id: null,
							boardId: null,
							position: 2,
							is_done: true,
						},
					],
				);
			}
			if (table === "tracker_vocabularies") {
				return chainable(
					options.statuses ?? [
						{
							id: 101,
							workspace_id: 7,
							workspaceId: 7,
							kind: "status",
							slot: "in_progress",
							position: 1,
						},
						{
							id: 102,
							workspace_id: 7,
							workspaceId: 7,
							kind: "status",
							slot: "done",
							position: 2,
						},
					],
				);
			}
			return chainable([]);
		}),
	};
	const db = {
		transaction: vi.fn(() => ({
			execute: vi.fn(async (callback: (executor: typeof trx) => unknown) =>
				callback(trx),
			),
		})),
	};
	return {
		db: db as unknown as DBExecutor,
		trx,
	};
}

function makeTrackerDb(options: CommandDbOptions = {}) {
	const tableQueries: string[] = [];
	const trx = {
		selectFrom: vi.fn((table: string) => {
			tableQueries.push(table);
			if (table === "workspace_members") {
				return chainable(
					options.membership !== undefined
						? options.membership
						: { user_id: 42 },
				);
			}
			if (table === "tracker_item_assignees") {
				return chainable(
					options.trackerAssignment !== undefined
						? options.trackerAssignment
						: { tracker_item_id: 300 },
				);
			}
			if (table === "tracker_items" || table === "tracker_items as ti") {
				return chainable(
					options.trackerItem ?? {
						id: 300,
						key_number: 4,
						status_id: 101,
						title: "Tracker work",
						version: 2,
					},
				);
			}
			if (table === "columns") return chainable(options.columns ?? []);
			if (table === "tracker_vocabularies") {
				return chainable(
					options.statuses ?? [
						{
							id: 101,
							workspace_id: 7,
							workspaceId: 7,
							kind: "status",
							slot: "in_progress",
							position: 1,
						},
						{
							id: 102,
							workspace_id: 7,
							workspaceId: 7,
							kind: "status",
							slot: "done",
							position: 2,
						},
					],
				);
			}
			return chainable([]);
		}),
	};
	const db = {
		transaction: vi.fn(() => ({
			execute: vi.fn(async (callback: (executor: typeof trx) => unknown) =>
				callback(trx),
			),
		})),
	};
	return { db: db as unknown as DBExecutor, trx, tableQueries };
}

type MappingRaceSource = "board" | "tracker";

function makeMappingRaceDb(source: MappingRaceSource) {
	const tableQueries: string[] = [];
	const sourceWrites: string[] = [];
	const loadedColumns = [
		{
			id: 11,
			workspace_id: 7,
			workspaceId: 7,
			board_id: null,
			boardId: null,
			position: 1,
			is_done: false,
		},
		{
			id: 12,
			workspace_id: 7,
			workspaceId: 7,
			board_id: null,
			boardId: null,
			position: 2,
			is_done: true,
		},
	];
	const loadedStatuses = [
		{
			id: 101,
			workspace_id: 7,
			workspaceId: 7,
			kind: "status",
			slot: "in_progress",
			position: 1,
		},
		{
			id: 102,
			workspace_id: 7,
			workspaceId: 7,
			kind: "status",
			slot: "done",
			position: 2,
		},
	];
	let mappingRemoved = false;
	let columnReads = 0;
	let statusReads = 0;
	const trx = {
		selectFrom: vi.fn((table: string) => {
			tableQueries.push(table);
			if (table === "workspace_members") return chainable({ user_id: 42 });
			if (table === "card_assignees") return chainable({ card_id: 200 });
			if (table === "tracker_item_assignees") {
				return chainable({ tracker_item_id: 300 });
			}
			if (table === "cards") {
				return chainable({
					id: 200,
					key_number: 17,
					column_id: 11,
					status_id: 101,
					title: "Board work",
					version: 4,
				});
			}
			if (table === "tracker_items" || table === "tracker_items as ti") {
				return chainable({
					id: 300,
					key_number: 4,
					status_id: 101,
					title: "Tracker work",
					version: 2,
					completed_at: null,
				});
			}
			if (table === "columns") {
				columnReads += 1;
				if (source !== "board") return chainable([]);
				if (columnReads === 1) {
					return chainable(loadedColumns, () => {
						mappingRemoved = true;
					});
				}
				if (columnReads === 2) return chainable({ board_id: null });
				return chainable(() =>
					mappingRemoved ? [loadedColumns[0]] : loadedColumns,
				);
			}
			if (table === "tracker_vocabularies") {
				statusReads += 1;
				if (statusReads === 1) {
					return chainable(
						loadedStatuses,
						source === "tracker"
							? () => {
									mappingRemoved = true;
								}
							: undefined,
					);
				}
				if (source === "board" && statusReads === 2) {
					return chainable({ id: 102, slot: "done" });
				}
				return chainable(() => (mappingRemoved ? [] : loadedStatuses));
			}
			return chainable([]);
		}),
		updateTable: vi.fn((table: string) => {
			sourceWrites.push(table);
			return {
				set: vi.fn(() => chainable({ id: 200, title: "Board work" })),
			};
		}),
	};
	const db = {
		transaction: vi.fn(() => ({
			execute: vi.fn(async (callback: (executor: typeof trx) => unknown) =>
				callback(trx),
			),
		})),
	};
	return {
		db: db as unknown as DBExecutor,
		trx,
		tableQueries,
		sourceWrites,
	};
}

const mockBoardStatusChange = vi.fn();

beforeEach(() => {
	mockRecordCardActivity.mockReset();
	mockRecordTrackerActivity.mockReset();
	mockBoardStatusChange.mockReset();
	mockPublishEvent.mockReset();
	mockPublishEvent.mockResolvedValue(undefined);
	mockBoardStatusChange.mockImplementation(async (trx: unknown) => {
		mockRecordCardActivity(trx);
		return {
			kind: "ok",
			moved: true,
			cardTitle: "Board work",
		};
	});
});

describe("My Work Mark done command", () => {
	it("delegates an authorized Board item to the Board primitive and records one card activity", async () => {
		const { db, trx } = makeDb();
		const command = createMyWorkMarkDoneService({
			executor: db,
			boardStatusChange: mockBoardStatusChange,
		});

		const result = await command.markDone({
			userId: actor.id,
			actor,
			workspaceId: 7,
			source: "board",
			keyNumber: 17,
			version: 4,
		});

		expect(result).toMatchObject({ kind: "ok", source: "board", itemId: 200 });
		expect(mockBoardStatusChange).toHaveBeenCalledOnce();
		expect(mockBoardStatusChange).toHaveBeenCalledWith(
			trx,
			expect.objectContaining({
				workspaceId: 7,
				cardId: 200,
				targetStatusId: 102,
				version: 4,
			}),
		);
		expect(mockRecordCardActivity).toHaveBeenCalledOnce();
	});

	it("delegates an authorized Tracker item to the Tracker primitive without Board access", async () => {
		const { db, trx, tableQueries } = makeTrackerDb();
		const trackerStatusChange = vi.fn().mockResolvedValue({
			kind: "ok",
			itemId: 300,
			itemTitle: "Tracker work",
		});
		const command = createMyWorkMarkDoneService({
			executor: db,
			trackerStatusChange,
		});

		const result = await command.markDone({
			userId: actor.id,
			actor,
			workspaceId: 7,
			source: "tracker",
			keyNumber: 4,
			version: 2,
		});

		expect(result).toMatchObject({
			kind: "ok",
			source: "tracker",
			itemId: 300,
		});
		expect(trackerStatusChange).toHaveBeenCalledWith(
			trx,
			expect.objectContaining({
				workspaceId: 7,
				trackerItemId: 300,
				targetStatusId: 102,
				version: 2,
			}),
		);
		expect(tableQueries).not.toContain("cards");
	});

	it("returns not_found after membership revocation without a source write", async () => {
		const { db } = makeDb({ membership: null });
		const boardStatusChange = vi.fn();
		const result = await createMyWorkMarkDoneService({
			executor: db,
			boardStatusChange,
		}).markDone({
			userId: actor.id,
			actor,
			workspaceId: 7,
			source: "board",
			keyNumber: 17,
		});

		expect(result).toEqual({ kind: "not_found" });
		expect(boardStatusChange).not.toHaveBeenCalled();
	});

	it("returns not_found after assignment removal without a source write", async () => {
		const { db } = makeDb({ cardAssignment: null });
		const boardStatusChange = vi.fn();
		const result = await createMyWorkMarkDoneService({
			executor: db,
			boardStatusChange,
		}).markDone({
			userId: actor.id,
			actor,
			workspaceId: 7,
			source: "board",
			keyNumber: 17,
		});

		expect(result).toEqual({ kind: "not_found" });
		expect(boardStatusChange).not.toHaveBeenCalled();
	});

	it("maps a missing done target to unmappable without a source write", async () => {
		const { db } = makeDb({ columns: [], statuses: [] });
		const boardStatusChange = vi.fn();
		const result = await createMyWorkMarkDoneService({
			executor: db,
			boardStatusChange,
		}).markDone({
			userId: actor.id,
			actor,
			workspaceId: 7,
			source: "board",
			keyNumber: 17,
		});

		expect(result).toEqual({ kind: "unmappable" });
		expect(boardStatusChange).not.toHaveBeenCalled();
	});

	it("preserves Board version conflict without recording activity", async () => {
		const { db } = makeDb();
		const boardStatusChange = vi.fn().mockResolvedValue({ kind: "conflict" });
		const result = await createMyWorkMarkDoneService({
			executor: db,
			boardStatusChange,
		}).markDone({
			userId: actor.id,
			actor,
			workspaceId: 7,
			source: "board",
			keyNumber: 17,
			version: 3,
		});

		expect(result).toEqual({ kind: "conflict" });
		expect(mockRecordCardActivity).not.toHaveBeenCalled();
	});

	it("preserves Tracker version conflict without cards access or activity", async () => {
		const { db, tableQueries } = makeTrackerDb();
		const trackerStatusChange = vi.fn().mockResolvedValue({ kind: "conflict" });
		const result = await createMyWorkMarkDoneService({
			executor: db,
			trackerStatusChange,
		}).markDone({
			userId: actor.id,
			actor,
			workspaceId: 7,
			source: "tracker",
			keyNumber: 4,
			version: 1,
		});

		expect(result).toEqual({ kind: "conflict" });
		expect(tableQueries).not.toContain("cards");
	});

	it("short-circuits an already canonical Board target without duplicate activity", async () => {
		const { db } = makeDb({
			boardItem: {
				id: 200,
				column_id: 12,
				status_id: 102,
				title: "Board work",
				version: 5,
			},
		});
		const boardStatusChange = vi.fn();
		const result = await createMyWorkMarkDoneService({
			executor: db,
			boardStatusChange,
		}).markDone({
			userId: actor.id,
			actor,
			workspaceId: 7,
			source: "board",
			keyNumber: 17,
			version: 4,
		});

		expect(result).toMatchObject({
			kind: "ok",
			source: "board",
			itemId: 200,
			changed: false,
		});
		expect(boardStatusChange).not.toHaveBeenCalled();
	});

	it("short-circuits an already canonical Tracker target without duplicate activity", async () => {
		const { db, tableQueries } = makeTrackerDb({
			trackerItem: {
				id: 300,
				key_number: 4,
				status_id: 102,
				title: "Tracker work",
				version: 3,
			},
		});
		const trackerStatusChange = vi.fn();
		const result = await createMyWorkMarkDoneService({
			executor: db,
			trackerStatusChange,
		}).markDone({
			userId: actor.id,
			actor,
			workspaceId: 7,
			source: "tracker",
			keyNumber: 4,
			version: 2,
		});

		expect(result).toMatchObject({
			kind: "ok",
			source: "tracker",
			itemId: 300,
			changed: false,
		});
		expect(trackerStatusChange).not.toHaveBeenCalled();
		expect(tableQueries).not.toContain("cards");
	});

	it("rejects a Board mapping removal race before source or activity writes", async () => {
		const { db, sourceWrites, tableQueries } = makeMappingRaceDb("board");
		const markDone = createMyWorkMarkDoneService({ executor: db }).markDone;
		const response = await request(
			routeApp({ list: vi.fn(), getDetail: vi.fn(), markDone }),
		)
			.post("/my-work/7/board/AT-17/done")
			.send({ version: 4 });

		expect(response.status).toBe(409);
		expect(response.body.code).toBe("status_column_unmappable");
		expect(sourceWrites).toEqual([]);
		expect(tableQueries.filter((table) => table === "columns")).toHaveLength(3);
		expect(
			tableQueries.filter((table) => table === "tracker_vocabularies"),
		).toHaveLength(3);
		expect(mockRecordCardActivity).not.toHaveBeenCalled();
		expect(mockRecordTrackerActivity).not.toHaveBeenCalled();
	});

	it("rejects a Tracker mapping removal race before source or activity writes", async () => {
		const { db, sourceWrites, tableQueries } = makeMappingRaceDb("tracker");
		const markDone = createMyWorkMarkDoneService({ executor: db }).markDone;
		const response = await request(
			routeApp({ list: vi.fn(), getDetail: vi.fn(), markDone }),
		)
			.post("/my-work/7/tracker/OR-4/done")
			.send({ version: 2 });

		expect(response.status).toBe(409);
		expect(response.body.code).toBe("status_column_unmappable");
		expect(sourceWrites).toEqual([]);
		expect(
			tableQueries.filter((table) => table === "tracker_vocabularies"),
		).toHaveLength(2);
		expect(tableQueries).not.toContain("cards");
		expect(mockRecordCardActivity).not.toHaveBeenCalled();
		expect(mockRecordTrackerActivity).not.toHaveBeenCalled();
	});
});

const routeItem = {
	id: 200,
	key: "AT-17",
	source: "board",
	title: "Board work",
	description: "",
	status: { id: 102, slot: "done" },
	updatedAt: "2026-09-11T00:00:00.000Z",
} as unknown as MyWorkSerializedItem;

const trackerRouteItem = {
	...routeItem,
	id: 4,
	key: "OR-4",
	source: "tracker",
	title: "Tracker work",
} as unknown as MyWorkSerializedItem;

function routeApp(service: MyWorkServiceLike) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = actor;
		next();
	});
	app.use("/my-work", createMyWorkRouter({ service }));
	return app;
}

describe("My Work Mark done HTTP boundary", () => {
	beforeEach(() => {
		mockPublishEvent.mockReset();
		mockPublishEvent.mockResolvedValue(undefined);
	});

	afterEach(() => {
		domainBus.removeAllListeners();
	});

	it("maps successful Board command results to the refreshed item", async () => {
		const markDone = vi.fn().mockResolvedValue({
			kind: "ok",
			source: "board",
			itemId: 200,
			itemTitle: "Board work",
			changed: true,
			moved: true,
		});
		const detail = vi.fn().mockResolvedValue(routeItem);
		const response = await request(
			routeApp({
				list: vi.fn(),
				getDetail: detail,
				markDone,
			}),
		)
			.post("/my-work/7/board/AT-17/done")
			.send({ version: 4 });

		expect(response.status).toBe(200);
		expect(response.body).toEqual(routeItem);
		expect(markDone).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: actor.id,
				workspaceId: 7,
				source: "board",
				keyNumber: 17,
				version: 4,
			}),
		);
		expect(mockPublishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({ type: "card.moved", cardId: 200 }),
		);
	});

	it("publishes tracker.updated for a successful Tracker command", async () => {
		const markDone = vi.fn().mockResolvedValue({
			kind: "ok",
			source: "tracker",
			itemId: 4,
			itemTitle: "Tracker work",
			changed: true,
		});
		const response = await request(
			routeApp({
				list: vi.fn(),
				getDetail: vi.fn().mockResolvedValue(trackerRouteItem),
				markDone,
			}),
		)
			.post("/my-work/7/tracker/OR-4/done")
			.send({ version: 2 });

		expect(response.status).toBe(200);
		expect(response.body).toEqual(trackerRouteItem);
		expect(mockPublishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({ type: "tracker.updated", trackerItemId: 4 }),
		);
		expect(mockPublishEvent).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ type: "card.moved" }),
		);
	});

	it("publishes card.updated when a Board command does not move the card", async () => {
		const assigned: unknown[] = [];
		domainBus.once(EVENTS.CARD_ASSIGNED, (event) => assigned.push(event));
		const markDone = vi.fn().mockResolvedValue({
			kind: "ok",
			source: "board",
			itemId: 200,
			itemTitle: "Board work",
			changed: true,
			moved: false,
		});
		const response = await request(
			routeApp({
				list: vi.fn(),
				getDetail: vi.fn().mockResolvedValue(routeItem),
				markDone,
			}),
		)
			.post("/my-work/7/board/AT-17/done")
			.send({ version: 4 });

		expect(response.status).toBe(200);
		expect(mockPublishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({ type: "card.updated", cardId: 200 }),
		);
		expect(mockPublishEvent).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ type: "card.moved" }),
		);
		expect(assigned).toHaveLength(0);
	});

	it("emits CARD_ASSIGNED when Board mark done adds a signable assignee", async () => {
		const assigned: unknown[] = [];
		domainBus.once(EVENTS.CARD_ASSIGNED, (event) => assigned.push(event));
		const markDone = vi.fn().mockResolvedValue({
			kind: "ok",
			source: "board",
			itemId: 200,
			itemTitle: "Board work",
			changed: true,
			moved: false,
			addedSignableAssignee: 88,
		});
		const response = await request(
			routeApp({
				list: vi.fn(),
				getDetail: vi.fn().mockResolvedValue(routeItem),
				markDone,
			}),
		)
			.post("/my-work/7/board/AT-17/done")
			.send({ version: 4 });

		expect(response.status).toBe(200);
		expect(assigned).toEqual([
			{
				type: EVENTS.CARD_ASSIGNED,
				workspaceId: 7,
				actorId: actor.id,
				payload: {
					cardId: 200,
					assigneeId: 88,
					cardTitle: "Board work",
					actorDisplayName: actor.displayName,
				},
			},
		]);
	});

	it("maps known command errors instead of the unavailable catch-all", async () => {
		for (const [result, status, code] of [
			[{ kind: "not_found" }, 404, undefined],
			[{ kind: "conflict" }, 409, "version_conflict"],
			[{ kind: "unmappable" }, 409, "status_column_unmappable"],
		] as const) {
			const response = await request(
				routeApp({
					list: vi.fn(),
					getDetail: vi.fn(),
					markDone: vi.fn().mockResolvedValue(result),
				}),
			)
				.post("/my-work/7/board/AT-17/done")
				.send({ version: 4 });
			expect(response.status).toBe(status);
			if (code) expect(response.body.code).toBe(code);
			expect(response.body.code).not.toBe("my_work_unavailable");
		}
	});

	it("maps unexpected command failures to retryable unavailable", async () => {
		const response = await request(
			routeApp({
				list: vi.fn(),
				getDetail: vi.fn(),
				markDone: vi.fn().mockRejectedValue(new Error("database unavailable")),
			}),
		)
			.post("/my-work/7/board/AT-17/done")
			.send({ version: 4 });

		expect(response.status).toBe(503);
		expect(response.body.code).toBe("my_work_unavailable");
	});
});
