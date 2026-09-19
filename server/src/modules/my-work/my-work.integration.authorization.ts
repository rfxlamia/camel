import request from "supertest";
import { expect, it } from "vitest";
import {
	ALICE_ID,
	ATLAS_ID,
	app,
	boardState,
	expectNoCardEvents,
	expectNoTrackerEvents,
	type Fixtures,
	getFixtures,
	ORBIT_ID,
	pool,
	trackerState,
} from "./my-work.integration.shared.js";

async function assertBoardUnmappable(fixtures: Fixtures): Promise<void> {
	const before = await boardState(fixtures.atlasBoard.id);
	await pool.query(
		"DELETE FROM columns WHERE workspace_id = $1 AND is_done = true",
		[ATLAS_ID],
	);
	const response = await request(app)
		.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
		.send({ version: before.version });
	expect(response.status).toBe(409);
	expect(response.body).toMatchObject({
		code: "status_column_unmappable",
		error: "This status cannot be mapped to the current board columns.",
	});
	expect(await boardState(fixtures.atlasBoard.id)).toEqual(before);
	await expectNoCardEvents(fixtures.atlasBoard.id);
}

async function assertTrackerUnmappable(fixtures: Fixtures): Promise<void> {
	const before = await trackerState(fixtures.orbitTracker.id);
	await pool.query(
		"DELETE FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status' AND slot = 'done'",
		[ORBIT_ID],
	);
	const response = await request(app)
		.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
		.send({ version: before.version });
	expect(response.status).toBe(409);
	expect(response.body).toMatchObject({
		code: "status_column_unmappable",
		error: "This status cannot be mapped to the current Tracker statuses.",
	});
	expect(response.body.error).not.toMatch(/current board columns/i);
	expect(await trackerState(fixtures.orbitTracker.id)).toEqual(before);
	await expectNoTrackerEvents(fixtures.orbitTracker.id);
}

export function registerAuthorizationScenarios(): void {
	// Cycle 7 — revoked membership returns 404/not_found without any write.
	it("rejects Mark done after membership revocation without source activity", async () => {
		const fixtures = getFixtures();
		const before = await boardState(fixtures.atlasBoard.id);
		await pool.query(
			"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[ATLAS_ID, ALICE_ID],
		);
		const response = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: before.version });

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "Not found" });
		expect(await boardState(fixtures.atlasBoard.id)).toEqual(before);
		await expectNoCardEvents(fixtures.atlasBoard.id);
	});

	// Cycle 8 — removed assignment returns 404/not_found without any write.
	it("rejects Mark done after assignment removal without source activity", async () => {
		const fixtures = getFixtures();
		const before = await trackerState(fixtures.orbitTracker.id);
		await pool.query(
			"DELETE FROM tracker_item_assignees WHERE tracker_item_id = $1 AND user_id = $2",
			[fixtures.orbitTracker.id, ALICE_ID],
		);
		const response = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: before.version });

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "Not found" });
		expect(await trackerState(fixtures.orbitTracker.id)).toEqual(before);
		await expectNoTrackerEvents(fixtures.orbitTracker.id);
	});

	// Cycle 9 — missing Board/Tracker done mappings return unmappable without a write.
	it("returns status_column_unmappable when either done mapping is absent", async () => {
		const fixtures = getFixtures();
		await assertBoardUnmappable(fixtures);
		await assertTrackerUnmappable(fixtures);
	});
}
