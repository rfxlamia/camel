// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ImagePreparationResult,
	PreparedImagePair,
} from "../../shared/imageAttachments";

const prepareImageAttachment = vi.fn();
vi.mock("../../shared/imageAttachments", () => ({
	MAX_ATTACHMENT_COUNT: 3,
	prepareImageAttachment: (...args: unknown[]) =>
		prepareImageAttachment(...args),
}));

import { useAddCardImageStaging } from "./useAddCardImageStaging";

function validResult(file: File): ImagePreparationResult {
	const prepared: PreparedImagePair = { thumbnail: file, original: file };
	return {
		kind: "valid",
		file,
		original: file,
		thumbnail: file,
		prepared,
	};
}

beforeEach(() => {
	prepareImageAttachment.mockReset();
	vi.spyOn(URL, "createObjectURL");
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("useAddCardImageStaging cleanup", () => {
	it("revokes every preview URL when the hook unmounts", async () => {
		const first = new File(["one"], "one.png", { type: "image/png" });
		const second = new File(["two"], "two.png", { type: "image/png" });
		prepareImageAttachment
			.mockResolvedValueOnce(validResult(first))
			.mockResolvedValueOnce(validResult(second));
		vi.mocked(URL.createObjectURL)
			.mockReturnValueOnce("blob:one")
			.mockReturnValueOnce("blob:two");

		const { result, unmount } = renderHook(() => useAddCardImageStaging());
		await act(async () => {
			await result.current.stageFiles([first, second]);
		});

		expect(result.current.stagedImages).toHaveLength(2);
		unmount();

		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:two");
	});

	it("invalidates a preparation that resolves after unmount", async () => {
		const file = new File(["pending"], "pending.png", { type: "image/png" });
		let resolvePreparation: (value: ImagePreparationResult) => void = () => {};
		prepareImageAttachment.mockImplementation(
			() =>
				new Promise<ImagePreparationResult>((resolve) => {
					resolvePreparation = resolve;
				}),
		);

		const { result, unmount } = renderHook(() => useAddCardImageStaging());
		act(() => {
			void result.current.stageFiles([file]);
		});
		await waitFor(() =>
			expect(prepareImageAttachment).toHaveBeenCalledTimes(1),
		);
		unmount();

		await act(async () => {
			resolvePreparation(validResult(file));
		});

		expect(URL.createObjectURL).not.toHaveBeenCalled();
	});
});
