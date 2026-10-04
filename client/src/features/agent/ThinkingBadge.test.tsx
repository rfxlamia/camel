// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ThinkingBadge from "./ThinkingBadge";

describe("ThinkingBadge", () => {
	it("shows ON when the column requests thinking", () => {
		render(<ThinkingBadge enabled />);
		expect(screen.getByText("ON")).toBeTruthy();
	});

	it("shows OFF when the column has reasoning disabled", () => {
		render(<ThinkingBadge enabled={false} />);
		expect(screen.getByText("OFF")).toBeTruthy();
	});
});
