// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, CardAttachment } from "../types";
import {
	MAX_ATTACHMENT_COUNT,
	type PreparedImagePair,
} from "../lib/imageAttachments";

const mockPrepareImageAttachment = vi.fn();
vi.mock("../lib/imageAttachments", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../lib/imageAttachments")>();
	return {
		...actual,
		prepareImageAttachment: (...args: unknown[]) =>
			mockPrepareImageAttachment(...args),
	};
});

import CardAttachments from "./CardAttachments";

function makeAttachment(id: number): CardAttachment {
	return {
		id,
		thumbnailUrl: `/api/workspaces/7/cards/42/attachments/${id}/thumbnail`,
		originalUrl: `/api/workspaces/7/cards/42/attachments/${id}/original`,
		downloadUrl: `/api/workspaces/7/cards/42/attachments/${id}/original/download`,
		mimeType: "image/png",
		createdAt: "2026-09-05T10:00:00.000Z",
	};
}

function makeCard(attachments: CardAttachment[] = []): Card {
	return {
		id: 42,
		columnId: 1,
		title: "Card with images",
		description: "",
		position: 1024,
		version: 1,
		createdAt: "2026-06-01T00:00:00Z",
		updatedAt: "2026-06-01T00:00:00Z",
		startedAt: null,
		doneAt: null,
		dueDate: null,
		assignees: [],
		attachments,
	};
}

function preparedPair(label: string): PreparedImagePair {
	const original = new File([label], `${label}.png`, { type: "image/png" });
	const thumbnail = new File([`${label}-thumb`], `${label}-thumb.png`, {
		type: "image/png",
	});
	return { original, thumbnail };
}

describe("CardAttachments — picker/paste/counter", () => {
	const onUpload = vi.fn();

	beforeEach(() => {
		onUpload.mockReset();
		mockPrepareImageAttachment.mockReset();
		mockPrepareImageAttachment.mockImplementation(async (input: Blob) => {
			const name =
				input instanceof File ? input.name.replace(/\.png$/, "") : "pasted";
			const prepared = preparedPair(name);
			return {
				kind: "valid" as const,
				file: prepared.original,
				original: prepared.original,
				thumbnail: prepared.thumbnail,
				prepared,
			};
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("uploads prepared pairs from multi-select, shows partial batch copy, and reflects server total", async () => {
		const existing = makeAttachment(1);
		onUpload.mockResolvedValue({
			attachments: [makeAttachment(2), makeAttachment(3)],
			acceptedCount: 2,
			addedCount: 2,
			rejectedCount: 2,
			requestedCount: 4,
			total: 3,
			totalCount: 3,
			limit: MAX_ATTACHMENT_COUNT,
			message: "2 of 4 images added — card limit is 3 images",
		});

		const { rerender } = render(
			<CardAttachments
				card={makeCard([existing])}
				workspaceId={7}
				onUpload={onUpload}
			/>,
		);

		expect(screen.getByText("1/3")).toBeTruthy();

		const picker = screen.getByLabelText(/add images/i) as HTMLInputElement;
		const files = ["a", "b", "c", "d"].map(
			(label) => new File([label], `${label}.png`, { type: "image/png" }),
		);
		fireEvent.change(picker, { target: { files } });

		await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
		const uploadedPairs = onUpload.mock.calls[0]![0] as PreparedImagePair[];
		expect(uploadedPairs).toHaveLength(4);
		expect(uploadedPairs[0]?.original.name).toBe("a.png");

		await waitFor(() => {
			expect(
				screen.getByText("2 of 4 images added — card limit is 3 images"),
			).toBeTruthy();
		});

		rerender(
			<CardAttachments
				card={makeCard([existing, makeAttachment(2), makeAttachment(3)])}
				workspaceId={7}
				onUpload={onUpload}
			/>,
		);
		expect(screen.getByText("3/3")).toBeTruthy();
	});

	it("uploads a clipboard image when the attachment panel is focused", async () => {
		const existing = makeAttachment(1);
		onUpload.mockResolvedValue({
			attachments: [makeAttachment(2)],
			acceptedCount: 1,
			addedCount: 1,
			rejectedCount: 0,
			requestedCount: 1,
			total: 2,
			totalCount: 2,
			limit: MAX_ATTACHMENT_COUNT,
		});

		const { rerender } = render(
			<CardAttachments
				card={makeCard([existing])}
				workspaceId={7}
				onUpload={onUpload}
			/>,
		);

		const panel = screen.getByRole("region", { name: "Images" });
		panel.focus();

		const clipboardBlob = new Blob(["jpeg"], { type: "image/jpeg" });
		fireEvent.paste(panel, {
			clipboardData: {
				items: [{ kind: "file", type: "image/jpeg", getAsFile: () => clipboardBlob }],
				files: [],
			},
		});

		await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
		expect(mockPrepareImageAttachment).toHaveBeenCalledWith(clipboardBlob);

		rerender(
			<CardAttachments
				card={makeCard([existing, makeAttachment(2)])}
				workspaceId={7}
				onUpload={onUpload}
			/>,
		);
		expect(screen.getByText("2/3")).toBeTruthy();
	});
});
