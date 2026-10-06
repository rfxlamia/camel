import { randomUUID } from "node:crypto";
import { pool } from "./pool.js";

export type ScratchClient = Awaited<ReturnType<typeof pool.connect>>;

export type ScratchSchema = {
	client: ScratchClient;
	schema: string;
	drop: () => Promise<void>;
};

/**
 * Creates a uniquely named schema and a dedicated client whose search_path
 * points only at it, so DDL never touches the shared `public` schema.
 */
export async function createScratchSchema(
	prefix: string,
): Promise<ScratchSchema> {
	const schema = `${prefix}_${process.pid}_${randomUUID().replaceAll("-", "")}`;
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
