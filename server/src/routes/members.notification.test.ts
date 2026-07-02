/**
 * Integration test for MEMBER_JOINED event emission from the members route.
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/routes/members.notification.test.ts
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";
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

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"members route — MEMBER_JOINED event emission (real DB)",
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
					username: "charlie",
					display_name: "Charlie",
					password_hash: "hashed",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			charlieId = charlie.id;

			const workspace = await db
				.insertInto("workspaces")
				.values({ name: "Team Alpha", owner_user_id: adminId, is_personal: false })
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
				.deleteFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db.deleteFrom("users").where("id", "in", [adminId, charlieId]).execute();
		});

		it("emits MEMBER_JOINED after successful member insert with existingMemberIds", async () => {
			const received: unknown[] = [];
			domainBus.once(EVENTS.MEMBER_JOINED, (e) => received.push(e));

			const res = await request(app)
				.post(`/workspaces/${workspaceId}/members`)
				.send({ username: "charlie" });

			expect(res.status).toBe(201);
			expect(received).toHaveLength(1);
			const event = received[0] as {
				payload: {
					newMemberId: number;
					existingMemberIds: number[];
					workspaceName: string;
				};
			};
			expect(event.payload.newMemberId).toBe(charlieId);
			expect(event.payload.existingMemberIds).toEqual([adminId]);
			expect(event.payload.workspaceName).toBe("Team Alpha");
		});
	},
);
