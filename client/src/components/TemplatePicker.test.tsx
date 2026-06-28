// client/src/components/TemplatePicker.test.tsx — jsdom.
// No jest-dom in this repo (no setupFiles): use .disabled / toBeTruthy /
// queryBy, not toBeInTheDocument/toBeDisabled. Lottie children are stubbed.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./LoadingCamel", () => ({
	default: () => <div data-testid="loading-camel" />,
}));
vi.mock("./SuccessAnimation", () => ({
	default: () => <div data-testid="success-animation" />,
}));

import { WORKSPACE_TEMPLATES } from "../lib/templates";
import TemplatePicker from "./TemplatePicker";

afterEach(cleanup);

function renderPicker(
	overrides: Partial<Parameters<typeof TemplatePicker>[0]> = {},
) {
	const onApply = vi.fn();
	const onStartBlank = vi.fn();
	render(
		<TemplatePicker
			templates={WORKSPACE_TEMPLATES}
			state="idle"
			onApply={onApply}
			onStartBlank={onStartBlank}
			{...overrides}
		/>,
	);
	return { onApply, onStartBlank };
}

describe("TemplatePicker", () => {
	it("renders all 5 template names", () => {
		renderPicker();
		for (const t of WORKSPACE_TEMPLATES) {
			expect(screen.getByText(t.name)).toBeTruthy();
		}
	});

	it("renders column titles and policy descriptions as visible text (not hover/title-attr)", () => {
		renderPicker();
		const first = WORKSPACE_TEMPLATES[0];
		for (const c of first.columns) {
			// getByText matches rendered text content, NOT title/aria attributes.
			expect(screen.getAllByText(c.title).length).toBeGreaterThan(0);
			expect(screen.getAllByText(c.policy).length).toBeGreaterThan(0);
		}
	});

	it("calls onApply once with the clicked template", () => {
		const { onApply } = renderPicker();
		const buttons = screen.getAllByRole("button", {
			name: /use this template/i,
		});
		fireEvent.click(buttons[0]);
		expect(onApply).toHaveBeenCalledTimes(1);
		expect(onApply).toHaveBeenCalledWith(WORKSPACE_TEMPLATES[0]);
	});

	it("calls onStartBlank once when 'Start blank instead' is clicked", () => {
		const { onStartBlank } = renderPicker();
		fireEvent.click(
			screen.getByRole("button", { name: /start blank instead/i }),
		);
		expect(onStartBlank).toHaveBeenCalledTimes(1);
	});

	it("shows a loading indicator and disables apply when state='loading'", () => {
		renderPicker({ state: "loading" });
		expect(screen.getByTestId("loading-camel")).toBeTruthy();
		// Any rendered apply button must be disabled (no enabled apply path).
		for (const b of screen.queryAllByRole("button", {
			name: /use this template/i,
		})) {
			expect((b as HTMLButtonElement).disabled).toBe(true);
		}
	});

	it("shows the success copy when state='success'", () => {
		renderPicker({ state: "success" });
		expect(screen.getByTestId("success-animation")).toBeTruthy();
		expect(screen.getByText(/edit any column anytime/i)).toBeTruthy();
	});
});
