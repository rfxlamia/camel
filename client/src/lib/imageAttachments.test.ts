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
	pixelData = new Uint8ClampedArray([0, 0, 0, 255]),
	getImageData: CanvasRenderingContext2D["getImageData"] = vi.fn(() => ({
		data: pixelData,
	})) as unknown as CanvasRenderingContext2D["getImageData"],
	imageEvent: "load" | "error" = "load",
) {
	const image: FakeImage = {
		onload: null,
		onerror: null,
		naturalWidth: width,
		naturalHeight: height,
		src: "",
	};
	const context = {
		drawImage: vi.fn(),
		getImageData,
	} as unknown as CanvasRenderingContext2D;
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
	queueMicrotask(() => {
		if (imageEvent === "load") image.onload?.();
		else image.onerror?.();
	});

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

	it("revokes the object URL when image decoding fails", async () => {
		installImageAndCanvas(640, 480, vi.fn(), undefined, undefined, "error");
		const file = new File(["png"], "broken.png", { type: "image/png" });

		const result = await prepareImageAttachment(file);

		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.error).toBe(IMAGE_VALIDATION_MESSAGES.unreadableDimensions);
		}
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
	});

	it("revokes the object URL when decoded dimensions are missing", async () => {
		installImageAndCanvas(0, 0, vi.fn());
		const file = new File(["png"], "empty.png", { type: "image/png" });

		const result = await prepareImageAttachment(file);

		expect(result.kind).toBe("invalid");
		if (result.kind === "invalid") {
			expect(result.error).toBe(IMAGE_VALIDATION_MESSAGES.unreadableDimensions);
		}
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
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
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
	});

	it("falls back to original bytes when Canvas output is fully transparent", async () => {
		const toBlob = vi.fn<HTMLCanvasElement["toBlob"]>((callback) => {
			callback(new Blob(["transparent-thumbnail"], { type: "image/png" }));
		});
		installImageAndCanvas(
			640,
			480,
			toBlob,
			new Uint8ClampedArray([0, 0, 0, 0]),
		);
		const file = new File(["original"], "photo.png", { type: "image/png" });

		const result = await prepareImageAttachment(file);

		expect(result.kind).toBe("valid");
		if (result.kind === "valid") {
			expect(result.thumbnail).toBe(result.original);
			expect(await result.thumbnail.text()).toBe("original");
		}
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
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
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
	});

	it("falls back to original bytes when Canvas pixel inspection fails", async () => {
		const toBlob = vi.fn<HTMLCanvasElement["toBlob"]>((callback) => {
			callback(new Blob(["thumbnail"], { type: "image/png" }));
		});
		const getImageData = vi.fn<CanvasRenderingContext2D["getImageData"]>(() => {
			throw new Error("pixel inspection failed");
		});
		installImageAndCanvas(640, 480, toBlob, undefined, getImageData);
		const file = new File(["original"], "photo.png", { type: "image/png" });

		const result = await prepareImageAttachment(file);

		expect(result.kind).toBe("valid");
		if (result.kind === "valid") {
			expect(result.thumbnail).toBe(result.original);
		}
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
	});
});
