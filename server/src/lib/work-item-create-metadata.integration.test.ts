import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { validateTaskCreateMetadata } from "./work-item-create-metadata.js";

type Fixtures = {
	workspaceId: number;
	otherWorkspaceId: number;
	actorId: number;
	rafiId: number;
	projectId: number;
	otherProjectId: number;
	phaseId: number;
	otherPhaseId: number;
	statusId: number;
	priorityId: number;
	labelId: number;
	otherPriorityId: number;
	otherLabelId: number;
};

const WORKSPACE_ID = 1981;
const OTHER_WORKSPACE_ID = 1982;
const ACTOR_ID = 19810;
const RAFI_ID = 19811;

async function queryId(sql: string, values: unknown[]): Promise<number> {
	const result = await pool.query<{ id: number }>(sql, values);
	return result.rows[0]!.id;
}

async function cleanup() {
	await pool.query(
		"DELETE FROM tracker_phases WHERE project_id IN (SELECT id FROM tracker_projects WHERE workspace_id IN ($1, $2))",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query(
		"DELETE FROM tracker_projects WHERE workspace_id IN ($1, $2)",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query(
		"DELETE FROM tracker_vocabularies WHERE workspace_id IN ($1, $2)",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query(
		"DELETE FROM workspace_members WHERE workspace_id IN ($1, $2)",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query("DELETE FROM workspaces WHERE id IN ($1, $2)", [
		WORKSPACE_ID,
		OTHER_WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [
		ACTOR_ID,
		RAFI_ID,
	]);
}

async function insertBaseFixtures(): Promise<void> {
	await cleanup();
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 'metadata-actor', 'Metadata Actor', 'test'), ($2, 'rafi-metadata', 'Rafi', 'test')",
		[ACTOR_ID, RAFI_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'Metadata Workspace', $3, false), ($2, 'Other Metadata Workspace', $3, false)",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID, ACTOR_ID],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $3, 'owner'), ($1, $4, 'member'), ($2, $3, 'owner')",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID, ACTOR_ID, RAFI_ID],
	);
}

type VocabularyFixtures = Pick<
	Fixtures,
	"statusId" | "priorityId" | "labelId" | "otherPriorityId" | "otherLabelId"
>;

async function createVocabularyFixtures(): Promise<VocabularyFixtures> {
	const statusId = await queryId(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'status', 'Todo metadata', 1, 'blue') RETURNING id",
		[WORKSPACE_ID],
	);
	const priorityId = await queryId(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'priority', 'High metadata', 2, 'blue') RETURNING id",
		[WORKSPACE_ID],
	);
	const labelId = await queryId(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'label', 'Bug metadata', 3, 'blue') RETURNING id",
		[WORKSPACE_ID],
	);
	const otherPriorityId = await queryId(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'priority', 'Other priority metadata', 1, 'blue') RETURNING id",
		[OTHER_WORKSPACE_ID],
	);
	const otherLabelId = await queryId(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'label', 'Other label metadata', 2, 'blue') RETURNING id",
		[OTHER_WORKSPACE_ID],
	);
	return { statusId, priorityId, labelId, otherPriorityId, otherLabelId };
}

type ProjectFixtures = Pick<
	Fixtures,
	"projectId" | "otherProjectId" | "phaseId" | "otherPhaseId"
>;

async function createProjectFixtures(): Promise<ProjectFixtures> {
	const projectId = await queryId(
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Web', 1) RETURNING id",
		[WORKSPACE_ID],
	);
	const otherProjectId = await queryId(
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Other project', 1) RETURNING id",
		[OTHER_WORKSPACE_ID],
	);
	const phaseId = await queryId(
		"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, 'Delivery', 1) RETURNING id",
		[projectId],
	);
	const otherPhaseId = await queryId(
		"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, 'Other phase', 1) RETURNING id",
		[otherProjectId],
	);
	return { projectId, otherProjectId, phaseId, otherPhaseId };
}

async function setup(): Promise<Fixtures> {
	await insertBaseFixtures();
	const vocabularies = await createVocabularyFixtures();
	const projects = await createProjectFixtures();
	return {
		workspaceId: WORKSPACE_ID,
		otherWorkspaceId: OTHER_WORKSPACE_ID,
		actorId: ACTOR_ID,
		rafiId: RAFI_ID,
		...projects,
		...vocabularies,
	};
}

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

integration("transaction-scoped task metadata validation", () => {
	let fixtures: Fixtures;

	beforeEach(async () => {
		fixtures = await setup();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("Reject multiple stale references together", async () => {
		await pool.query("DELETE FROM tracker_projects WHERE id = $1", [
			fixtures.projectId,
		]);
		await pool.query(
			"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[fixtures.workspaceId, fixtures.rafiId],
		);

		await db.transaction().execute(async (trx) => {
			const result = await validateTaskCreateMetadata(
				trx,
				fixtures.workspaceId,
				{
					projectId: fixtures.projectId,
					assigneeIds: [fixtures.rafiId],
				},
			);
			expect(result.fieldErrors).toEqual({
				assigneeIds: expect.any(String),
				projectId: expect.any(String),
			});
			expect(result.mutationPerformed).toBe(false);
		});
	});

	it("rejects a revoked membership in transaction-scoped validation", async () => {
		await pool.query(
			"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[fixtures.workspaceId, fixtures.rafiId],
		);
		await db.transaction().execute(async (trx) => {
			const result = await validateTaskCreateMetadata(
				trx,
				fixtures.workspaceId,
				{
					assigneeIds: [fixtures.rafiId],
				},
			);
			expect(result.fieldErrors).toMatchObject({
				assigneeIds: expect.any(String),
			});
			expect(result.mutationPerformed).toBe(false);
		});
	});

	it("rejects cross-workspace and wrong-kind references together", async () => {
		await db.transaction().execute(async (trx) => {
			const result = await validateTaskCreateMetadata(
				trx,
				fixtures.workspaceId,
				{
					statusId: fixtures.priorityId,
					priorityId: fixtures.otherPriorityId,
					labelIds: [fixtures.otherLabelId, fixtures.statusId],
					assigneeIds: [fixtures.rafiId],
					projectId: fixtures.otherProjectId,
					phaseId: fixtures.phaseId,
				},
			);
			expect(Object.keys(result.fieldErrors ?? {})).toEqual([
				"statusId",
				"priorityId",
				"labelIds",
				"projectId",
				"phaseId",
			]);
			expect(result.mutationPerformed).toBe(false);
		});
	});

	it("validates Phase inference and Project Phase mismatch", async () => {
		await db.transaction().execute(async (trx) => {
			const inferred = await validateTaskCreateMetadata(
				trx,
				fixtures.workspaceId,
				{
					phaseId: fixtures.phaseId,
				},
			);
			expect(inferred.metadata).toMatchObject({
				projectId: fixtures.projectId,
				phaseId: fixtures.phaseId,
			});

			const mismatch = await validateTaskCreateMetadata(
				trx,
				fixtures.workspaceId,
				{
					projectId: fixtures.otherProjectId,
					phaseId: fixtures.phaseId,
				},
			);
			expect(mismatch.fieldErrors).toEqual({
				projectId: expect.any(String),
				phaseId: expect.any(String),
			});
		});
	});
});
