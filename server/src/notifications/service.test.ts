/**
 * Integration tests for the notification service's domain-event handlers.
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/notifications/service.test.ts
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";
import { initNotificationService } from "./service.js";

let workspaceId: number;
let actorId: number;
let assigneeId: number;
let memberAId: number;
let memberBId: number;
let cardId: number;

async function notificationsFor(userId: number, type: string) {
	return db
		.selectFrom("notifications")
		.selectAll()
		.where("user_id", "=", userId)
		.where("workspace_id", "=", workspaceId)
		.where("type", "=", type)
		.execute();
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"notification service (real DB)",
	() => {
		let cleanup: (() => void) | undefined;

		beforeAll(async () => {
			const actor = await db
				.insertInto("users")
				.values({ username: `notif-actor-${Date.now()}`, display_name: "Actor", password_hash: "h" })
				.returning("id")
				.executeTakeFirstOrThrow();
			actorId = actor.id;
			const assignee = await db
				.insertInto("users")
				.values({ username: `notif-assignee-${Date.now()}`, display_name: "Assignee", password_hash: "h" })
				.returning("id")
				.executeTakeFirstOrThrow();
			assigneeId = assignee.id;
			const memberA = await db
				.insertInto("users")
				.values({ username: `notif-membera-${Date.now()}`, display_name: "Member A", password_hash: "h" })
				.returning("id")
				.executeTakeFirstOrThrow();
			memberAId = memberA.id;
			const memberB = await db
				.insertInto("users")
				.values({ username: `notif-memberb-${Date.now()}`, display_name: "Member B", password_hash: "h" })
				.returning("id")
				.executeTakeFirstOrThrow();
			memberBId = memberB.id;

			const workspace = await db
				.insertInto("workspaces")
				.values({ name: "Notif Service WS", owner_user_id: actorId, is_personal: false })
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;

			const column = await db
				.insertInto("columns")
				.values({ title: "Backlog", position: 1000, workspace_id: workspaceId })
				.returning("id")
				.executeTakeFirstOrThrow();

			const card = await db
				.insertInto("cards")
				.values({ title: "Fix login bug", column_id: column.id, position: 1000, workspace_id: workspaceId })
				.returning("id")
				.executeTakeFirstOrThrow();
			cardId = card.id;
		});

		afterAll(async () => {
			await db.deleteFrom("notifications").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("cards").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("columns").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db
				.deleteFrom("users")
				.where("id", "in", [actorId, assigneeId, memberAId, memberBId])
				.execute();
		});

		beforeEach(async () => {
			await db.deleteFrom("notifications").where("workspace_id", "=", workspaceId).execute();
			cleanup = initNotificationService();
		});

		afterEach(() => {
			cleanup?.();
		});

		describe("card:assigned", () => {
			it("inserts notification when actor != assignee", async () => {
				domainBus.emit(EVENTS.CARD_ASSIGNED, {
					type: EVENTS.CARD_ASSIGNED,
					workspaceId,
					actorId,
					payload: { cardId, assigneeId, cardTitle: "Fix login bug", actorDisplayName: "Actor" },
				});
				await vi.waitFor(async () => {
					const rows = await notificationsFor(assigneeId, "card_assigned");
					expect(rows).toHaveLength(1);
				});
				const [row] = await notificationsFor(assigneeId, "card_assigned");
				expect(row.card_id).toBe(cardId);
				expect(row.board_id).toBe(workspaceId);
			});

			it("skips notification when actor === assignee (self-assign)", async () => {
				domainBus.emit(EVENTS.CARD_ASSIGNED, {
					type: EVENTS.CARD_ASSIGNED,
					workspaceId,
					actorId: assigneeId,
					payload: { cardId, assigneeId, cardTitle: "Fix login bug", actorDisplayName: "Assignee" },
				});
				await new Promise((r) => setTimeout(r, 50));
				const rows = await notificationsFor(assigneeId, "card_assigned");
				expect(rows).toHaveLength(0);
			});

			it("skips notification when assigneeId is null (unassigned)", async () => {
				domainBus.emit(EVENTS.CARD_ASSIGNED, {
					type: EVENTS.CARD_ASSIGNED,
					workspaceId,
					actorId,
					payload: { cardId, assigneeId: null, cardTitle: "Fix login bug", actorDisplayName: "Actor" },
				});
				await new Promise((r) => setTimeout(r, 50));
				const rows = await db
					.selectFrom("notifications")
					.selectAll()
					.where("workspace_id", "=", workspaceId)
					.where("type", "=", "card_assigned")
					.execute();
				expect(rows).toHaveLength(0);
			});
		});

		describe("card:dueDateChanged", () => {
			it("inserts notification when actor != assignee", async () => {
				domainBus.emit(EVENTS.CARD_DUE_DATE_CHANGED, {
					type: EVENTS.CARD_DUE_DATE_CHANGED,
					workspaceId,
					actorId,
					payload: {
						cardId,
						assigneeId,
						cardTitle: "Fix login bug",
						actorDisplayName: "Actor",
						oldDueDate: null,
						newDueDate: "2026-07-01",
					},
				});
				await vi.waitFor(async () => {
					const rows = await notificationsFor(assigneeId, "due_date_changed");
					expect(rows).toHaveLength(1);
				});
			});

			it("skips notification when actor === assignee", async () => {
				domainBus.emit(EVENTS.CARD_DUE_DATE_CHANGED, {
					type: EVENTS.CARD_DUE_DATE_CHANGED,
					workspaceId,
					actorId: assigneeId,
					payload: {
						cardId,
						assigneeId,
						cardTitle: "Fix login bug",
						actorDisplayName: "Assignee",
						oldDueDate: "2026-06-30",
						newDueDate: "2026-07-01",
					},
				});
				await new Promise((r) => setTimeout(r, 50));
				const rows = await notificationsFor(assigneeId, "due_date_changed");
				expect(rows).toHaveLength(0);
			});
		});

		describe("card:dueDateRemoved", () => {
			it("inserts removed-due-date notification via dueDateChanged handler", async () => {
				domainBus.emit(EVENTS.CARD_DUE_DATE_REMOVED, {
					type: EVENTS.CARD_DUE_DATE_REMOVED,
					workspaceId,
					actorId,
					payload: {
						cardId,
						assigneeId,
						cardTitle: "Fix login bug",
						actorDisplayName: "Bob",
						oldDueDate: "2026-07-01",
					},
				});
				await vi.waitFor(async () => {
					const rows = await notificationsFor(assigneeId, "due_date_changed");
					expect(rows).toHaveLength(1);
				});
				const [row] = await notificationsFor(assigneeId, "due_date_changed");
				expect(row.title).toContain("removed due date");
			});
		});

		describe("member:joined", () => {
			it("inserts welcome notification for new member", async () => {
				domainBus.emit(EVENTS.MEMBER_JOINED, {
					type: EVENTS.MEMBER_JOINED,
					workspaceId,
					actorId,
					payload: {
						newMemberId: memberAId,
						newMemberDisplayName: "Member A",
						workspaceName: "Notif Service WS",
						existingMemberIds: [memberBId],
					},
				});
				await vi.waitFor(async () => {
					const rows = await notificationsFor(memberAId, "welcome");
					expect(rows).toHaveLength(1);
				});
			});

			it("skips duplicate welcome when member already has one in workspace", async () => {
				await db
					.insertInto("notifications")
					.values({
						user_id: memberAId,
						workspace_id: workspaceId,
						type: "welcome",
						title: "Existing welcome",
					})
					.execute();

				domainBus.emit(EVENTS.MEMBER_JOINED, {
					type: EVENTS.MEMBER_JOINED,
					workspaceId,
					actorId,
					payload: {
						newMemberId: memberAId,
						newMemberDisplayName: "Member A",
						workspaceName: "Notif Service WS",
						existingMemberIds: [memberBId],
					},
				});
				await vi.waitFor(async () => {
					const rows = await notificationsFor(memberBId, "member_joined");
					expect(rows).toHaveLength(1);
				});
				const welcomeRows = await notificationsFor(memberAId, "welcome");
				expect(welcomeRows).toHaveLength(1); // still just the pre-existing one
			});
		});

		describe("card:deleted (source_deleted)", () => {
			it("sets source_deleted=true on notifications when card is deleted", async () => {
				await db
					.insertInto("notifications")
					.values({
						user_id: assigneeId,
						workspace_id: workspaceId,
						type: "card_assigned",
						title: "pre-existing",
						card_id: cardId,
					})
					.execute();

				domainBus.emit(EVENTS.CARD_DELETED, {
					type: EVENTS.CARD_DELETED,
					workspaceId,
					actorId,
					payload: { cardId },
				});
				await vi.waitFor(async () => {
					const row = await db
						.selectFrom("notifications")
						.select("source_deleted")
						.where("card_id", "=", cardId)
						.executeTakeFirstOrThrow();
					expect(row.source_deleted).toBe(true);
				});
			});
		});

		describe("system:alert", () => {
			it("inserts system_alert notification for all workspace members", async () => {
				await db
					.insertInto("workspace_members")
					.values([
						{ workspace_id: workspaceId, user_id: memberAId, role: "member" },
						{ workspace_id: workspaceId, user_id: memberBId, role: "member" },
					])
					.execute();

				domainBus.emit(EVENTS.SYSTEM_ALERT, {
					type: EVENTS.SYSTEM_ALERT,
					workspaceId,
					actorId,
					payload: { title: "Maintenance at midnight", body: "Server restart at 00:00 UTC" },
				});
				await vi.waitFor(async () => {
					const rows = await db
						.selectFrom("notifications")
						.selectAll()
						.where("workspace_id", "=", workspaceId)
						.where("type", "=", "system_alert")
						.execute();
					expect(rows).toHaveLength(2);
				});

				await db
					.deleteFrom("workspace_members")
					.where("workspace_id", "=", workspaceId)
					.where("user_id", "in", [memberAId, memberBId])
					.execute();
			});
		});
	},
);
