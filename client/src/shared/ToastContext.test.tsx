// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	TOAST_DISMISS_MS,
	ToastProvider,
	useShowToast,
	useToastState,
} from "./ToastContext";

function ToastStateProbe() {
	const toast = useToastState();
	return (
		<span data-testid="toast">
			{toast ? `${toast.type}:${toast.message}` : ""}
		</span>
	);
}

function ShowToastButton({
	message,
	type,
}: {
	message: string;
	type?: "success" | "error" | "warning" | "info";
}) {
	const showToast = useShowToast();
	return (
		<button type="button" onClick={() => showToast(message, type)}>
			Show
		</button>
	);
}

describe("ToastContext", () => {
	afterEach(() => {
		cleanup();
	});

	it("throws when useShowToast is used outside ToastProvider", () => {
		expect(() => render(<ShowToastButton message="x" />)).toThrow(
			"useShowToast must be used within ToastProvider",
		);
	});

	it("throws when useToastState is used outside ToastProvider", () => {
		expect(() => render(<ToastStateProbe />)).toThrow(
			"useToastState must be used within ToastProvider",
		);
	});

	it("shows a toast with the default info type", () => {
		render(
			<ToastProvider>
				<ShowToastButton message="Saved" />
				<ToastStateProbe />
			</ToastProvider>,
		);

		act(() => {
			screen.getByRole("button", { name: "Show" }).click();
		});

		expect(screen.getByTestId("toast").textContent).toBe("info:Saved");
	});

	it("does not re-render useShowToast consumers when toast state changes", () => {
		const renders = { count: 0 };

		function ShowToastOnly() {
			const showToast = useShowToast();
			renders.count += 1;
			return (
				<button type="button" onClick={() => showToast("Later")}>
					Show
				</button>
			);
		}

		render(
			<ToastProvider>
				<ShowToastOnly />
				<ToastStateProbe />
			</ToastProvider>,
		);

		const afterMount = renders.count;
		act(() => {
			screen.getByRole("button", { name: "Show" }).click();
		});

		expect(screen.getByTestId("toast").textContent).toBe("info:Later");
		expect(renders.count).toBe(afterMount);
	});
});

describe("ToastContext dismiss timer", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("auto-dismisses at TOAST_DISMISS_MS", () => {
		vi.useFakeTimers();
		render(
			<ToastProvider>
				<ShowToastButton message="Hi" />
				<ToastStateProbe />
			</ToastProvider>,
		);

		act(() => {
			screen.getByRole("button", { name: "Show" }).click();
		});
		expect(screen.getByTestId("toast").textContent).toBe("info:Hi");

		act(() => {
			vi.advanceTimersByTime(TOAST_DISMISS_MS - 1);
		});
		expect(screen.getByTestId("toast").textContent).toBe("info:Hi");

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(screen.getByTestId("toast").textContent).toBe("");
	});

	it("resets the dismiss timer on a second showToast", () => {
		vi.useFakeTimers();
		render(
			<ToastProvider>
				<ShowToastButton message="First" />
				<ShowToastButton message="Second" />
				<ToastStateProbe />
			</ToastProvider>,
		);

		const [first, second] = screen.getAllByRole("button", { name: "Show" });
		act(() => {
			first.click();
		});
		act(() => {
			vi.advanceTimersByTime(TOAST_DISMISS_MS - 500);
		});
		act(() => {
			second.click();
		});

		act(() => {
			vi.advanceTimersByTime(TOAST_DISMISS_MS - 1);
		});
		expect(screen.getByTestId("toast").textContent).toBe("info:Second");

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(screen.getByTestId("toast").textContent).toBe("");
	});

	it("clears the timer on unmount without throwing", () => {
		vi.useFakeTimers();
		const { unmount } = render(
			<ToastProvider>
				<ShowToastButton message="Bye" />
				<ToastStateProbe />
			</ToastProvider>,
		);

		act(() => {
			screen.getByRole("button", { name: "Show" }).click();
		});

		expect(() => unmount()).not.toThrow();
		act(() => {
			vi.advanceTimersByTime(TOAST_DISMISS_MS);
		});
	});
});
