// Requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/apply-schema.integration.test.ts
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySchema } from "./migrate.js";
import { pool } from "./pool.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "./scratch-schema-test-support.js";

const runIntegration = Boolean(process.env.RUN_INTEGRATION);

const tableExists = async (
	scratch: ScratchSchema,
	table: string,
): Promise<boolean> => {
	const { rows } = await scratch.client.query(
		"SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2",
		[scratch.schema, table],
	);
	return rows.length === 1;
};

describe.skipIf(!runIntegration)("applySchema", () => {
	afterAll(async () => {
		await pool.end();
	});

	describe("on an empty scratch schema", () => {
		let scratch: ScratchSchema;
		beforeAll(async () => {
			scratch = await createScratchSchema("apply_schema_ok");
		});
		afterAll(async () => {
			await scratch.drop();
		});

		it("creates objects from every SQL file and leaves the pool usable", async () => {
			await applySchema(scratch.client);
			expect(await tableExists(scratch, "cards")).toBe(true);
			expect(await tableExists(scratch, "chat_threads")).toBe(true);
			const agentTable = await scratch.client.query(
				"SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'agent%'",
				[scratch.schema],
			);
			expect(agentTable.rows.length).toBeGreaterThan(0);
			const { rows } = await pool.query("SELECT 1 AS ok");
			expect(rows[0].ok).toBe(1);
		});
	});

	describe("when schema.sql fails", () => {
		let scratch: ScratchSchema;
		beforeAll(async () => {
			scratch = await createScratchSchema("apply_schema_fail");
			await scratch.client.query("CREATE TABLE cards (id INTEGER)");
		});
		afterAll(async () => {
			await scratch.drop();
		});

		it("rejects and rolls back objects from later files", async () => {
			await expect(applySchema(scratch.client)).rejects.toThrow();
			const agentTable = await scratch.client.query(
				"SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'agent%'",
				[scratch.schema],
			);
			expect(agentTable.rows).toHaveLength(0);
			expect(await tableExists(scratch, "chat_threads")).toBe(false);
		});
	});
});
