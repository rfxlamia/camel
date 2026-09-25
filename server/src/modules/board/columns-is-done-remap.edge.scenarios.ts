import { describe, expect, it } from "vitest";
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
	setup,
	statusId,
	trackerEventCount,
	WORKSPACE_ID,
} from "./columns-is-done-remap.test-support.js";

installDatabaseHooks();

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"column is_done remapping — geometry and no-op behavior",
	() => {
		it("clears the last Done column and remaps according to final geometry", async () => {
			const [inbox, finished] = await insertColumns([
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
			expect(response.body).toMatchObject({
				id: finished,
				title: "Finished",
				position: 2000,
				is_done: false,
			});
			const card = await readCard(cardId);
			expect(card.status_id).toBe(todoId);
			expect(card.version).toBe(2);
			expect(card.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(card.done_at).toBeNull();
			expect(await cardActivities([cardId])).toEqual([
				{
					card_id: cardId,
					event_type: "update",
					payload: { changed: ["status"], statusId: todoId },
				},
			]);
			expect(mockPublishEventTypes()).toEqual([
				"card.updated",
				"column.updated",
			]);
			expect(await trackerEventCount()).toBe(0);
			expect(
				(await columns()).find((column) => column.id === inbox)?.is_done,
			).toBe(false);
			expect(
				(await columns()).find((column) => column.id === finished)?.is_done,
			).toBe(false);
		});

		it("does not bump unchanged cards and preserves soft-deleted cards", async () => {
			const [inbox, , , done, stable] = await insertColumns([
				{ title: "Inbox", position: 1000, isDone: false },
				{ title: "Doing", position: 2000, isDone: false },
				{ title: "Review", position: 3000, isDone: false },
				{ title: "Finished", position: 4000, isDone: true },
				{ title: "Archive", position: 5000, isDone: false },
			]);
			const unchanged = await addCard(stable, "in_progress");
			const deleted = await addCard(done, "done");
			await pool.query("UPDATE cards SET deleted_at = now() WHERE id = $1", [
				deleted,
			]);

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${inbox}`)
				.send({ isDone: true });

			expect(response.status).toBe(200);
			expect((await readCard(unchanged)).status_id).toBe(
				await statusId("in_progress"),
			);
			expect((await readCard(unchanged)).version).toBe(1);
			expect((await readCard(deleted)).version).toBe(1);
			expect((await readCard(deleted)).status_id).toBe(await statusId("done"));
			expect(await cardActivities([unchanged, deleted])).toEqual([]);
			expect(mockPublishEventTypes()).toEqual(["column.updated"]);
			expect(await trackerEventCount()).toBe(0);
		});

		it("appends columns without remapping and leaves metadata patches status-neutral", async () => {
			const [original] = await insertColumns([
				{ title: "Inbox", position: 1000, isDone: false },
			]);
			const cardId = await addCard(original, "backlog");
			const backlogId = await statusId("backlog");
			const created = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/columns`)
				.send({ title: "Doing" });
			expect(created.status).toBe(201);
			expect(created.body.position).toBeGreaterThan(1000);
			expect((await readCard(cardId)).version).toBe(1);

			for (const body of [
				{ title: "Title update" },
				{ color: "oklch(88% 0.09 47.3)" },
				{ wipLimit: 3 },
				{ title: "Renamed" },
			]) {
				const patch = await request(app)
					.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${original}`)
					.send(body);
				expect(patch.status).toBe(200);
				const card = await readCard(cardId);
				expect(card.status_id).toBe(backlogId);
				expect(card.version).toBe(1);
			}
			expect(await cardActivities([cardId])).toEqual([]);
			expect(await trackerEventCount()).toBe(0);
		});

		it("keeps append-right overlays unchanged for Inbox and Finished boards", async () => {
			const [inbox, finished] = await insertColumns([
				{ title: "Inbox", position: 1000, isDone: false },
				{ title: "Finished", position: 2000, isDone: true },
			]);
			const inboxCard = await addCard(inbox, "backlog");
			const finishedCard = await addCard(finished, "done");
			const blocked = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/columns`)
				.send({ title: "Blocked" });
			expect(blocked.status).toBe(201);
			expect((await readCard(inboxCard)).status_id).toBe(
				await statusId("backlog"),
			);
			expect((await readCard(finishedCard)).status_id).toBe(
				await statusId("done"),
			);

			await setup();
			const [single] = await insertColumns([
				{ title: "Inbox", position: 1000, isDone: false },
			]);
			const singleCard = await addCard(single, "backlog");
			const doing = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/columns`)
				.send({ title: "Doing" });
			expect(doing.status).toBe(201);
			expect((await readCard(singleCard)).status_id).toBe(
				await statusId("backlog"),
			);
		});
	},
);

function mockPublishEventTypes() {
	return mockPublishEvent.mock.calls.map((call) => call[1].type);
}
