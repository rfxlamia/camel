/**
 * Integration test for notification timing on the members route.
 *
 * POST /members never adds an existing user directly anymore — it creates a
 * pending invite and must NOT emit MEMBER_JOINED. Membership (and the
 * MEMBER_JOINED event) only happens when the invite is accepted via
 * POST /invites/:inviteId/accept (covered by invites.notification.test.ts).
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/modules/workspaces/members.notification.test.ts
 */
import "dotenv/config";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/kysely.js";
import { domainBus, EVENTS } from "../../events.js";
import { membersRouter } from "./members.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as Record<string, unknown>).user = { id: adminId, displayName: "Admin" };
	next();
});
app.use("/workspaces/:workspaceId", membersRouter);

let adminId: number;
let charlieId: number;
let workspaceId: number;
const charlieUsername = `members-notif-charlie-${Date.now()}`;

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"members route — inviting an existing user must not emit MEMBER_JOINED (real DB)",
	() => {
		beforeAll(async () => {
			const admin = await db
				.insertInto("users")
				.values({
					username: `members-notif-admin-${Date.now()}`,
					display_name: "Admin",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			adminId = admin.id;

			const charlie = await db
				.insertInto("users")
				.values({
					username: charlieUsername,
					display_name: "Charlie",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			charlieId = charlie.id;

			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: "Team Alpha",
					owner_user_id: adminId,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;

			await db
				.insertInto("workspace_members")
				.values({ workspace_id: workspaceId, user_id: adminId, role: "admin" })
				.execute();
		});

		afterEach(() => {
			domainBus.removeAllListeners();
		});

		afterAll(async () => {
			await db
				.deleteFrom("workspace_invites")
				.where("workspace_id", "=", workspaceId)
				.execute();
			await db
				.deleteFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db
				.deleteFrom("users")
				.where("id", "in", [adminId, charlieId])
				.execute();
		});

		it("creates a pending invite without emitting MEMBER_JOINED or adding a member", async () => {
			const received: unknown[] = [];
			domainBus.once(EVENTS.MEMBER_JOINED, (e) => received.push(e));

			const res = await request(app)
				.post(`/workspaces/${workspaceId}/members`)
				.send({ username: charlieUsername });

			// The response is a pending invite, not a direct add.
			expect(res.status).toBe(201);
			expect(res.body).toMatchObject({
				workspaceId,
				username: charlieUsername,
				pending: true,
			});

			// MEMBER_JOINED must only fire on invite acceptance, not here.
			// Give any (incorrect) synchronous emit a tick to land.
			await new Promise((r) => setTimeout(r, 25));
			expect(received).toHaveLength(0);

			// No membership row at invite time…
			const members = await db
				.selectFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", charlieId)
				.select("user_id")
				.execute();
			expect(members).toHaveLength(0);

			// …but exactly one pending invite for the username.
			const invites = await db
				.selectFrom("workspace_invites")
				.where("workspace_id", "=", workspaceId)
				.where("username", "=", charlieUsername)
				.select("id")
				.execute();
			expect(invites).toHaveLength(1);
		});

		it("returns 409 for a duplicate pending invite of the same username", async () => {
			const res = await request(app)
				.post(`/workspaces/${workspaceId}/members`)
				.send({ username: charlieUsername });

			expect(res.status).toBe(409);
			expect(res.body).toEqual({
				error: "Invite already pending for this username",
			});
		});
	},
);
