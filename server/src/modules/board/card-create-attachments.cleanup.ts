import { expect, it } from "vitest";
import {
	addPair,
	expectNoCardSideEffects,
	FailingOnSecondPairStorage,
	fixtures,
	multipartCreate,
	PNG_1X1,
	pool,
	readdir,
	setAttachmentStorageForTests,
	storageRoot,
} from "./card-create-attachments.test-support.js";

export function registerCleanupScenarios(publishEventMock: unknown): void {
	it("removes earlier pairs when a later provider write fails", async () => {
		setAttachmentStorageForTests(new FailingOnSecondPairStorage(storageRoot!));
		const response = await addPair(
			addPair(
				multipartCreate(fixtures!.columnId, "Provider failure"),
				PNG_1X1,
				PNG_1X1,
				0,
			),
			PNG_1X1,
			PNG_1X1,
			1,
		);
		expect(response.status).toBe(500);
		await expectNoCardSideEffects(publishEventMock);
		expect(await readdir(storageRoot!)).toEqual([]);
	});

	it("rolls back the card and unlinks files when the route-bound attachment insert fails", async () => {
		try {
			await pool.query(
				"DROP TRIGGER IF EXISTS card_create_attachment_test_failure_trigger ON attachments",
			);
			await pool.query(`
				CREATE OR REPLACE FUNCTION card_create_attachment_test_failure()
				RETURNS trigger LANGUAGE plpgsql AS $$
				BEGIN
					RAISE EXCEPTION 'controlled card-create attachment failure';
				END;
				$$;
			`);
			await pool.query(`
				CREATE TRIGGER card_create_attachment_test_failure_trigger
				BEFORE INSERT ON attachments
				FOR EACH ROW EXECUTE FUNCTION card_create_attachment_test_failure();
			`);
			const response = await addPair(
				multipartCreate(fixtures!.columnId, "Database failure"),
				PNG_1X1,
				PNG_1X1,
				0,
			);
			expect(response.status).toBe(500);
			await expectNoCardSideEffects(publishEventMock);
			expect(await readdir(storageRoot!)).toEqual([]);
		} finally {
			await pool.query(
				"DROP TRIGGER IF EXISTS card_create_attachment_test_failure_trigger ON attachments",
			);
			await pool.query(
				"DROP FUNCTION IF EXISTS card_create_attachment_test_failure()",
			);
		}
	});
}
