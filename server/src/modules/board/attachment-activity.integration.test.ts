// Integration test for cards-side attachment activity persistence.
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/attachment-activity.integration.test.ts
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../../auth.js";
import { seedTrackerVocabulary } from "../../core/tracker-vocabulary-seed.js";
import { db } from "../../db/kysely.js";
import { pool } from "../../db/pool.js";
import { recordActivity } from "../../lib/helpers.js";

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

let workspaceId: number | undefined;
let actorId: number | undefined;

async function createFixtures(): Promise<{
	actor: AuthUser;
	cardId: number;
	workspaceId: number;
}> {
	const suffix = randomUUID();
	const actor = await db
		.insertInto("users")
		.values({
			username: `attachment-activity-${suffix}`,
			display_name: "Attachment Activity Actor",
			password_hash: "fixture-password-hash",
		})
		.returning(["id", "username", "display_name"])
		.executeTakeFirstOrThrow();
	actorId = actor.id;

	const workspace = await db
		.insertInto("workspaces")
		.values({
			name: `Attachment activity ${suffix}`,
			owner_user_id: actor.id,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	workspaceId = workspace.id;

	await db
		.insertInto("workspace_members")
		.values({
			workspace_id: workspace.id,
			user_id: actor.id,
			role: "owner",
		})
		.execute();

	await seedTrackerVocabulary(db, workspace.id);
	const status = await db
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", workspace.id)
		.where("kind", "=", "status")
		.where("slot", "=", "todo")
		.executeTakeFirstOrThrow();
	const column = await db
		.insertInto("columns")
		.values({
			workspace_id: workspace.id,
			title: "Todo",
			position: 1024,
			policy: "manual",
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	const card = await db
		.insertInto("cards")
		.values({
			workspace_id: workspace.id,
			column_id: column.id,
			status_id: status.id,
			title: "Attachment activity card",
			description: "",
			position: 1024,
		})
		.returning("id")
		.executeTakeFirstOrThrow();

	return {
		actor: {
			id: actor.id,
			username: actor.username,
			displayName: actor.display_name,
			email: null,
			emailVerified: false,
			needsUsername: false,
		},
		cardId: card.id,
		workspaceId: workspace.id,
	};
}

async function cleanupFixtures(): Promise<void> {
	if (workspaceId !== undefined) {
		await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
		workspaceId = undefined;
	}
	if (actorId !== undefined) {
		await db.deleteFrom("users").where("id", "=", actorId).execute();
		actorId = undefined;
	}
}

afterAll(async () => {
	await cleanupFixtures();
	await pool.end();
});

integration("cards-side attachment activity events", () => {
	it("persists both attachment events with nullable move columns and metadata only", async () => {
		const fixtures = await createFixtures();
		const addedPayload = {
			attachmentId: 101,
			mimeType: "image/png",
			createdAt: "2026-09-05T10:00:00.000Z",
		};
		const removedPayload = {
			attachmentId: 101,
			mimeType: "image/png",
			createdAt: "2026-09-05T10:00:00.000Z",
		};

		await recordActivity(
			db,
			fixtures.actor,
			fixtures.workspaceId,
			"attachment_added",
			{
				cardId: fixtures.cardId,
				payload: addedPayload,
			},
		);
		await recordActivity(
			db,
			fixtures.actor,
			fixtures.workspaceId,
			"attachment_removed",
			{
				cardId: fixtures.cardId,
				payload: removedPayload,
			},
		);

		const result = await pool.query<{
			card_id: number;
			actor_id: number;
			workspace_id: number;
			event_type: string;
			from_column_id: number | null;
			to_column_id: number | null;
			payload: Record<string, unknown>;
		}>(
			`SELECT card_id, actor_id, workspace_id, event_type,
					from_column_id, to_column_id, payload
				 FROM card_events
				 WHERE card_id = $1
				 ORDER BY id`,
			[fixtures.cardId],
		);

		expect(result.rows).toEqual([
			{
				card_id: fixtures.cardId,
				actor_id: fixtures.actor.id,
				workspace_id: fixtures.workspaceId,
				event_type: "attachment_added",
				from_column_id: null,
				to_column_id: null,
				payload: addedPayload,
			},
			{
				card_id: fixtures.cardId,
				actor_id: fixtures.actor.id,
				workspace_id: fixtures.workspaceId,
				event_type: "attachment_removed",
				from_column_id: null,
				to_column_id: null,
				payload: removedPayload,
			},
		]);
		expect(Object.keys(result.rows[0]!.payload).sort()).toEqual([
			"attachmentId",
			"createdAt",
			"mimeType",
		]);
	});
});
