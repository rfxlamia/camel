import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Card, CardAttachment } from "../types";
import { CardBody } from "./CardView";

function makeAttachment(id: number, label: "A" | "B" | "C"): CardAttachment {
	return {
		id,
		thumbnailUrl: `/api/workspaces/7/cards/41/attachments/${id}/thumbnail-${label}`,
		originalUrl: `/api/workspaces/7/cards/41/attachments/${id}/original-${label}`,
		downloadUrl: `/api/workspaces/7/cards/41/attachments/${id}/original/download-${label}`,
		mimeType: "image/png",
		createdAt: `2026-09-05T10:0${id}:00.000Z`,
	};
}

const card = (overrides: Partial<Card> = {}): Card => ({
	id: 41,
	key: "CA-41",
	columnId: 1,
	title: "Keep the title visible",
	description: "",
	position: 1,
	version: 1,
	createdAt: "2026-08-01T00:00:00.000Z",
	updatedAt: "2026-08-01T00:00:00.000Z",
	startedAt: null,
	doneAt: null,
	dueDate: null,
	assignees: [],
	...overrides,
});

describe("CardBody", () => {
	afterEach(() => {
		cleanup();
	});

	it("shows the server key on the card face while keeping the title", () => {
		render(<CardBody card={card()} />);

		expect(screen.getByText("CA-41")).toBeTruthy();
		expect(screen.getByText("Keep the title visible")).toBeTruthy();
	});

	it("keeps longer server keys readable without falling back to the numeric id", () => {
		const key = "CAMEL-TRACKER-123456789";
		render(<CardBody card={card({ key })} />);

		expect(screen.getByText(key)).toBeTruthy();
		expect(screen.queryByText("41", { exact: true })).toBeNull();
	});

	it("renders no numeric fallback for old cards without a key", () => {
		render(<CardBody card={card({ key: undefined })} />);

		expect(screen.getByText("Keep the title visible")).toBeTruthy();
		expect(screen.queryByText("41", { exact: true })).toBeNull();
	});

	it("shows the server-ordered cover thumbnail and +N badge for multiple attachments", () => {
		const attachments = [
			makeAttachment(1, "A"),
			makeAttachment(2, "B"),
			makeAttachment(3, "C"),
		];
		render(<CardBody card={card({ attachments })} />);

		const cover = screen.getByRole("img", {
			name: "Attachment preview for Keep the title visible",
		});
		expect(cover.getAttribute("src")).toBe(attachments[0].thumbnailUrl);
		expect(screen.getByText("+2")).toBeTruthy();
		expect(screen.getByLabelText("2 more attachments")).toBeTruthy();
		expect(screen.getByText("Keep the title visible")).toBeTruthy();
	});

	it("shows a single cover without a badge when only one attachment exists", () => {
		const attachments = [makeAttachment(1, "A")];
		render(<CardBody card={card({ attachments })} />);

		expect(
			screen.getByRole("img", {
				name: "Attachment preview for Keep the title visible",
			}).getAttribute("src"),
		).toBe(attachments[0].thumbnailUrl);
		expect(screen.queryByText(/^\+/)).toBeNull();
		expect(screen.queryByLabelText(/more attachments/)).toBeNull();
	});

	it("falls back to the original when the cover thumbnail fails without looping", () => {
		const attachments = [makeAttachment(1, "A")];
		render(<CardBody card={card({ attachments })} />);

		const cover = screen.getByRole("img", {
			name: "Attachment preview for Keep the title visible",
		});
		fireEvent.error(cover);

		expect(cover.getAttribute("src")).toBe(attachments[0].originalUrl);
		fireEvent.error(cover);
		expect(cover.getAttribute("src")).toBe(attachments[0].originalUrl);
	});

	it("renders plain card content without cover or badge when attachments are empty", () => {
		render(<CardBody card={card({ attachments: [] })} />);

		expect(screen.queryByRole("img")).toBeNull();
		expect(screen.queryByText(/^\+/)).toBeNull();
		expect(screen.getByText("Keep the title visible")).toBeTruthy();
	});

	it("reverts to plain card content after the last attachment is removed", () => {
		const { rerender } = render(
			<CardBody
				card={card({
					attachments: [makeAttachment(1, "A"), makeAttachment(2, "B")],
				})}
			/>,
		);

		expect(screen.getByRole("img")).toBeTruthy();
		expect(screen.getByText("+1")).toBeTruthy();

		rerender(<CardBody card={card({ attachments: [] })} />);

		expect(screen.queryByRole("img")).toBeNull();
		expect(screen.queryByText(/^\+/)).toBeNull();
		expect(screen.getByText("Keep the title visible")).toBeTruthy();
	});
});
