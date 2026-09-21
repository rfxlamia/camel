import { EventEmitter } from "node:events";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { pool } from "../../db/pool.js";
import { setAttachmentStorageForTests } from "../../lib/attachment-storage.js";
import { createRealtimeHub, setRealtimeHubForTests } from "../../realtime.js";
import {
	app,
	attachmentRows,
	attachPair,
	cardVersion,
	cleanupUploadFixture,
	countFiles,
	createTestStorage,
	createUploadFixture,
	MarkerStorage,
	pngFixture,
	removeTestStorage,
	storage,
	testUser,
	uploadUrl,
	withUploadFixture,
} from "./card-attachments-upload.support.js";

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"existing card attachment uploads",
	() => {
		it("cleans provider writes after a route-bound insert failure", async () => {
			const fixtureStorage = await createTestStorage();
			const markerStorage = new MarkerStorage(fixtureStorage, "t6-db-failure");
			setAttachmentStorageForTests(markerStorage);
			const fixture = await createUploadFixture(0, markerStorage);
			try {
				await pool.query(
					"DROP TRIGGER IF EXISTS t6_attachment_failure ON attachments",
				);
				await pool.query(`
					CREATE OR REPLACE FUNCTION t6_attachment_failure_fn() RETURNS trigger
					LANGUAGE plpgsql AS $$ BEGIN
						IF NEW.thumbnail_path LIKE 't6-db-failure/%' THEN
							RAISE EXCEPTION 'T6 forced attachment insert failure';
						END IF;
						RETURN NEW;
					END $$;
				`);
				await pool.query(
					"CREATE TRIGGER t6_attachment_failure BEFORE INSERT ON attachments FOR EACH ROW EXECUTE FUNCTION t6_attachment_failure_fn()",
				);
				const hub = createRealtimeHub({ publisher: null, subscriber: null });
				const events = hub.connectLocalClient({
					workspaceId: fixture.workspaceId,
				});
				setRealtimeHubForTests(hub);
				const beforeVersion = await cardVersion(fixture.cardId);
				const response = await attachPair(
					request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
					pngFixture(),
					pngFixture(),
				);
				expect(response.status).toBe(500);
				expect(await attachmentRows(fixture.cardId)).toHaveLength(0);
				expect(await countFiles(fixture.storage.root)).toBe(0);
				expect(await cardVersion(fixture.cardId)).toBe(beforeVersion);
				expect(events.drain()).toEqual([]);
			} finally {
				await pool.query(
					"DROP TRIGGER IF EXISTS t6_attachment_failure ON attachments",
				);
				await pool.query("DROP FUNCTION IF EXISTS t6_attachment_failure_fn()");
				await cleanupUploadFixture(fixture);
				setAttachmentStorageForTests(storage);
				await removeTestStorage(fixtureStorage);
			}
		}, 15_000);

		it("delivers a committed attachment mutation through the real SSE hub", async () => {
			await withUploadFixture(1, async (fixture) => {
				const hub = createRealtimeHub({ publisher: null, subscriber: null });
				setRealtimeHubForTests(hub);
				const subscriberRequest = new EventEmitter() as EventEmitter & {
					params: { workspaceId: string };
					user: typeof testUser;
				};
				subscriberRequest.params = { workspaceId: String(fixture.workspaceId) };
				subscriberRequest.user = { ...testUser, id: 2 };
				const chunks: string[] = [];
				const subscriberResponse = {
					writeHead: vi.fn(),
					write: (chunk: string) => {
						chunks.push(chunk);
						return true;
					},
					end: vi.fn(),
				};
				try {
					hub.sseHandler(
						subscriberRequest as never,
						subscriberResponse as never,
					);
					const response = await attachPair(
						request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
						pngFixture(),
						pngFixture(),
					);
					expect(response.status).toBe(201);
					const payloads = chunks
						.filter((chunk) => chunk.startsWith("data: "))
						.map(
							(chunk) =>
								JSON.parse(chunk.slice(6).trim()) as Record<string, unknown>,
						);
					expect(payloads).toHaveLength(1);
					expect(payloads[0]).toMatchObject({
						type: "attachment.added",
						workspaceId: fixture.workspaceId,
						cardId: fixture.cardId,
					});
					expect(payloads[0]).not.toHaveProperty("thumbnail");
				} finally {
					subscriberRequest.emit("close");
				}
			});
		}, 15_000);
	},
);
