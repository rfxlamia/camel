// Requires PostgreSQL. Run with RUN_INTEGRATION=1 and the exact workspace-scoped command.
import "dotenv/config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { SCHEMA } = vi.hoisted(() => ({
	SCHEMA: `cutover_snapshot_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`,
}));

vi.mock("../db/pool.js", async () => {
	const { createScratchPool } = await import(
		"../db/scratch-pool-test-support.js"
	);
	return { pool: createScratchPool(SCHEMA) };
});

import { db } from "../db/kysely.js";
import { applySchema } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "../db/scratch-schema-test-support.js";
import {
	rows,
	seedItem,
	seedWorkspace,
} from "../db/work-item-merge.test-support.js";
import {
	BOARD_CARDS,
	DONE,
	IN_PROGRESS,
	seedReferenceWorkspace,
	TRACKER_ITEMS,
} from "../db/work-item-merged-fixture.test-support.js";
import { main, takeSnapshot, verifySnapshot } from "./cutover-snapshot.js";

const runIntegration = process.env.RUN_INTEGRATION === "1";
const KEY_MESSAGE = "reference-fixture-workspace";

type ReferenceFixture = Awaited<ReturnType<typeof seedReferenceWorkspace>>;

describe.skipIf(!runIntegration)("cutover snapshot parity gate", () => {
	let scratch: ScratchSchema;
	let reference: ReferenceFixture;
	let secondaryWorkspaceId: number;
	let snapshotFile: string;
	let tempDirectory: string;

	beforeEach(async () => {
		scratch = await createScratchSchema("cutover_snapshot", { schema: SCHEMA });
		await applySchema(scratch.client);
		reference = await seedReferenceWorkspace(scratch, KEY_MESSAGE);

		const other = await seedWorkspace(scratch, "secondary-fixture-workspace");
		secondaryWorkspaceId = other.id;
		const [column] = await rows<{ id: number }>(
			scratch,
			`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Queue', 1024, false) RETURNING id`,
			[other.id],
		);
		await scratch.client.query(
			`INSERT INTO cards (workspace_id, column_id, title, position, key_number, status_id)
			 VALUES ($1, $2, 'secondary-card', 1024, 1, $3)`,
			[other.id, column.id, other.statusId],
		);
		await seedItem(scratch, other, 2);

		tempDirectory = await mkdtemp(join(tmpdir(), "camel-cutover-snapshot-"));
		snapshotFile = join(tempDirectory, "before.json");
	});

	afterEach(async () => {
		await rm(tempDirectory, { recursive: true, force: true });
		await scratch?.drop();
	});

	afterAll(async () => {
		await pool.end();
	});

	it("compares all workspace keys and visible board/tracker counts after merge", async () => {
		const snapshot = await takeSnapshot(db);
		const referenceSnapshot = snapshot.workspaces.find(
			(workspace) => workspace.workspaceId === reference.workspaceId,
		);
		expect(referenceSnapshot).toMatchObject({
			keys: [...reference.boardKeys, ...reference.trackerKeys].sort(
				(a, b) => a - b,
			),
			trackerCount: TRACKER_ITEMS,
			boardCount: BOARD_CARDS,
			inProgressCount: IN_PROGRESS,
			doneCount: DONE,
		});
		expect(
			snapshot.workspaces.map((workspace) => workspace.workspaceId),
		).toEqual(
			[reference.workspaceId, secondaryWorkspaceId].sort((a, b) => a - b),
		);
		expect(JSON.stringify(snapshot)).not.toContain(KEY_MESSAGE);

		await writeFile(snapshotFile, `${JSON.stringify(snapshot)}\n`, {
			mode: 0o600,
		});
		await applySchema(scratch.client, { workItemMerge: true });

		expect(await verifySnapshot(db, snapshot)).toBe(true);
		await expect(main(["verify", snapshotFile])).resolves.toBe(0);
	});
});
