import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Card } from "../types";
import { CardBody } from "./CardView";

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
});
