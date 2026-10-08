// Requires PostgreSQL. Run with RUN_INTEGRATION=1 and the exact workspace-scoped command.
// `snapshot` must fail closed (exit 1 = cutover point-1 abort) when merge preconditions
// do not hold, instead of letting `verify` false-fail after the merge commits.
import "dotenv/config";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
	SCHEMA: `cutover_precond_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`,
}));

vi.mock("../db/pool.js", async () => {
	const { createScratchPool } = await import(
		"../db/scratch-pool-test-support.js"
	);
	return { pool: createScratchPool(SCHEMA) };
});

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
	type Ws,
} from "../db/work-item-merge.test-support.js";
import { main } from "../scripts/cutover-snapshot.js";

const runIntegration = process.env.RUN_INTEGRATION === "1";
const CUSTOMER_TITLE = "customer-secret-title";

describe.skipIf(!runIntegration)("cutover snapshot preconditions", () => {
	let scratch: ScratchSchema;
	let ws: Ws;
	let columnId: number;
	let snapshotFile: string;
	let tempDirectory: string;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		scratch = await createScratchSchema("cutover_precond", { schema: SCHEMA });
		await applySchema(scratch.client);
		ws = await seedWorkspace(scratch, "precondition-fixture");
		const [column] = await rows<{ id: number }>(
			scratch,
			`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Board', 1024, false) RETURNING id`,
			[ws.id],
		);
		columnId = column.id;
		tempDirectory = await mkdtemp(join(tmpdir(), "camel-cutover-precond-"));
		snapshotFile = join(tempDirectory, "before.json");
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		errorSpy.mockRestore();
		logSpy.mockRestore();
		await rm(tempDirectory, { recursive: true, force: true });
		await scratch?.drop();
	});

	afterAll(async () => {
		await pool.end();
	});

	const addCard = (
		column: number | null,
		key: number | null,
		statusId: number | null,
	) =>
		scratch.client.query(
			`INSERT INTO cards (workspace_id, column_id, title, position, key_number, status_id)
			 VALUES ($1, $2, $3, 1024, $4, $5)`,
			[ws.id, column, CUSTOMER_TITLE, key, statusId],
		);

	const stderr = () => errorSpy.mock.calls.flat().map(String).join("\n");
	const snapshotWritten = () =>
		readFile(snapshotFile, "utf8").then(
			() => true,
			() => false,
		);

	it("writes the snapshot and exits 0 when preconditions hold", async () => {
		await addCard(columnId, 1, ws.statusId);
		await seedItem(scratch, ws, 2);

		await expect(main(["snapshot", snapshotFile])).resolves.toBe(0);
		expect(await snapshotWritten()).toBe(true);
	});

	it("exits 1 for a live card with NULL key_number", async () => {
		await addCard(columnId, null, ws.statusId);
		await addCard(columnId, 2, ws.statusId);

		await expect(main(["snapshot", snapshotFile])).resolves.toBe(1);
		expect(stderr()).toContain("NULL key_number");
		expect(stderr()).toMatch(/count[=:]? ?1\b/);
		expect(stderr()).not.toContain(CUSTOMER_TITLE);
		expect(await snapshotWritten()).toBe(false);
	});

	it("exits 1 for a live card with NULL status_id", async () => {
		await scratch.client.query(
			"ALTER TABLE cards ALTER COLUMN status_id DROP NOT NULL",
		);
		await addCard(columnId, 1, null);

		await expect(main(["snapshot", snapshotFile])).resolves.toBe(1);
		expect(stderr()).toContain("NULL status_id");
		expect(stderr()).toMatch(/count[=:]? ?1\b/);
		expect(stderr()).not.toContain(CUSTOMER_TITLE);
		expect(await snapshotWritten()).toBe(false);
	});

	it("exits 1 for a live card with NULL column_id", async () => {
		await addCard(null, 1, ws.statusId);
		await addCard(null, 2, ws.statusId);

		await expect(main(["snapshot", snapshotFile])).resolves.toBe(1);
		expect(stderr()).toContain("NULL column_id");
		expect(stderr()).toMatch(/count[=:]? ?2\b/);
		expect(stderr()).not.toContain(CUSTOMER_TITLE);
		expect(await snapshotWritten()).toBe(false);
	});

	it("exits 1 for a tracker row that already has migrated_to_id", async () => {
		const itemId = await seedItem(scratch, ws, 3);
		const [card] = await rows<{ id: number }>(
			scratch,
			`INSERT INTO cards (workspace_id, column_id, title, position, key_number, status_id)
			 VALUES ($1, $2, $3, 1024, 3, $4) RETURNING id`,
			[ws.id, columnId, CUSTOMER_TITLE, ws.statusId],
		);
		await scratch.client.query(
			"UPDATE tracker_items SET migrated_to_id = $2 WHERE id = $1",
			[itemId, card.id],
		);

		await expect(main(["snapshot", snapshotFile])).resolves.toBe(1);
		expect(stderr()).toContain("migrated_to_id");
		expect(stderr()).toMatch(/count[=:]? ?1\b/);
		expect(stderr()).not.toContain(CUSTOMER_TITLE);
		expect(await snapshotWritten()).toBe(false);
	});

	it("ignores soft-deleted cards when checking card preconditions", async () => {
		await scratch.client.query(
			`INSERT INTO cards (workspace_id, column_id, title, position, key_number, status_id, deleted_at)
			 VALUES ($1, NULL, 'gone', 1024, NULL, $2, now())`,
			[ws.id, ws.statusId],
		);

		await expect(main(["snapshot", snapshotFile])).resolves.toBe(0);
	});
});
