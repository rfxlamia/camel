import { expect, it, vi } from "vitest";
import {
	addPair,
	expectNoCardSideEffects,
	fixtures,
	LocalAttachmentStorage,
	multipartCreate,
	oversizedPng,
	PNG_1X1,
	query,
	setAttachmentStorageForTests,
	storageRoot,
} from "./card-create-attachments.test-support.js";

export function registerValidationScenarios(publishEventMock: unknown): void {
	it("rejects unequal pairs and more than three pairs before creating a card", async () => {
		const unequal = multipartCreate(fixtures!.columnId, "Unequal");
		unequal.attach("thumbnail", PNG_1X1, "thumbnail.png");
		const unequalResponse = await unequal;
		expect(unequalResponse.status).toBe(400);
		expect(
			await query("SELECT id FROM cards WHERE workspace_id = $1", [
				fixtures!.workspaceId,
			]),
		).toHaveLength(0);

		const overflow = multipartCreate(fixtures!.columnId, "Overflow");
		for (let index = 0; index < 4; index += 1) {
			addPair(overflow, PNG_1X1, PNG_1X1, index);
		}
		const overflowResponse = await overflow;
		expect(overflowResponse.status).toBe(413);
		expect(
			await query("SELECT id FROM cards WHERE workspace_id = $1", [
				fixtures!.workspaceId,
			]),
		).toHaveLength(0);
	});

	it("rejects malformed or oversized images before writing any pair", async () => {
		const writePair = vi.fn();
		const storage = new LocalAttachmentStorage(storageRoot!);
		setAttachmentStorageForTests({
			root: storage.root,
			writePair,
			removePair: storage.removePair.bind(storage),
			removePairs: storage.removePairs.bind(storage),
		});

		const invalidImages: Array<[string, Buffer]> = [
			["Invalid signature", Buffer.from("not an image")],
			["Oversized dimensions", oversizedPng()],
		];
		for (const [title, image] of invalidImages) {
			const response = await addPair(
				multipartCreate(fixtures!.columnId, title),
				image,
				PNG_1X1,
				0,
			);
			expect(response.status).toBe(400);
		}
		expect(writePair).not.toHaveBeenCalled();
		await expectNoCardSideEffects(publishEventMock);
	});
}
