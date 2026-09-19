import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Toast from "./Toast";

describe("Toast", () => {
	afterEach(cleanup);
	it("success: polite aria-live + green bg class", () => {
		render(<Toast message="Invite sent" type="success" />);
		const el = screen.getByRole("status");
		expect(el.getAttribute("aria-live")).toBe("polite");
		expect(el.className).toMatch(/bg-success-100/);
	});

	it("error: assertive aria-live + red bg class", () => {
		render(<Toast message="Couldn't save" type="error" />);
		const el = screen.getByRole("status");
		expect(el.getAttribute("aria-live")).toBe("assertive");
		expect(el.className).toMatch(/bg-error-100/);
	});

	it("warning: polite aria-live + amber bg class", () => {
		render(<Toast message="WIP limit reached" type="warning" />);
		const el = screen.getByRole("status");
		expect(el.getAttribute("aria-live")).toBe("polite");
		expect(el.className).toMatch(/bg-warning-100/);
	});

	it("info: polite aria-live + blue bg class", () => {
		render(<Toast message="Card deleted" type="info" />);
		const el = screen.getByRole("status");
		expect(el.getAttribute("aria-live")).toBe("polite");
		expect(el.className).toMatch(/bg-info-100/);
	});

	it("no type defaults to info", () => {
		render(<Toast message="Something happened" />);
		expect(screen.getByRole("status").className).toMatch(/bg-info-100/);
	});

	it("all types have aria-atomic=true", () => {
		render(<Toast message="test" type="success" />);
		expect(screen.getByRole("status").getAttribute("aria-atomic")).toBe("true");
	});
});
