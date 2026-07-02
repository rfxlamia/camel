import { Kysely, PostgresDialect } from "kysely";
import { pool } from "./pool.js";
import type { DB } from "./types.js";

export const db = new Kysely<DB>({
	dialect: new PostgresDialect({ pool }),
});
