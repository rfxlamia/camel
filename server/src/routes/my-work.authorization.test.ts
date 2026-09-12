import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMyWorkRouter, createMyWorkService } from "./my-work.js";
import { mergeMyWorkRows } from "./my-work-response.js";
import {
	ALICE,
	ATLAS,
	NEBULA,
	NOW,
	ORBIT,
	boardRow,
	duplicateJoinRows,
	sourceDeps,
	testApp,
	trackerRow,
} from "./my-work-test-support.js";

// The service tests use injected source loaders. Keep the module import from
// requiring a configured PostgreSQL environment.
vi.mock("../db/kysely.js", () => ({ db: {} }));

describe("My Work authorization and source boundary", () => {
	beforeEach(() => vi.clearAllMocks());

	it("RED 1: returns assigned Board/Tracker rows with workspace and source identity", async () => {
		const deps = sourceDeps({
			tracker: [trackerRow({ id: 101, workspace_id: ORBIT.id, key_number: 4 })],
			board: [boardRow({ id: 201, workspace_id: ATLAS.id, key_number: 17 })],
		});
		const service = createMyWorkService(deps);

		const result = await service.list({
			userId: ALICE.id,
			scope: "active",
			now: NOW,
		});

		expect(result.items).toHaveLength(2);
		expect(result.items.map((item) => item.identity)).toEqual(
			expect.arrayContaining([
				{ workspaceId: 7, source: "board", key: "AT-17" },
				{ workspaceId: 12, source: "tracker", key: "OR-4" },
			]),
		);
		expect(result.items.every((item) => item.workspace?.name)).toBe(true);
		expect(deps.listTrackerRows).toHaveBeenCalledWith(
			expect.objectContaining({ userId: ALICE.id, workspaceIds: [7, 12] }),
		);
	});

	it("RED 2: deduplicates duplicate joins and applies tracker-wins per workspace", async () => {
		const { atlasTracker, orbitTracker, board } = duplicateJoinRows();
		const result = await createMyWorkService(
			sourceDeps({
				tracker: [atlasTracker, { ...atlasTracker }, orbitTracker],
				board,
			}),
		).list({ userId: ALICE.id, scope: "all", now: NOW });

		expect(result.items).toHaveLength(2);
		expect(
			result.items.map((item) => [item.workspaceId, item.source, item.key]),
		).toEqual(
			expect.arrayContaining([
				[7, "tracker", "AT-17"],
				[12, "tracker", "OR-17"],
			]),
		);
		expect(
			result.items.some((item) => item.title === "Atlas board shadow"),
		).toBe(false);

		const merged = mergeMyWorkRows(
			[atlasTracker, { ...atlasTracker }, orbitTracker],
			[],
		);
		expect(merged).toHaveLength(2);
	});

	it("RED 3: excludes an assigned row from a workspace without current membership", async () => {
		const deps = sourceDeps(
			{
				tracker: [
					trackerRow({
						id: 104,
						workspace_id: NEBULA.id,
						key_number: 9,
						title: "Nebula secret",
					}),
				],
				board: [],
			},
			[ATLAS, ORBIT],
		);
		const result = await createMyWorkService(deps).list({
			userId: ALICE.id,
			scope: "all",
			now: NOW,
		});

		expect(result.items).toEqual([]);
		expect(JSON.stringify(result)).not.toContain("Nebula");
	});

	it("RED 5: reauthorizes detail and maps revoked access to HTTP 404 Not found", async () => {
		let revoked = false;
		const row = boardRow({ id: 210, workspace_id: ATLAS.id, key_number: 17 });
		const deps = sourceDeps({ tracker: [], board: [row] }, [ATLAS]);
		deps.listAuthorizedWorkspaces = vi.fn(async () => (revoked ? [] : [ATLAS]));
		const router = createMyWorkRouter({ deps });
		const app = testApp(router);

		const before = await request(app).get("/my-work/7/board/AT-17");
		expect(before.status).toBe(200);
		revoked = true;
		const after = await request(app).get("/my-work/7/board/AT-17");
		expect(after.status).toBe(404);
		expect(after.body).toEqual({ error: "Not found" });
		expect(JSON.stringify(after.body)).not.toContain("Board card");
	});

	it("RED 5b: assignment revocation after source read returns 404 without cached content", async () => {
		const row = boardRow({ id: 211, workspace_id: ATLAS.id, key_number: 17 });
		const deps = sourceDeps({ tracker: [], board: [row] }, [ATLAS]);
		let sourceReads = 0;
		deps.getBoardRow = vi.fn(async () => {
			sourceReads += 1;
			// The first source read represents the row that was visible in the
			// list. The assignment is revoked before the final reauthorization.
			return sourceReads === 1 ? row : null;
		});

		const response = await request(testApp(createMyWorkRouter({ deps }))).get(
			"/my-work/7/board/AT-17",
		);

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "Not found" });
		expect(JSON.stringify(response.body)).not.toContain("Board card");
		expect(deps.getBoardRow).toHaveBeenCalledTimes(2);
	});

	it("RED 6: searches All candidates across active, terminal, and Other categories", async () => {
		const deps = sourceDeps({
			tracker: [
				trackerRow({
					id: 111,
					key_number: 11,
					title: "Active matching intent",
				}),
				trackerRow({
					id: 112,
					key_number: 12,
					title: "Completed matching intent",
					status_category: "completed",
					status_slot: "done",
				}),
				trackerRow({
					id: 113,
					key_number: 13,
					title: "Other matching intent",
					status_category: "unknown",
					status_slot: null,
				}),
			],
			board: [],
		});
		const result = await createMyWorkService(deps).list({
			userId: ALICE.id,
			scope: "all",
			q: "matching intent",
			now: NOW,
		});

		expect(result.items.map((item) => item.id)).toEqual([111, 112, 113]);
	});

	it("RED 6b: All-scope canonical key search finds AT-17", async () => {
		const result = await createMyWorkService(
			sourceDeps({
				tracker: [],
				board: [
					boardRow({
						id: 215,
						workspace_id: ATLAS.id,
						key_number: 17,
						title: "Canonical key match",
					}),
					boardRow({
						id: 216,
						workspace_id: ORBIT.id,
						key_number: 17,
						title: "Same number, different workspace",
					}),
				],
			}),
		).list({
			userId: ALICE.id,
			scope: "all",
			q: "AT-17",
			now: NOW,
		});

		expect(result.items.map((item) => item.identity)).toEqual([
			{ workspaceId: ATLAS.id, source: "board", key: "AT-17" },
		]);
	});

	it("RED 7: applies workspace and source filters before returning rows", async () => {
		const deps = sourceDeps({
			tracker: [
				trackerRow({ id: 114, workspace_id: ORBIT.id, key_number: 14 }),
			],
			board: [boardRow({ id: 214, workspace_id: ATLAS.id, key_number: 14 })],
		});
		const service = createMyWorkService(deps);

		const boardOnly = await service.list({
			userId: ALICE.id,
			scope: "all",
			workspaceId: ATLAS.id,
			source: "board",
			now: NOW,
		});
		const trackerOnly = await service.list({
			userId: ALICE.id,
			scope: "all",
			workspaceId: ORBIT.id,
			source: "tracker",
			now: NOW,
		});

		expect(boardOnly.items.map((item) => item.identity)).toEqual([
			{ workspaceId: 7, source: "board", key: "AT-14" },
		]);
		expect(trackerOnly.items.map((item) => item.identity)).toEqual([
			{ workspaceId: 12, source: "tracker", key: "OR-14" },
		]);
		expect(deps.listTrackerRows).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceIds: [12] }),
		);
		expect(deps.listBoardRows).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceIds: [7] }),
		);
	});

	it("RED 9: maps an injected transient query failure to a retryable response without partial data", async () => {
		const deps = sourceDeps({
			tracker: [trackerRow({ id: 130, workspace_id: ORBIT.id })],
			board: [],
		});
		deps.listBoardRows = vi.fn(async () => {
			throw new Error("ETIMEDOUT while querying board rows");
		});
		const response = await request(testApp(createMyWorkRouter({ deps }))).get(
			"/my-work?scope=all",
		);

		expect(response.status).toBe(503);
		expect(response.body).toEqual({
			error: "Unable to load My Work",
			code: "my_work_unavailable",
			retryable: true,
		});
		expect(response.body.items).toBeUndefined();
	});
});
