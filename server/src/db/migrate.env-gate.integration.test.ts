// Requires PostgreSQL. Run with RUN_INTEGRATION=1 and the exact workspace-scoped command.
// Exercises the env path the cutover uses: WORK_ITEM_MERGE=on -> migrate() ->
// applySchema(client) -> SET LOCAL work_item_merge.enabled, against a scratch schema.
import "dotenv/config";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { SCHEMA, poolEnd } = vi.hoisted(() => ({
	SCHEMA: `migrate_env_gate_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`,
	poolEnd: { fn: undefined as undefined | (() => Promise<void>) },
}));

vi.mock("./pool.js", async () => {
	const { createScratchPool } = await import("./scratch-pool-test-support.js");
	const real = createScratchPool(SCHEMA);
	poolEnd.fn = () => real.end();
	// migrate() ends its pool; keep it open across tests and end it in afterAll.
	return {
		pool: { connect: () => real.connect(), end: async () => undefined },
	};
});

import { applySchema, migrate } from "./migrate.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "./scratch-schema-test-support.js";
import {
	rows,
	seedItem,
	seedWorkspace,
} from "./work-item-merge.test-support.js";

const runIntegration = process.env.RUN_INTEGRATION === "1";
const COPY_SKIPPED = "work-item-merge: copy skipped";
const WORKSPACE_NOTICE = "work-item-merge: workspace=";

describe.skipIf(!runIntegration)("migrate() WORK_ITEM_MERGE env gate", () => {
	let scratch: ScratchSchema;
	let log: ReturnType<typeof vi.spyOn>;
	let savedGate: string | undefined;

	beforeEach(async () => {
		savedGate = process.env.WORK_ITEM_MERGE;
		delete process.env.WORK_ITEM_MERGE;
		scratch = await createScratchSchema("migrate_env_gate", { schema: SCHEMA });
		await applySchema(scratch.client);
		const ws = await seedWorkspace(scratch, "env-gate-fixture");
		await seedItem(scratch, ws, 1);
		await seedItem(scratch, ws, 2);
		log = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		log.mockRestore();
		if (savedGate === undefined) delete process.env.WORK_ITEM_MERGE;
		else process.env.WORK_ITEM_MERGE = savedGate;
		await scratch?.drop();
	});

	afterAll(async () => {
		await poolEnd.fn?.();
	});

	const stdout = () => log.mock.calls.map((call) => String(call[0]));

	it("WORK_ITEM_MERGE=on copies tracker rows and satisfies the cutover validator", async () => {
		process.env.WORK_ITEM_MERGE = "on";

		await expect(migrate()).resolves.toBeUndefined();

		const lines = stdout();
		expect(lines.at(-1)).toBe("Schema applied.");
		expect(lines.some((l) => l.startsWith(WORKSPACE_NOTICE))).toBe(true);
		expect(lines.some((l) => l.includes(COPY_SKIPPED))).toBe(false);
		const [{ unmigrated }] = await rows<{ unmigrated: string }>(
			scratch,
			"SELECT count(*) AS unmigrated FROM tracker_items WHERE migrated_to_id IS NULL",
		);
		expect(Number(unmigrated)).toBe(0);
	});

	it.each([
		["unset", undefined],
		["not 'on'", "off"],
	])("gate off (%s) skips the copy and emits no workspace notice", async (_label, value) => {
		if (value !== undefined) process.env.WORK_ITEM_MERGE = value;

		await expect(migrate()).resolves.toBeUndefined();

		const lines = stdout();
		expect(lines.at(-1)).toBe("Schema applied.");
		expect(lines.some((l) => l.includes(COPY_SKIPPED))).toBe(true);
		expect(lines.some((l) => l.startsWith(WORKSPACE_NOTICE))).toBe(false);
		const [{ unmigrated }] = await rows<{ unmigrated: string }>(
			scratch,
			"SELECT count(*) AS unmigrated FROM tracker_items WHERE migrated_to_id IS NULL",
		);
		expect(Number(unmigrated)).toBe(2);
	});
});
