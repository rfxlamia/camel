import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./pool.js";

export type ScratchClient = PoolClient;

export type ScratchSchema = {
	client: ScratchClient;
	schema: string;
	drop: () => Promise<void>;
};

/** Unique, lower-case schema name safe to embed in a connection `options` string. */
export function scratchSchemaName(prefix: string): string {
	return `${prefix}_${process.pid}_${randomUUID().replaceAll("-", "")}`;
}

/**
 * Creates a uniquely named schema and a dedicated client whose search_path
 * points only at it (or at `opts.schema` when an app pool already targets it), so DDL never touches the shared `public` schema.
 */
export async function createScratchSchema(
	prefix: string,
	opts: { schema?: string } = {},
): Promise<ScratchSchema> {
	const schema = opts.schema ?? scratchSchemaName(prefix);
	const client = await pool.connect();
	try {
		await client.query(`CREATE SCHEMA "${schema}"`);
		await client.query(`SET search_path TO "${schema}"`);
	} catch (err) {
		client.release();
		throw err;
	}
	return {
		client,
		schema,
		drop: async () => {
			try {
				await client.query("ROLLBACK");
			} catch {
				// no open transaction to roll back
			}
			try {
				await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			} finally {
				client.release();
			}
		},
	};
}
