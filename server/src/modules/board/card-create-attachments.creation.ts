import { expect, it } from "vitest";
import {
	addPair,
	fixtures,
	multipartCreate,
	PNG_1X1,
	query,
} from "./card-create-attachments.test-support.js";

export function registerCreationScenarios(publishEventMock: unknown): void {
	it("creates one or more positional pairs in the card transaction and publishes after commit", async () => {
		const response = await addPair(
			addPair(
				multipartCreate(fixtures!.columnId, "Staged images"),
				PNG_1X1,
				PNG_1X1,
				0,
			),
			PNG_1X1,
			Buffer.concat([PNG_1X1, Buffer.from("pair-two")]),
			1,
		);

		expect(response.status).toBe(201);
		expect(response.body.title).toBe("Staged images");
		expect(response.body.attachments).toHaveLength(2);
		const rows = await query<{
			id: number;
			mime_type: string;
			thumbnail_size_bytes: number;
			original_size_bytes: number;
		}>(
			"SELECT id, mime_type, thumbnail_size_bytes, original_size_bytes FROM attachments WHERE card_id = $1 ORDER BY id",
			[response.body.id],
		);
		expect(rows).toEqual([
			expect.objectContaining({
				mime_type: "image/png",
				thumbnail_size_bytes: PNG_1X1.length,
				original_size_bytes: PNG_1X1.length,
			}),
			expect.objectContaining({
				mime_type: "image/png",
				thumbnail_size_bytes: PNG_1X1.length,
				original_size_bytes: PNG_1X1.length + Buffer.from("pair-two").length,
			}),
		]);
		const activities = await query<{
			event_type: string;
			to_column_id: number | null;
			payload: Record<string, unknown>;
		}>(
			"SELECT event_type, to_column_id, payload FROM card_events WHERE card_id = $1 ORDER BY id",
			[response.body.id],
		);
		expect(activities).toHaveLength(3);
		expect(activities[0]).toMatchObject({
			event_type: "create",
			to_column_id: fixtures!.columnId,
		});
		for (const activity of activities.slice(1)) {
			expect(activity).toMatchObject({
				event_type: "attachment_added",
				to_column_id: fixtures!.columnId,
			});
			expect(Object.keys(activity.payload).sort()).toEqual([
				"attachmentId",
				"createdAt",
				"mimeType",
			]);
		}
		expect(publishEventMock).toHaveBeenCalledTimes(3);
		expect(
			(publishEventMock as { mock: { calls: unknown[][] } }).mock.calls.map(
				([, event]) => (event as { type: string }).type,
			),
		).toEqual(["card.created", "attachment.added", "attachment.added"]);
	});
}
