/**
 * Integration tests for PATCH /members/:userId and DELETE self-removal guard.
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1
 * (same flag as test:integration:routes in CI).
 *
 * Run from repo root:
 *   RUN_INTEGRATION=1 npm run test -- server/src/routes/members-role.patch.integration.test.ts
 */
import "dotenv/config";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../auth.js";
import { db } from "../db/kysely.js";
import { membersRouter } from "./members.js";

let currentUserId: number;

function testUser(id: number): AuthUser {
	return {
		id,
		username: null,
		displayName: "",
		email: null,
		emailVerified: false,
		needsUsername: false,
	};
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	req.user = testUser(currentUserId);
	next();
});
app.use("/workspaces/:workspaceId", membersRouter);

let ownerId: number;
let adminId: number;
let memberId: number;
let workspaceId: number;
const ts = Date.now();

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"members route — PATCH role and DELETE self-removal (real DB)",
	() => {
		beforeAll(async () => {
			const owner = await db
				.insertInto("users")
				.values({
					username: `role-patch-owner-${ts}`,
					display_name: "Owner",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			ownerId = owner.id;

			const admin = await db
				.insertInto("users")
				.values({
					username: `role-patch-admin-${ts}`,
					display_name: "Admin",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			adminId = admin.id;

			const member = await db
				.insertInto("users")
				.values({
					username: `role-patch-member-${ts}`,
					display_name: "Member",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			memberId = member.id;

			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: "Role Patch WS",
					owner_user_id: ownerId,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;

			await db
				.insertInto("workspace_members")
				.values([
					{ workspace_id: workspaceId, user_id: ownerId, role: "owner" },
					{ workspace_id: workspaceId, user_id: adminId, role: "admin" },
					{ workspace_id: workspaceId, user_id: memberId, role: "member" },
				])
				.execute();
		});

		afterAll(async () => {
			await db
				.deleteFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db
				.deleteFrom("users")
				.where("id", "in", [ownerId, adminId, memberId])
				.execute();
		});

		it("owner promotes member to admin and persists role in DB", async () => {
			currentUserId = ownerId;

			const res = await request(app)
				.patch(`/workspaces/${workspaceId}/members/${memberId}`)
				.send({ role: "admin" });

			expect(res.status).toBe(200);
			expect(res.body).toMatchObject({
				userId: memberId,
				role: "admin",
			});

			const row = await db
				.selectFrom("workspace_members")
				.select("role")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", memberId)
				.executeTakeFirstOrThrow();
			expect(row.role).toBe("admin");

			await db
				.updateTable("workspace_members")
				.set({ role: "member" })
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", memberId)
				.execute();
		});

		it("admin actor receives 404 when attempting role change", async () => {
			currentUserId = adminId;

			const res = await request(app)
				.patch(`/workspaces/${workspaceId}/members/${memberId}`)
				.send({ role: "admin" });

			expect(res.status).toBe(404);
			expect(res.body).toEqual({ error: "Not found" });
		});

		it("owner cannot remove themselves via DELETE", async () => {
			currentUserId = ownerId;

			const res = await request(app).delete(
				`/workspaces/${workspaceId}/members/${ownerId}`,
			);

			expect(res.status).toBe(403);
			expect(res.body).toEqual({ error: "Cannot remove yourself" });
		});
	},
);
