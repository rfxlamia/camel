import request from "supertest";
import { expect, it } from "vitest";
import {
	ALICE_ID,
	ATLAS_ID,
	app,
	boardState,
	expectNoCardEvents,
	expectNoCardEventsInWorkspace,
	expectNoTrackerEvents,
	expectNoTrackerEventsInWorkspace,
	type Fixtures,
	getFixtures,
	ORBIT_ID,
	query,
	trackerState,
} from "./my-work.integration.shared.js";

async function assertStaleBoardWrite(fixtures: Fixtures): Promise<void> {
	const initial = await boardState(fixtures.atlasBoard.id);
	await query("UPDATE cards SET version = version + 1 WHERE id = $1", [
		fixtures.atlasBoard.id,
	]);
	const response = await request(app)
		.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
		.send({ version: initial.version });
	expect(response.status).toBe(409);
	expect(response.body.code).toBe("version_conflict");
	expect(await boardState(fixtures.atlasBoard.id)).toEqual({
		...initial,
		version: initial.version + 1,
	});
	await expectNoCardEvents(fixtures.atlasBoard.id);
}

async function assertStaleTrackerWrite(fixtures: Fixtures): Promise<void> {
	const initial = await trackerState(fixtures.orbitTracker.id);
	await query("UPDATE tracker_items SET version = version + 1 WHERE id = $1", [
		fixtures.orbitTracker.id,
	]);
	const response = await request(app)
		.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
		.send({ version: initial.version });
	expect(response.status).toBe(409);
	expect(response.body.code).toBe("version_conflict");
	expect(await trackerState(fixtures.orbitTracker.id)).toEqual({
		...initial,
		version: initial.version + 1,
	});
	await expectNoTrackerEvents(fixtures.orbitTracker.id);
}

export function registerMutationScenarios(): void {
	// Cycle 3 — Board Mark done and exactly-once activity/source isolation.
	it("marks a Board item done with one card activity and no Tracker write", async () => {
		const fixtures = getFixtures();
		const beforeTrackerRows = await query<{
			status_id: number;
			version: number;
		}>(
			"SELECT status_id, version FROM tracker_items WHERE workspace_id = $1 ORDER BY id",
			[ATLAS_ID],
		);
		const response = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: fixtures.atlasBoard.version });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			source: "board",
			key: "AT-18",
			status: { slot: "done" },
			columnId: fixtures.atlas.doneColumnId,
		});
		expect(await boardState(fixtures.atlasBoard.id)).toEqual({
			column_id: fixtures.atlas.doneColumnId,
			status_id: fixtures.atlas.statuses.done,
			version: 2,
		});
		const cardEvents = await query<{
			event_type: string;
			from_column_id: number | null;
			to_column_id: number | null;
			actor_id: number | null;
		}>(
			"SELECT event_type, from_column_id, to_column_id, actor_id FROM card_events WHERE card_id = $1",
			[fixtures.atlasBoard.id],
		);
		expect(cardEvents).toEqual([
			{
				event_type: "move",
				from_column_id: fixtures.atlas.todoColumnId,
				to_column_id: fixtures.atlas.doneColumnId,
				actor_id: ALICE_ID,
			},
		]);
		await expectNoTrackerEventsInWorkspace(ATLAS_ID);
		expect(
			await query<{ status_id: number; version: number }>(
				"SELECT status_id, version FROM tracker_items WHERE workspace_id = $1 ORDER BY id",
				[ATLAS_ID],
			),
		).toEqual(beforeTrackerRows);
	});

	// Cycle 4 — Tracker Mark done and exactly-once activity/source isolation.
	it("marks a Tracker item done with one tracker activity and no Board write", async () => {
		const fixtures = getFixtures();
		const beforeBoard = await boardState(fixtures.orbitBoard.id);
		const response = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: fixtures.orbitTracker.version });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			source: "tracker",
			key: "OR-4",
			status: { slot: "done" },
		});
		expect(await trackerState(fixtures.orbitTracker.id)).toEqual({
			status_id: fixtures.orbit.statuses.done,
			version: 2,
		});
		const trackerEvents = await query<{
			event_type: string;
			tracker_item_id: number | null;
			actor_id: number | null;
		}>(
			"SELECT event_type, tracker_item_id, actor_id FROM tracker_events WHERE tracker_item_id = $1",
			[fixtures.orbitTracker.id],
		);
		expect(trackerEvents).toEqual([
			{
				event_type: "tracker_item_updated",
				tracker_item_id: fixtures.orbitTracker.id,
				actor_id: ALICE_ID,
			},
		]);
		expect(await boardState(fixtures.orbitBoard.id)).toEqual(beforeBoard);
		await expectNoCardEventsInWorkspace(ORBIT_ID);
	});

	// Cycle 5 — stale conflict and no partial source/activity write.
	it("returns version_conflict for stale Board and Tracker writes", async () => {
		const fixtures = getFixtures();
		await assertStaleBoardWrite(fixtures);
		await assertStaleTrackerWrite(fixtures);
	});

	// Cycle 6 — idempotent retry and activity count.
	it("accepts retries after completion without duplicating activity", async () => {
		const fixtures = getFixtures();
		const boardDone = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: fixtures.atlasBoard.version });
		expect(boardDone.status).toBe(200);
		const boardRetry = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: fixtures.atlasBoard.version });
		expect(boardRetry.status).toBe(200);
		expect(boardRetry.body).toMatchObject({ source: "board", key: "AT-18" });
		expect(
			await query("SELECT id FROM card_events WHERE card_id = $1", [
				fixtures.atlasBoard.id,
			]),
		).toHaveLength(1);

		const trackerDone = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: fixtures.orbitTracker.version });
		expect(trackerDone.status).toBe(200);
		const trackerRetry = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: fixtures.orbitTracker.version });
		expect(trackerRetry.status).toBe(200);
		expect(trackerRetry.body).toMatchObject({ source: "tracker", key: "OR-4" });
		expect(
			await query("SELECT id FROM tracker_events WHERE tracker_item_id = $1", [
				fixtures.orbitTracker.id,
			]),
		).toHaveLength(1);
	});
}
