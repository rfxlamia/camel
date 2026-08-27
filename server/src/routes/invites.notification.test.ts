/**
 * Integration test for MEMBER_JOINED event emission from the invites route.
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/routes/invites.notification.test.ts
 */
import "dotenv/config";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";
import { invitesRouter } from "./invites.js";

const inviteeUsername = `invitee-charlie-${Date.now()}`;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as Record<string, unknown>).user = {
		id: userId,
		username: inviteeUsername,
		displayName: "Charlie",
	};
	next();
});
app.use("/workspaces/:workspaceId", invitesRouter);

let ownerId: number;
let userId: number;
let workspaceId: number;

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"invites route — MEMBER_JOINED event emission (real DB)",
	() => {
		beforeAll(async () => {
			const owner = await db
				.insertInto("users")
				.values({
					username: `invites-notif-owner-${Date.now()}`,
					display_name: "Owner",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			ownerId = owner.id;

			const invitee = await db
				.insertInto("users")
				.values({
					username: inviteeUsername,
					display_name: "Charlie",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			userId = invitee.id;

			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: "Team Alpha",
					owner_user_id: ownerId,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;

			await db
				.insertInto("workspace_members")
				.values({ workspace_id: workspaceId, user_id: ownerId, role: "owner" })
				.execute();
		});

		afterEach(() => {
			domainBus.removeAllListeners();
		});

		afterAll(async () => {
			await db
				.deleteFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db
				.deleteFrom("users")
				.where("id", "in", [ownerId, userId])
				.execute();
		});

		it("emits MEMBER_JOINED after successful invite accept", async () => {
			const invite = await db
				.insertInto("workspace_invites")
				.values({
					workspace_id: workspaceId,
					username: inviteeUsername,
					role: "member",
				})
				.returning("id")
				.executeTakeFirstOrThrow();

			const received: unknown[] = [];
			domainBus.once(EVENTS.MEMBER_JOINED, (e) => received.push(e));

			const res = await request(app).post(
				`/workspaces/${workspaceId}/invites/${invite.id}/accept`,
			);

			expect(res.status).toBe(200);
			expect(received).toHaveLength(1);
			const event = received[0] as {
				payload: {
					newMemberId: number;
					existingMemberIds: number[];
					workspaceName: string;
					newMemberDisplayName: string;
				};
			};
			expect(event.payload.newMemberId).toBe(userId);
			expect(event.payload.newMemberDisplayName).toBe("Charlie");
			expect(event.payload.existingMemberIds).toContain(ownerId);
			expect(event.payload.workspaceName).toBe("Team Alpha");

			await db
				.deleteFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", userId)
				.execute();
		});

		it("rejects accept of an invite that no longer exists", async () => {
			const res = await request(app).post(
				`/workspaces/${workspaceId}/invites/999999999/accept`,
			);
			expect(res.status).toBe(404);
		});

		// A prior version of this suite injected a mid-request invite revoke by
		// spying on countUserMemberships, the workspace-cap check that used to
		// run (and `await`) before the transaction opened — that await was the
		// TOCTOU window being exercised. The cap check is gone, so there is no
		// pre-transaction await left to hook. The property under test — a
		// revoked invite must not still be usable — is covered by the atomic
		// delete-as-authorization-check inside the transaction (invites.ts) and
		// exercised above by "rejects accept of an invite that no longer exists".
	},
);
