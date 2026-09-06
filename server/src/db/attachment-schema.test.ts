import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Attachments, Database } from "./types.js";

const typesTs = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
const attachmentsBlock = typesTs.match(
	/export interface Attachments[\s\S]*?\n}\n/,
)?.[0];

// Keep the contract tied to the committed generated module as well as its source shape.
type AttachmentRegistryContract = Database["attachments"];
const _attachmentTypeContract: AttachmentRegistryContract = {} as Attachments;

void _attachmentTypeContract;

describe("attachments Kysely types", () => {
	it("exposes the generated Attachments row contract", () => {
		expect(attachmentsBlock).toBeTruthy();
		expect(attachmentsBlock).toMatch(/card_id:\s+number;/);
		expect(attachmentsBlock).toMatch(/created_at:\s+Generated<Timestamp>;/);
		expect(attachmentsBlock).toMatch(/id:\s+Generated<number>;/);
		expect(attachmentsBlock).toMatch(/mime_type:\s+string;/);
		expect(attachmentsBlock).toMatch(/original_path:\s+string;/);
		expect(attachmentsBlock).toMatch(/original_size_bytes:\s+number;/);
		expect(attachmentsBlock).toMatch(/thumbnail_path:\s+string;/);
		expect(attachmentsBlock).toMatch(/thumbnail_size_bytes:\s+number;/);
	});

	it("registers attachments on Database", () => {
		expect(typesTs).toMatch(/attachments:\s+Attachments;/);
	});
});
