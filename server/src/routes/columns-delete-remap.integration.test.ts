// Integration coverage for transactional column delete status remapping.
import "dotenv/config";
import { describe, expect, it } from "vitest";
import {
	addCard,
	app,
	insertColumns,
	installDatabaseHooks,
	mockPublishEvent,
	mockTestUser,
	pool,
	readCard,
	request,
	statusId,
	WORKSPACE_ID,
} from "./columns-is-done-remap.test-support.js";

installDatabaseHooks();

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"column delete — status remap and events",
	() => {
		it("remaps surviving cards, cascades deleted-column cards, and publishes events", async () => {
			const [backlog, todo, doing, done] = await insertColumns([
				{ title: "Backlog", position: 1000, isDone: false },
				{ title: "Todo", position: 2000, isDone: false },
				{ title: "Doing", position: 3000, isDone: false },
				{ title: "Done", position: 4000, isDone: true },
			]);

			const backlogCard = await addCard(backlog, "backlog");
			const todoCard = await addCard(todo, "todo");
			const doingCard = await addCard(doing, "in_progress");
			await addCard(done, "done");

			const todoStatusId = await statusId("todo");
			const beforeDoing = await readCard(doingCard);

			const response = await request(app).delete(
				`/api/workspaces/${WORKSPACE_ID}/columns/${todo}`,
			);
			expect(response.status).toBe(204);

			const deletedTodoCard = await pool.query(
				"SELECT 1 FROM cards WHERE id = $1",
				[todoCard],
			);
			expect(deletedTodoCard.rows).toHaveLength(0);

			const backlogAfter = await readCard(backlogCard);
			const doingAfter = await readCard(doingCard);
			expect(backlogAfter.status_id).toBe(await statusId("backlog"));
			expect(doingAfter.status_id).toBe(todoStatusId);
			expect(doingAfter.version).toBe(beforeDoing.version + 1);

			const published = mockPublishEvent.mock.calls.map((call) => call[1]);
			expect(published).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "card.updated",
						cardId: doingCard,
						actor: mockTestUser,
					}),
					expect.objectContaining({
						type: "column.deleted",
						actor: mockTestUser,
						payload: { columnTitle: "Todo" },
					}),
				]),
			);
		});

		it("returns 404 when deleting an agent-board column through the human route", async () => {
			const board = await pool.query<{ id: number }>(
				`INSERT INTO agent_boards (workspace_id, user_id, original_intent, execution_status)
				 VALUES ($1, $2, 'test board', 'done') RETURNING id`,
				[WORKSPACE_ID, mockTestUser.id],
			);
			const agentColumn = await pool.query<{ id: number }>(
				`INSERT INTO columns (workspace_id, board_id, title, position, slug)
				 VALUES ($1, $2, 'Agent Inbox', 1000, 'inbox') RETURNING id`,
				[WORKSPACE_ID, board.rows[0].id],
			);

			const response = await request(app).delete(
				`/api/workspaces/${WORKSPACE_ID}/columns/${agentColumn.rows[0].id}`,
			);
			expect(response.status).toBe(404);
		});
	},
);
