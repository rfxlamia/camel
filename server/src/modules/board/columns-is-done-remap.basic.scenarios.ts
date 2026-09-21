import { describe, expect, it } from "vitest";
import {
	addCard,
	app,
	cardActivities,
	columns,
	insertColumns,
	installDatabaseHooks,
	mockPublishEvent,
	mockTestUser,
	readCard,
	request,
	statusId,
	trackerEventCount,
	WORKSPACE_ID,
} from "./columns-is-done-remap.test-support.js";

installDatabaseHooks();

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"column is_done remapping — status and timestamp transitions",
	() => {
		it("swaps live card status slots, versions, timestamps, and activity in place", async () => {
			const [inbox, doing, finished] = await insertColumns([
				{ title: "Inbox", position: 1000, isDone: false },
				{ title: "Doing", position: 2000, isDone: false },
				{ title: "Finished", position: 3000, isDone: true },
			]);
			const doingCard = await addCard(doing, "todo");
			const finishedCard = await addCard(finished, "done");
			const todoId = await statusId("todo");
			const doneId = await statusId("done");
			const beforeUpdate = Date.now();

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${doing}`)
				.send({ isDone: true });

			expect(response.status).toBe(200);
			expect(response.body).toEqual({
				id: doing,
				title: "Doing",
				position: 2000,
				wip_limit: null,
				policy: "",
				is_done: true,
				is_signable: false,
				signable_assignee_id: null,
				color: null,
			});
			const doingAfter = await readCard(doingCard);
			const finishedAfter = await readCard(finishedCard);
			expect(doingAfter.status_id).toBe(doneId);
			expect(finishedAfter.status_id).toBe(todoId);
			expect(doingAfter.column_id).toBe(doing);
			expect(finishedAfter.column_id).toBe(finished);
			expect(doingAfter.version).toBe(2);
			expect(finishedAfter.version).toBe(2);
			expect(doingAfter.done_at).not.toBeNull();
			expect(finishedAfter.done_at).toBeNull();
			expect(doingAfter.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(finishedAfter.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(
				(await columns()).find((column) => column.id === inbox)?.is_done,
			).toBe(false);

			const published = mockPublishEvent.mock.calls.map((call) => call[1]);
			expect(published.slice(0, 2)).toEqual([
				{
					type: "card.updated",
					actor: mockTestUser,
					cardId: doingCard,
					payload: {
						columnId: doing,
						statusId: doneId,
						version: 2,
						startedAt: doingAfter.started_at?.toISOString(),
						doneAt: doingAfter.done_at?.toISOString(),
					},
				},
				{
					type: "card.updated",
					actor: mockTestUser,
					cardId: finishedCard,
					payload: {
						columnId: finished,
						statusId: todoId,
						version: 2,
						startedAt: finishedAfter.started_at?.toISOString(),
						doneAt: null,
					},
				},
			]);
			expect(published[2]).toEqual({
				type: "column.updated",
				actor: mockTestUser,
				payload: {
					columnTitle: "Doing",
					isDone: true,
					isSignable: false,
					signableAssigneeId: null,
					color: null,
				},
			});
			expect(published.map((event) => event.type)).toEqual([
				"card.updated",
				"card.updated",
				"column.updated",
			]);
			expect(await cardActivities([doingCard, finishedCard])).toEqual([
				{
					card_id: doingCard,
					event_type: "update",
					payload: { changed: ["status"], statusId: doneId },
				},
				{
					card_id: finishedCard,
					event_type: "update",
					payload: { changed: ["status"], statusId: todoId },
				},
			]);
			expect(await trackerEventCount()).toBe(0);
		});

		it("preserves null timestamps when a first column leaves Done", async () => {
			const [finished, todo] = await insertColumns([
				{ title: "Finished", position: 1000, isDone: true },
				{ title: "Todo", position: 2000, isDone: false },
			]);
			const cardId = await addCard(finished, "done");
			const backlogId = await statusId("backlog");

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${finished}`)
				.send({ isDone: false });

			expect(response.status).toBe(200);
			expect((await readCard(cardId)).status_id).toBe(backlogId);
			expect((await readCard(cardId)).version).toBe(2);
			expect((await readCard(cardId)).started_at).toBeNull();
			expect((await readCard(cardId)).done_at).toBeNull();
			expect(await cardActivities([cardId])).toEqual([
				{
					card_id: cardId,
					event_type: "update",
					payload: { changed: ["status"], statusId: backlogId },
				},
			]);
			expect(mockPublishEvent.mock.calls[0][1]).toMatchObject({
				type: "card.updated",
				cardId,
				payload: {
					columnId: finished,
					statusId: backlogId,
					version: 2,
					startedAt: null,
					doneAt: null,
				},
			});
			expect(todo).toBeGreaterThan(finished);
			expect(await trackerEventCount()).toBe(0);
		});

		it("starts a preexisting-done card when leaving a non-first Done column", async () => {
			const [, finished] = await insertColumns([
				{ title: "Inbox", position: 1000, isDone: false },
				{ title: "Finished", position: 2000, isDone: true },
			]);
			const cardId = await addCard(finished, "done");
			const todoId = await statusId("todo");
			const beforeUpdate = Date.now();

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${finished}`)
				.send({ isDone: false });

			expect(response.status).toBe(200);
			const card = await readCard(cardId);
			expect(card.status_id).toBe(todoId);
			expect(card.version).toBe(2);
			expect(card.started_at).not.toBeNull();
			expect(card.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(card.done_at).toBeNull();
			expect(await cardActivities([cardId])).toHaveLength(1);
			expect(mockPublishEvent.mock.calls[0][1]).toMatchObject({
				type: "card.updated",
				cardId,
				payload: {
					columnId: finished,
					statusId: todoId,
					version: 2,
					doneAt: null,
				},
			});
			expect(await trackerEventCount()).toBe(0);
		});

		it("keeps preexisting timestamps when a card enters Done", async () => {
			const [, doing] = await insertColumns([
				{ title: "Inbox", position: 1000, isDone: false },
				{ title: "Doing", position: 2000, isDone: false },
			]);
			const startedAt = "2026-01-02T03:04:05.000Z";
			const doneAt = "2026-01-03T03:04:05.000Z";
			const cardId = await addCard(doing, "todo", 7, startedAt, doneAt);
			const doneId = await statusId("done");

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${doing}`)
				.send({ isDone: true });

			expect(response.status).toBe(200);
			const card = await readCard(cardId);
			expect(card.status_id).toBe(doneId);
			expect(card.version).toBe(8);
			expect(card.started_at?.toISOString()).toBe(startedAt);
			expect(card.done_at?.toISOString()).toBe(doneAt);
			expect(mockPublishEvent.mock.calls[0][1]).toMatchObject({
				type: "card.updated",
				cardId,
				payload: {
					columnId: doing,
					statusId: doneId,
					version: 8,
					startedAt,
					doneAt,
				},
			});
		});
	},
);
