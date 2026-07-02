import { Kysely, PostgresDialect, type Transaction } from "kysely";
import { pool } from "./pool.js";
import type { DB } from "./types.js";

export const db = new Kysely<DB>({
	dialect: new PostgresDialect({ pool }),
});

/** Accepted by helpers that must run either standalone or inside a transaction. */
export type DBExecutor = Kysely<DB> | Transaction<DB>;
