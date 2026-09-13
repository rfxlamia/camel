import cookieParser from "cookie-parser";
import express from "express";
import { expect } from "vitest";
import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

export const ALICE_ID = 47001;
export const BOB_ID = 47002;
export const ATLAS_ID = 47011;
export const ORBIT_ID = 47012;
export const NEBULA_ID = 47013;
export const WORKSPACE_IDS = [ATLAS_ID, ORBIT_ID, NEBULA_ID] as const;

export type StatusIds = {
	backlog: number;
	inProgress: number;
	done: number;
	canceled: number;
};

export type WorkspaceFixture = {
	id: number;
	name: string;
	todoColumnId: number;
	doneColumnId: number;
	statuses: StatusIds;
};

export type ItemFixture = {
	id: number;
	keyNumber: number;
	key: string;
	version: number;
};

export type Fixtures = {
	atlas: WorkspaceFixture;
	orbit: WorkspaceFixture;
	nebula: WorkspaceFixture;
	atlasShadow: ItemFixture;
	atlasBoard: ItemFixture;
	atlasTracker: ItemFixture;
	orbitBoard: ItemFixture;
	orbitTracker: ItemFixture;
	nebulaTracker: ItemFixture;
};

export type BoardState = {
	column_id: number;
	status_id: number;
	version: number;
};

export type TrackerState = {
	status_id: number;
	version: number;
};

export const testState: { fixtures: Fixtures | null } = { fixtures: null };

export function getFixtures(): Fixtures {
	if (!testState.fixtures)
		throw new Error("My Work fixtures are not initialized");
	return testState.fixtures;
}

function createApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

export const app = createApp();

export async function query<T extends object>(
	text: string,
	values: unknown[] = [],
): Promise<T[]> {
	return (await pool.query<T>(text, values)).rows;
}

export async function cleanupWorkspace(workspaceId: number): Promise<void> {
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query(
		"DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query(
		"DELETE FROM card_assignees WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [workspaceId]);
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query(
		"DELETE FROM tracker_item_labels WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query(
		"DELETE FROM tracker_item_assignees WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM workspace_settings WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
}

export async function cleanupAll(): Promise<void> {
	for (const workspaceId of WORKSPACE_IDS) {
		await cleanupWorkspace(workspaceId);
	}
	await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [
		ALICE_ID,
		BOB_ID,
	]);
}

export async function boardState(cardId: number): Promise<BoardState> {
	return (
		await query<BoardState>(
			"SELECT column_id, status_id, version FROM cards WHERE id = $1",
			[cardId],
		)
	)[0]!;
}

export async function trackerState(itemId: number): Promise<TrackerState> {
	return (
		await query<TrackerState>(
			"SELECT status_id, version FROM tracker_items WHERE id = $1",
			[itemId],
		)
	)[0]!;
}

export async function expectNoCardEvents(cardId: number): Promise<void> {
	expect(
		await query("SELECT id FROM card_events WHERE card_id = $1", [cardId]),
	).toHaveLength(0);
}

export async function expectNoTrackerEvents(itemId: number): Promise<void> {
	expect(
		await query("SELECT id FROM tracker_events WHERE tracker_item_id = $1", [
			itemId,
		]),
	).toHaveLength(0);
}

export async function expectNoCardEventsInWorkspace(
	workspaceId: number,
): Promise<void> {
	expect(
		await query("SELECT id FROM card_events WHERE workspace_id = $1", [
			workspaceId,
		]),
	).toHaveLength(0);
}

export async function expectNoTrackerEventsInWorkspace(
	workspaceId: number,
): Promise<void> {
	expect(
		await query("SELECT id FROM tracker_events WHERE workspace_id = $1", [
			workspaceId,
		]),
	).toHaveLength(0);
}

export { pool };
