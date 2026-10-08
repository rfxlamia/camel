import pg from "pg";

/**
 * A pool whose every connection searches only `schema`. Tests mock
 * `db/pool.js` with this so the real route modules run against a scratch
 * schema. The schema itself is created later by `createScratchSchema`.
 */
export function createScratchPool(schema: string): pg.Pool {
	return new pg.Pool({
		connectionString: process.env.DATABASE_URL,
		options: `-c search_path=${schema}`,
	});
}
