// System integration: attachment mutation → SSE subscriber → staged create contract.
// Requires PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/attachments-system.integration.test.ts
import "dotenv/config";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
	app,
	attachPair,
	attachmentRows,
	connectViewerSse,
	parseSseDataEvents,
	pngFixture,
	setAuthenticatedViewer,
	submitStagedClientCreate,
	uploadUrl,
	withCreateFixture,
	withSystemFixture,
} from "./attachments-system.support.js";

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"attachment system boundaries",
	() => {
		it("commits an upload and delivers attachment.added to a second viewer SSE stream", async () => {
			await withSystemFixture(1, async (fixture) => {
				const viewerB = connectViewerSse(fixture.hub, {
					workspaceId: fixture.workspaceId,
					user: fixture.viewerB,
				});

				setAuthenticatedViewer(fixture.viewerA);
				const image = pngFixture();
				const response = await attachPair(
					request(app).post(uploadUrl(fixture.workspaceId, fixture.cardId)),
					image,
					image,
				);

				expect(response.status).toBe(201);
				expect(response.body.total).toBe(2);
				expect(response.body.acceptedCount).toBe(1);
				expect(response.body.attachments).toHaveLength(1);

				const rows = await attachmentRows(fixture.cardId);
				expect(rows).toHaveLength(2);
				const added = rows[1]!;
				expect(
					await readFile(path.join(fixture.storage.root, added.thumbnail_path)),
				).toEqual(image);
				expect(
					await readFile(path.join(fixture.storage.root, added.original_path)),
				).toEqual(image);

				const events = parseSseDataEvents(viewerB.chunks);
				expect(events).toHaveLength(1);
				expect(events[0]).toMatchObject({
					type: "attachment.added",
					workspaceId: fixture.workspaceId,
					cardId: fixture.cardId,
					actor: {
						id: fixture.viewerA.id,
						username: fixture.viewerA.username,
					},
					payload: {
						attachmentId: added.id,
						mimeType: "image/png",
					},
				});

				viewerB.close();
			});
		}, 15_000);

		it("creates a card atomically when the client FormData serializer hits card-create", async () => {
			await withCreateFixture(async (fixture) => {
				const image = pngFixture();
				const created = await submitStagedClientCreate(fixture, {
					title: "Staged board card",
					thumbnail: image,
					original: image,
				});

				expect(created.title).toBe("Staged board card");
				expect(created.attachments).toHaveLength(1);
				expect(created.attachments[0]).toMatchObject({
					mimeType: "image/png",
				});

				const cards = await fixture.countCards();
				expect(cards).toBe(1);
				const attachments = await fixture.listAttachments(created.id);
				expect(attachments).toHaveLength(1);
				expect(attachments[0]).toMatchObject({
					mime_type: "image/png",
				});
			});
		}, 15_000);
	},
);
