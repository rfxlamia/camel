// Shared helpers for merged-schema HTTP tests. Import only AFTER the test file
// has mocked `../db/pool.js` (scratch pool), `../db/redis.js`, `../realtime.js`
// and `../auth.js`.
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { expect } from "vitest";
import type { ScratchSchema } from "../db/scratch-schema-test-support.js";
import { rows } from "../db/work-item-merge.test-support.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

// biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON response bodies
export type Json = Record<string, any>;

export function createMergedApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

export async function insertUser(
	s: ScratchSchema,
	username: string,
): Promise<number> {
	const [user] = await rows(
		s,
		"INSERT INTO users (username, display_name, password_hash) VALUES ($1, 'Owner', 'x') RETURNING id",
		[username],
	);
	return user.id;
}

/**
 * Creates a workspace through the real routes: workspace create (membership
 * plus vocabulary seed), then the column-template batch route.
 */
export async function createWorkspaceThroughRoutes(
	app: express.Express,
	name: string,
): Promise<{ id: number; columns: Json[] }> {
	const created = await request(app).post("/api/workspaces").send({ name });
	expect(created.status).toBe(201);
	const id = created.body.id as number;
	const template = await request(app)
		.post(`/api/workspaces/${id}/columns/batch`)
		.send({
			templateName: "Simple",
			columns: [
				{
					title: "To do",
					wipLimit: null,
					policy: "",
					isDone: false,
					color: null,
				},
				{ title: "Doing", wipLimit: 3, policy: "", isDone: false, color: null },
				{
					title: "Done",
					wipLimit: null,
					policy: "",
					isDone: true,
					color: null,
				},
			],
		});
	expect(template.status).toBe(201);
	const board = await request(app).get(`/api/workspaces/${id}/board`);
	expect(board.status).toBe(200);
	return { id, columns: board.body.columns as Json[] };
}
