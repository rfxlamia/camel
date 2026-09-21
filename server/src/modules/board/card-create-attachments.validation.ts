import { expect, it, vi } from "vitest";
import {
	addPair,
	expectNoCardSideEffects,
	fixtures,
	JPEG_1X1,
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

		const oversizedFile = Buffer.concat([
			PNG_1X1,
			Buffer.alloc(10 * 1024 * 1024 + 1 - PNG_1X1.length),
		]);
		const invalidImages: Array<[string, Buffer, string, number]> = [
			[
				"Invalid signature",
				Buffer.from("not an image"),
				"Only PNG and JPEG accepted",
				400,
			],
			[
				"Oversized dimensions",
				oversizedPng(),
				"Image dimensions must be 4096px or smaller",
				400,
			],
			["Oversized file", oversizedFile, "File size must be under 10MB", 413],
		];
		for (const [title, image, message, status] of invalidImages) {
			for (const invalidField of ["thumbnail", "original"] as const) {
				const response = await addPair(
					multipartCreate(fixtures!.columnId, `${title} ${invalidField}`),
					invalidField === "thumbnail" ? image : PNG_1X1,
					invalidField === "original" ? image : PNG_1X1,
					0,
				);
				expect(response.status).toBe(status);
				expect(response.body.error).toBe(message);
			}
		}

		const mixed = multipartCreate(fixtures!.columnId, "Mixed MIME");
		mixed.attach("thumbnail", PNG_1X1, {
			filename: "thumbnail.png",
			contentType: "image/png",
		});
		mixed.attach("original", JPEG_1X1, {
			filename: "original.jpg",
			contentType: "image/jpeg",
		});
		const mixedResponse = await mixed;
		expect(mixedResponse.status).toBe(400);
		expect(mixedResponse.body.error).toBe("Only PNG and JPEG accepted");
		expect(writePair).not.toHaveBeenCalled();
		await expectNoCardSideEffects(publishEventMock);
	});
}
