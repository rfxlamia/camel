/**
 * Integration test for the combined invite-always + pending-invites contract.
 *
 * Covers the observable behavior that emerges only when PR #229 (existing
 * users are invited instead of silently added) and PR #228 (owner/admin
 * pending-invite visibility and cancellation) run together:
 *
 * A. Owner invites an existing registered user → they are NOT added as a
 *    member, the invitation is visible to the owner via GET /members, and
 *    membership is established only after the invitee accepts — with
 *    MEMBER_JOINED emitted exactly once and the invite gone afterwards.
 * B. Owner cancels a pending invite → the invitee can no longer accept it.
 * D. Plain members cannot see pending invitations or cancel other users'
 *    invites, but the invitee can still decline their own invite.
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/modules/workspaces/invite-always-lifecycle.integration.test.ts
 */
import "dotenv/config";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/kysely.js";
import { domainBus, EVENTS } from "../../events.js";
import { invitesRouter } from "./invites.js";
import { membersRouter } from "./members.js";

const stamp = Date.now();
const ownerUsername = `ia-owner-${stamp}`;
const bobUsername = `ia-bob-${stamp}`;
const carolUsername = `ia-carol-${stamp}`;
const miaUsername = `ia-mia-${stamp}`;

let ownerId: number;
let bobId: number;
let carolId: number;
let miaId: number;
let workspaceId: number;

type TestUser = { id: number; username: string; displayName: string };

function appAs(user: TestUser) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		(req as Record<string, unknown>).user = user;
		next();
	});
	app.use("/workspaces/:workspaceId", membersRouter);
	app.use("/workspaces/:workspaceId", invitesRouter);
	return app;
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"invite-always + pending-invites combined lifecycle (real DB)",
	() => {
		let ownerApp: ReturnType<typeof appAs>;
		let bobApp: ReturnType<typeof appAs>;
		let miaApp: ReturnType<typeof appAs>;

		beforeAll(async () => {
			const users = await db
				.insertInto("users")
				.values([
					{
						username: ownerUsername,
						display_name: "Owner",
						password_hash: "hashed",
					},
					{
						username: bobUsername,
						display_name: "Bob",
						password_hash: "hashed",
					},
					{
						username: carolUsername,
						display_name: "Carol",
						password_hash: "hashed",
					},
					{
						username: miaUsername,
						display_name: "Mia",
						password_hash: "hashed",
					},
				])
				.returning(["id", "username", "display_name"])
				.execute();
			const [owner, bob, carol, mia] = users;
			ownerId = owner.id;
			bobId = bob.id;
			carolId = carol.id;
			miaId = mia.id;

			const ws = await db
				.insertInto("workspaces")
				.values({
					name: "Invite Always Lifecycle",
					owner_user_id: ownerId,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = ws.id;

			await db
				.insertInto("workspace_members")
				.values([
					{ workspace_id: workspaceId, user_id: ownerId, role: "owner" },
					{ workspace_id: workspaceId, user_id: miaId, role: "member" },
				])
				.execute();

			ownerApp = appAs({
				id: ownerId,
				username: ownerUsername,
				displayName: "Owner",
			});
			bobApp = appAs({ id: bobId, username: bobUsername, displayName: "Bob" });
			miaApp = appAs({ id: miaId, username: miaUsername, displayName: "Mia" });
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
				.where("id", "in", [ownerId, bobId, carolId, miaId])
				.execute();
		});

		it("Scenario A: existing user is invited, not added, joins only on acceptance with exactly one MEMBER_JOINED", async () => {
			const joined: unknown[] = [];
			domainBus.on(EVENTS.MEMBER_JOINED, (e) => joined.push(e));

			// Owner invites the already-registered Bob.
			const inviteRes = await request(ownerApp)
				.post(`/workspaces/${workspaceId}/members`)
				.send({ username: bobUsername });
			expect(inviteRes.status).toBe(201);
			expect(inviteRes.body).toMatchObject({
				username: bobUsername,
				role: "member",
				pending: true,
			});

			// No membership and no MEMBER_JOINED at invitation time.
			const membersBefore = await db
				.selectFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", bobId)
				.select("user_id")
				.execute();
			expect(membersBefore).toHaveLength(0);
			expect(joined).toHaveLength(0);

			// Owner sees the pending invitation; Bob is not listed as a member.
			const ownerView = await request(ownerApp).get(
				`/workspaces/${workspaceId}/members`,
			);
			expect(ownerView.status).toBe(200);
			expect(
				ownerView.body.members.some(
					(m: { username: string }) => m.username === bobUsername,
				),
			).toBe(false);
			expect(ownerView.body.invites).toEqual([
				{ id: inviteRes.body.id, username: bobUsername, role: "member" },
			]);

			// Duplicate invite of the same username is rejected.
			const dupRes = await request(ownerApp)
				.post(`/workspaces/${workspaceId}/members`)
				.send({ username: bobUsername });
			expect(dupRes.status).toBe(409);

			// Bob accepts: membership established, invite gone, MEMBER_JOINED once.
			const acceptRes = await request(bobApp).post(
				`/workspaces/${workspaceId}/invites/${inviteRes.body.id}/accept`,
			);
			expect(acceptRes.status).toBe(200);

			const membersAfter = await db
				.selectFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", bobId)
				.select("user_id")
				.execute();
			expect(membersAfter).toHaveLength(1);

			const invitesAfter = await db
				.selectFrom("workspace_invites")
				.where("workspace_id", "=", workspaceId)
				.where("username", "=", bobUsername)
				.select("id")
				.execute();
			expect(invitesAfter).toHaveLength(0);

			expect(joined).toHaveLength(1);
		});

		it("Scenario B: a cancelled pending invitation can no longer be accepted", async () => {
			const inviteRes = await request(ownerApp)
				.post(`/workspaces/${workspaceId}/members`)
				.send({ username: carolUsername });
			expect(inviteRes.status).toBe(201);

			const ownerView = await request(ownerApp).get(
				`/workspaces/${workspaceId}/members`,
			);
			expect(
				ownerView.body.invites.some(
					(i: { username: string }) => i.username === carolUsername,
				),
			).toBe(true);

			const cancelRes = await request(ownerApp).delete(
				`/workspaces/${workspaceId}/invites/${inviteRes.body.id}`,
			);
			expect(cancelRes.status).toBe(204);

			const carolApp = appAs({
				id: carolId,
				username: carolUsername,
				displayName: "Carol",
			});
			const acceptRes = await request(carolApp).post(
				`/workspaces/${workspaceId}/invites/${inviteRes.body.id}/accept`,
			);
			expect(acceptRes.status).toBe(404);

			const carolMember = await db
				.selectFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", carolId)
				.select("user_id")
				.execute();
			expect(carolMember).toHaveLength(0);
		});

		it("Scenario D: plain members see no invitations and cannot cancel; the invitee can decline their own invite", async () => {
			// Re-invite Bob (Scenario A consumed his invite).
			const inviteRes = await request(ownerApp)
				.post(`/workspaces/${workspaceId}/members`)
				.send({ username: bobUsername });
			expect(inviteRes.status).toBe(201);

			// A plain member gets no privileged invitation data.
			const miaView = await request(miaApp).get(
				`/workspaces/${workspaceId}/members`,
			);
			expect(miaView.status).toBe(200);
			expect(miaView.body.invites).toBeUndefined();
			expect(
				miaView.body.members.some(
					(m: { username: string }) => m.username === bobUsername,
				),
			).toBe(false);

			// A plain member cannot cancel someone else's invitation.
			const miaCancel = await request(miaApp).delete(
				`/workspaces/${workspaceId}/invites/${inviteRes.body.id}`,
			);
			expect(miaCancel.status).toBe(404);

			// The invitee can still decline their own invitation.
			const bobDecline = await request(bobApp).delete(
				`/workspaces/${workspaceId}/invites/${inviteRes.body.id}`,
			);
			expect(bobDecline.status).toBe(204);

			const invitesLeft = await db
				.selectFrom("workspace_invites")
				.where("workspace_id", "=", workspaceId)
				.select("id")
				.execute();
			expect(invitesLeft).toHaveLength(0);

			const bobMember = await db
				.selectFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", bobId)
				.select("user_id")
				.execute();
			expect(bobMember).toHaveLength(1); // from Scenario A acceptance only
		});
	},
);
