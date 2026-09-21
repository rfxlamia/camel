import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	stat: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));
vi.mock("../../config.js", () => ({
	config: { ATTACHMENTS_DIR: "/private-attachments" },
}));
vi.mock("../../db/kysely.js", () => ({ db: {} }));
vi.mock("../../middleware/workspace.js", () => ({
	requireWorkspaceMember: vi.fn(),
}));

import { deliverAttachment } from "./card-attachment-delivery.js";

function requestWithAttachment() {
	return {
		headers: {},
		attachmentDelivery: {
			id: 7,
			card_id: 42,
			mime_type: "image/png",
			thumbnail_path: "pair/thumbnail",
			original_path: "pair/original",
		},
	};
}

describe("deliverAttachment", () => {
	it("forwards sendFile errors even after response headers are sent", async () => {
		const error = new Error("stream failed");
		mocks.stat.mockResolvedValue({
			isFile: () => true,
			size: 12,
			mtimeMs: 34,
		});
		const sendFile = vi.fn(
			(
				_path: string,
				_options: { root: string },
				callback: (error?: Error) => void,
			) => callback(error),
		);
		const response = {
			headersSent: true,
			setHeader: vi.fn(),
			removeHeader: vi.fn(),
			status: vi.fn(),
			json: vi.fn(),
			end: vi.fn(),
			sendFile,
		};
		const next = vi.fn();

		await deliverAttachment(
			requestWithAttachment() as never,
			response as never,
			next,
			"thumbnail",
			false,
		);

		expect(sendFile).toHaveBeenCalledTimes(1);
		expect(next).toHaveBeenCalledWith(error);
	});
});
