// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	IMAGE_VALIDATION_MESSAGES,
	MAX_ATTACHMENT_BYTES,
	MAX_IMAGE_DIMENSION,
	prepareImageAttachment,
} from "./imageAttachments";

interface FakeImage {
	onload: (() => void) | null;
	onerror: (() => void) | null;
	naturalWidth: number;
	naturalHeight: number;
	src: string;
}

function installImageAndCanvas(
	width: number,
	height: number,
	toBlob: HTMLCanvasElement["toBlob"],
) {
	const image: FakeImage = {
		onload: null,
		onerror: null,
		naturalWidth: width,
		naturalHeight: height,
		src: "",
	};
	const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
	const canvas = {
		width: 0,
		height: 0,
		getContext: vi.fn(() => context),
		toBlob,
	} as unknown as HTMLCanvasElement;
	const createElement = vi.spyOn(document, "createElement");
	createElement.mockImplementation((tagName: string) => {
		if (tagName === "img") {
			return image as unknown as HTMLElement;
		}
		if (tagName === "canvas") {
			return canvas as unknown as HTMLElement;
		}
		return document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
	});
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
	queueMicrotask(() => image.onload?.());

	return { canvas, context, image };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("image attachment preparation", () => {
	it("returns tagged invalid results with the original and product errors", async () => {
		const unsupported = new File(["data"], "document.gif", {
			type: "image/gif",
		});
		const oversized = new File(
			[new Uint8Array(MAX_ATTACHMENT_BYTES + 1)],
			"large.png",
			{ type: "image/png" },
		);

		const unsupportedResult = await prepareImageAttachment(unsupported);
		const oversizedResult = await prepareImageAttachment(oversized);

		expect(unsupportedResult.kind).toBe("invalid");
		expect(oversizedResult.kind).toBe("invalid");
		if (unsupportedResult.kind === "invalid") {
			expect(unsupportedResult.file).toBe(unsupported);
			expect(unsupportedResult.error).toBe(
				IMAGE_VALIDATION_MESSAGES.unsupported,
			);
		}
		if (oversizedResult.kind === "invalid") {
			expect(oversizedResult.file).toBe(oversized);
			expect(oversizedResult.error).toBe(IMAGE_VALIDATION_MESSAGES.tooLarge);
		}
	});

	it("rejects decoded dimensions over the shared ceiling", async () => {
		installImageAndCanvas(MAX_IMAGE_DIMENSION + 1, 1024, vi.fn());
		const file = new File(["png"], "wide.png", { type: "image/png" });

		const result = await prepareImageAttachment(file);

		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.file).toBe(file);
			expect(result.error).toBe(IMAGE_VALIDATION_MESSAGES.tooLargeDimensions);
		}
	});

	it("derives a safe extension for clipboard blobs", async () => {
		installImageAndCanvas(
			640,
			480,
			vi.fn<HTMLCanvasElement["toBlob"]>((callback) => callback(null)),
		);
		const clipboardBlob = new Blob(["jpeg"], { type: "image/jpeg" });

		const result = await prepareImageAttachment(clipboardBlob);

		expect(result.kind).toBe("valid");
		if (result.kind === "valid") {
			expect(result.original.name).toMatch(/\.jpg$/);
			expect(result.original.type).toBe("image/jpeg");
		}
	});

	it("returns original and Canvas thumbnail bytes on success", async () => {
		const toBlob = vi.fn<HTMLCanvasElement["toBlob"]>((callback) => {
			callback(new Blob(["thumbnail"], { type: "image/png" }));
		});
		const { canvas, context } = installImageAndCanvas(2048, 1024, toBlob);
		const file = new File(["original"], "photo.png", { type: "image/png" });

		const result = await prepareImageAttachment(file);

		expect(result.kind).toBe("valid");
		if (result.kind === "valid") {
			expect(await result.original.text()).toBe("original");
			expect(await result.thumbnail.text()).toBe("thumbnail");
		}
		expect(canvas.width).toBe(1024);
		expect(canvas.height).toBe(512);
		expect(context.drawImage).toHaveBeenCalled();
	});

	it("falls back to original bytes when Canvas encoding fails", async () => {
		const toBlob = vi.fn<HTMLCanvasElement["toBlob"]>((callback) => {
			callback(null);
		});
		installImageAndCanvas(640, 480, toBlob);
		const file = new File(["original"], "photo.jpg", { type: "image/jpeg" });

		const result = await prepareImageAttachment(file);

		expect(result.kind).toBe("valid");
		if (result.kind === "valid") {
			expect(result.thumbnail).toBe(result.original);
			expect(await result.thumbnail.text()).toBe("original");
		}
	});
});
