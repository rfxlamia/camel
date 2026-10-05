import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateAttachmentPairs = vi.fn();
vi.mock("../../lib/attachment-validation.js", () => ({
	validateAttachmentPairs: (...args: unknown[]) =>
		mockValidateAttachmentPairs(...args),
}));
vi.mock("../../lib/workspace-mutation-lock.js", () => ({
	lockTaskCreateReferences: vi.fn(),
}));

import { prepareCreateRequest } from "./card-create-validation.js";

function jsonReq(body: Record<string, unknown>): Request {
	return {
		is: () => false,
		body,
		user: { id: 1 },
	} as unknown as Request;
}

function multipartReq(metadata: Record<string, unknown>): Request {
	const file = { mimetype: "image/png", buffer: Buffer.from("x") };
	return {
		is: (type: string) => type === "multipart/form-data",
		body: { metadata: JSON.stringify(metadata) },
		files: { thumbnail: [file], original: [file] },
		user: { id: 1 },
	} as unknown as Request;
}

describe("prepareCreateRequest validation order", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateAttachmentPairs.mockResolvedValue(null);
	});

	it("rejects an invalid title without inspecting attachments", async () => {
		const result = await prepareCreateRequest(
			multipartReq({ columnId: 1, title: "   " }),
			1,
		);
		expect(result.kind).toBe("bad_request");
		expect(mockValidateAttachmentPairs).not.toHaveBeenCalled();
	});

	it("rejects a non-integer columnId without inspecting attachments", async () => {
		const result = await prepareCreateRequest(
			multipartReq({ columnId: "x", title: "ok" }),
			1,
		);
		expect(result).toEqual({
			kind: "bad_request",
			error: "columnId must be an integer",
		});
		expect(mockValidateAttachmentPairs).not.toHaveBeenCalled();
	});

	it("still reports an attachment error once the body is valid", async () => {
		mockValidateAttachmentPairs.mockResolvedValue("unsupported image type");
		const result = await prepareCreateRequest(
			multipartReq({ columnId: 1, title: "ok" }),
			1,
		);
		expect(result).toEqual({
			kind: "bad_request",
			error: "unsupported image type",
		});
		expect(mockValidateAttachmentPairs).toHaveBeenCalledTimes(1);
	});

	it("is ready for a valid JSON create", async () => {
		const result = await prepareCreateRequest(
			jsonReq({ columnId: 1, title: "Fix login" }),
			1,
		);
		expect(result.kind).toBe("ready");
	});
});
