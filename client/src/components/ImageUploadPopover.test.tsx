// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import ImageUploadPopover from "./ImageUploadPopover";

describe("ImageUploadPopover", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("renders the upload instructions without opening the file manager", () => {
		const anchorRef = createRef<HTMLButtonElement>();
		const inputClick = vi
			.spyOn(HTMLInputElement.prototype, "click")
			.mockImplementation(() => {});

		render(
			<>
				<button ref={anchorRef}>Add images</button>
				<ImageUploadPopover
					open
					anchorRef={anchorRef}
					onClose={vi.fn()}
					onFilesSelected={vi.fn()}
				/>
			</>,
		);

		expect(screen.getByRole("dialog", { name: "Upload images" })).toBeTruthy();
		expect(screen.getByText("PNG or JPEG up to 10MB")).toBeTruthy();
		expect(screen.getByText("or paste your image now")).toBeTruthy();
		const fileInput = document.querySelector('input[type="file"]');
		expect(fileInput?.getAttribute("aria-hidden")).toBe("true");
		expect(fileInput?.getAttribute("tabindex")).toBe("-1");
		expect(inputClick).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Select images" }));
		expect(inputClick).toHaveBeenCalledTimes(1);
	});

	it("forwards every image from the clipboard and ignores non-images", () => {
		const anchorRef = createRef<HTMLButtonElement>();
		const onFilesSelected = vi.fn();
		const png = new Blob(["png"], { type: "image/png" });
		const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });

		render(
			<>
				<button ref={anchorRef}>Add images</button>
				<ImageUploadPopover
					open
					anchorRef={anchorRef}
					onClose={vi.fn()}
					onFilesSelected={onFilesSelected}
				/>
			</>,
		);

		const dialog = screen.getByRole("dialog", { name: "Upload images" });
		fireEvent.paste(dialog, {
			clipboardData: {
				items: [
					{ kind: "string", type: "text/plain", getAsFile: () => null },
					{ kind: "file", type: "image/png", getAsFile: () => png },
					{ kind: "file", type: "image/jpeg", getAsFile: () => jpeg },
				],
				files: [],
			},
		});

		expect(onFilesSelected).toHaveBeenCalledWith([png, jpeg]);
	});

	it("closes on Escape and when the user clicks outside", () => {
		const anchorRef = createRef<HTMLButtonElement>();
		const onClose = vi.fn();

		render(
			<div>
				<button ref={anchorRef}>Add images</button>
				<ImageUploadPopover
					open
					anchorRef={anchorRef}
					onClose={onClose}
					onFilesSelected={vi.fn()}
				/>
				<button>Outside</button>
			</div>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));

		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
