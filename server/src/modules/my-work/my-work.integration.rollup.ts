import request from "supertest";
import { expect, it } from "vitest";
import {
	ALICE_ID,
	ATLAS_ID,
	app,
	getFixtures,
	ORBIT_ID,
	pool,
} from "./my-work.integration.shared.js";

type ListedItem = {
	identity: { key: string; workspaceId: number; source: string };
	title: string;
	assignees: unknown[];
};

export function registerRollupScenarios(): void {
	// Cycle 1 — authorized cross-workspace rollup and composite identity.
	it("lists authorized Board/Tracker work once with tracker-wins composite identity", async () => {
		const response = await request(app).get("/api/my-work?scope=active");

		expect(response.status).toBe(200);
		expect(response.body.nextCursor).toBeNull();
		const items = response.body.items as ListedItem[];
		expect(items).toHaveLength(4);
		expect(items.map((item) => item.identity)).toEqual(
			expect.arrayContaining([
				{ workspaceId: ATLAS_ID, source: "tracker", key: "AT-17" },
				{ workspaceId: ATLAS_ID, source: "board", key: "AT-18" },
				{ workspaceId: ORBIT_ID, source: "tracker", key: "OR-4" },
				{ workspaceId: ORBIT_ID, source: "board", key: "OR-17" },
			]),
		);
		expect(items.filter((item) => item.identity.key === "AT-17")).toHaveLength(
			1,
		);
		expect(items).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Atlas board shadow" }),
			]),
		);
		expect(items).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Nebula secret assigned work" }),
			]),
		);
		expect(
			items.find((item) => item.identity.key === "OR-4")?.assignees,
		).toHaveLength(2);
	});

	// Cycle 2 — detail reauthorization after membership/assignment revocation.
	it("reauthorizes detail and returns 404 without cached content", async () => {
		const fixtures = getFixtures();
		const listResponse = await request(app).get("/api/my-work?scope=active");
		expect(listResponse.status).toBe(200);
		expect(
			(listResponse.body.items as ListedItem[]).some(
				(item) => item.identity.key === "AT-18",
			),
		).toBe(true);

		const before = await request(app).get(
			`/api/my-work/${ATLAS_ID}/board/AT-18`,
		);
		expect(before.status).toBe(200);
		expect(before.body.title).toBe("Atlas Board assigned work");

		await pool.query(
			"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[ATLAS_ID, ALICE_ID],
		);
		const afterMembershipRevocation = await request(app).get(
			`/api/my-work/${ATLAS_ID}/board/AT-18`,
		);
		expect(afterMembershipRevocation.status).toBe(404);
		expect(afterMembershipRevocation.body).toEqual({ error: "Not found" });
		expect(JSON.stringify(afterMembershipRevocation.body)).not.toContain(
			"Atlas Board assigned work",
		);

		await pool.query(
			"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
			[ATLAS_ID, ALICE_ID],
		);
		await pool.query(
			"DELETE FROM card_assignees WHERE card_id = $1 AND user_id = $2",
			[fixtures.atlasBoard.id, ALICE_ID],
		);
		const afterAssignmentRevocation = await request(app).get(
			`/api/my-work/${ATLAS_ID}/board/AT-18`,
		);
		expect(afterAssignmentRevocation.status).toBe(404);
		expect(afterAssignmentRevocation.body).toEqual({ error: "Not found" });
		expect(JSON.stringify(afterAssignmentRevocation.body)).not.toContain(
			"Atlas Board assigned work",
		);
	});
}
