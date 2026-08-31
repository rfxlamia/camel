import { describe, expect, it, vi } from "vitest";
import {
	addCard,
	app,
	cardActivities,
	columns,
	insertColumns,
	installDatabaseHooks,
	mockPublishEvent,
	pool,
	readCard,
	request,
	statusId,
	trackerEventCount,
	WORKSPACE_ID,
} from "./columns-is-done-remap.test-support.js";
import * as routeHelpers from "./helpers.js";

installDatabaseHooks();

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"column is_done remapping — consistency and failure safety",
	() => {
		it("rejects a stale card patch after a remap", async () => {
			const [inbox, done] = await insertColumns([
				{ title: "Inbox", position: 1000, isDone: false },
				{ title: "Done", position: 2000, isDone: true },
			]);
			const cardId = await addCard(done, "done");
			await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${inbox}`)
				.send({ isDone: true });
			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${cardId}`)
				.send({ title: "stale", version: 1 });
			expect(response.status).toBe(409);
		});

		it("rolls back card, activity, column, and publish state after mutation", async () => {
			const [inbox, finished] = await insertColumns([
				{ title: "Inbox", position: 1000, isDone: false },
				{ title: "Finished", position: 2000, isDone: true },
			]);
			const cardId = await addCard(inbox, "backlog");
			const beforeCard = await readCard(cardId);
			const beforeColumns = await columns();
			const beforeActivities = await cardActivities([cardId]);
			const original = routeHelpers.recordActivity;
			const spy = vi
				.spyOn(routeHelpers, "recordActivity")
				.mockImplementationOnce(async (...args) => {
					await original(...args);
					throw new Error("injected transaction failure after activity");
				});
			try {
				const response = await request(app)
					.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${inbox}`)
					.send({ isDone: true });
				expect(response.status).toBe(500);
				expect(await readCard(cardId)).toEqual(beforeCard);
				expect(await columns()).toEqual(beforeColumns);
				expect(await cardActivities([cardId])).toEqual(beforeActivities);
				expect(await trackerEventCount()).toBe(0);
				expect(mockPublishEvent).not.toHaveBeenCalled();
			} finally {
				spy.mockRestore();
			}
			expect(finished).toBeGreaterThan(inbox);
		});

		it("serializes concurrent true/false changes on the workspace row", async () => {
			const [a, b] = await insertColumns([
				{ title: "A", position: 1000, isDone: false },
				{ title: "B", position: 2000, isDone: false },
			]);
			const aCard = await addCard(a, "backlog");
			const bCard = await addCard(b, "todo");
			const doneId = await statusId("done");
			const backlogId = await statusId("backlog");
			const beforeUpdate = Date.now();
			const responses = await Promise.all([
				request(app)
					.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${a}`)
					.send({ isDone: true }),
				request(app)
					.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${b}`)
					.send({ isDone: false }),
			]);
			expect(responses.every((response) => response.status === 200)).toBe(true);
			const doneColumns = (await columns()).filter((column) => column.is_done);
			expect(doneColumns).toHaveLength(1);
			expect(doneColumns[0].id).toBe(a);

			const finalA = await readCard(aCard);
			const finalB = await readCard(bCard);
			expect(finalA).toMatchObject({
				column_id: a,
				status_id: doneId,
				version: 2,
				done_at: expect.any(Date),
			});
			expect(finalB).toMatchObject({
				column_id: b,
				status_id: backlogId,
				version: 2,
				started_at: expect.any(Date),
				done_at: null,
			});
			expect(finalA.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(finalB.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			const activities = await cardActivities([aCard, bCard]);
			expect(activities).toHaveLength(2);
			expect(activities.map((event) => event.card_id)).toEqual([aCard, bCard]);
			expect(await trackerEventCount()).toBe(0);

			const published = mockPublishEvent.mock.calls.map((call) => call[1]);
			expect(
				published.filter((event) => event.type === "card.updated"),
			).toEqual(
				expect.arrayContaining([
					{
						type: "card.updated",
						actor: { id: 1, username: "testuser", displayName: "Test User" },
						cardId: aCard,
						payload: {
							columnId: a,
							statusId: doneId,
							version: 2,
							startedAt: finalA.started_at?.toISOString(),
							doneAt: finalA.done_at?.toISOString(),
						},
					},
					{
						type: "card.updated",
						actor: { id: 1, username: "testuser", displayName: "Test User" },
						cardId: bCard,
						payload: {
							columnId: b,
							statusId: backlogId,
							version: 2,
							startedAt: finalB.started_at?.toISOString(),
							doneAt: null,
						},
					},
				]),
			);
			expect(
				published.filter((event) => event.type === "column.updated"),
			).toHaveLength(2);
		});
	},
);
