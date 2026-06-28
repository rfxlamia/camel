import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseBoard, applyTemplate, refresh, showToast, navigate } =
	vi.hoisted(() => ({
		mockUseBoard: vi.fn(),
		applyTemplate: vi.fn(),
		refresh: vi.fn(),
		showToast: vi.fn(),
		navigate: vi.fn(),
	}));

vi.mock("../context/BoardContext", () => ({
	useBoard: () => mockUseBoard(),
}));

vi.mock("react-router", () => ({
	useNavigate: () => navigate,
	Outlet: () => null,
}));

vi.mock("../api", () => ({
	ApiError: class ApiError extends Error {
		status: number;
		code?: string;
		constructor(message: string, status: number, code?: string) {
			super(message);
			this.status = status;
			this.code = code;
		}
	},
	api: {
		applyTemplate: (...a: unknown[]) => applyTemplate(...a),
		createColumn: vi.fn(),
		createCard: vi.fn(),
		moveCard: vi.fn(),
		updateColumn: vi.fn(),
	},
}));

vi.mock("../components/LoadingCamel", () => ({
	default: () => <div data-testid="loading-camel" />,
}));
vi.mock("../components/SuccessAnimation", () => ({
	default: () => <div data-testid="success-animation" />,
}));

import { ApiError } from "../api";
import BoardPage from "./BoardPage";

beforeEach(() => {
	applyTemplate.mockReset();
	refresh.mockReset().mockResolvedValue(undefined);
	showToast.mockReset();
	mockUseBoard.mockReturnValue({
		columns: [],
		setColumns: vi.fn(),
		loadError: false,
		refresh,
		cancelScheduledRefresh: vi.fn(),
		showToast,
		deleteCard: vi.fn(),
		activeWorkspaceId: 7,
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("BoardPage empty-board template picker", () => {
	it("renders the TemplatePicker on an empty board (not the bare AddColumn empty state)", () => {
		render(<BoardPage />);
		expect(screen.getByText("Software Dev")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /^add column$/i }),
		).toBeNull();
	});

	it("on a 409 apply, silently refetches and shows no error toast", async () => {
		applyTemplate.mockRejectedValueOnce(new ApiError("conflict", 409));
		render(<BoardPage />);
		fireEvent.click(
			screen.getAllByRole("button", { name: /use this template/i })[0],
		);
		await waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(showToast.mock.calls.every((c) => c[1] !== "error")).toBe(true);
	});

	it("on a non-409 apply error, shows an error toast and keeps the picker", async () => {
		applyTemplate.mockRejectedValueOnce(new ApiError("server boom", 500));
		render(<BoardPage />);
		fireEvent.click(
			screen.getAllByRole("button", { name: /use this template/i })[0],
		);
		await waitFor(() =>
			expect(showToast.mock.calls.some((c) => c[1] === "error")).toBe(true),
		);
		expect(screen.getByText("Software Dev")).toBeTruthy();
	});

	it("on 'Start blank instead', shows the manual AddColumn state and never applies", () => {
		render(<BoardPage />);
		fireEvent.click(
			screen.getByRole("button", { name: /start blank instead/i }),
		);
		expect(
			screen.getByRole("button", { name: /^add column$/i }),
		).toBeTruthy();
		expect(applyTemplate).not.toHaveBeenCalled();
	});
});
