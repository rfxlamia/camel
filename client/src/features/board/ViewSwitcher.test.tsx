import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ViewSwitcher from "./ViewSwitcher";

describe("ViewSwitcher", () => {
	afterEach(cleanup);
	it("renders Board, List, Calendar options with active state", () => {
		const onChange = vi.fn();
		render(<ViewSwitcher value="board" onChange={onChange} />);
		expect(
			screen.getByRole("tab", { name: /board/i }).getAttribute("aria-selected"),
		).toBe("true");
		fireEvent.click(screen.getByRole("tab", { name: /list/i }));
		expect(onChange).toHaveBeenCalledWith("list");
	});

	it("calls onChange with calendar when Calendar tab clicked", () => {
		const onChange = vi.fn();
		render(<ViewSwitcher value="board" onChange={onChange} />);
		fireEvent.click(screen.getByRole("tab", { name: /calendar/i }));
		expect(onChange).toHaveBeenCalledWith("calendar");
	});
});
