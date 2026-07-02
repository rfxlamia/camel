import { describe, expect, it, vi } from "vitest";
import {
	publishAutoError,
	subscribeAutoError,
	type AutoErrorDetail,
} from "./ticketIntakeBus";

describe("ticketIntakeBus", () => {
	it("notifies subscribers when publishAutoError is called", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeAutoError(listener);

		const detail: AutoErrorDetail = {
			endpoint: "/api/workspaces/1/cards/42",
			status: 500,
			message: "Internal Server Error",
			timestamp: "2026-07-02T12:00:00.000Z",
			userAction: "Save",
		};
		publishAutoError(detail);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(detail);
		unsubscribe();
	});

	it("supports multiple subscribers", () => {
		const a = vi.fn();
		const b = vi.fn();
		const unsubA = subscribeAutoError(a);
		const unsubB = subscribeAutoError(b);

		const detail: AutoErrorDetail = {
			endpoint: "/api/workspaces/1/cards",
			status: 502,
			message: "Bad Gateway",
			timestamp: "2026-07-02T12:00:00.000Z",
			userAction: "submit",
		};
		publishAutoError(detail);

		expect(a).toHaveBeenCalledWith(detail);
		expect(b).toHaveBeenCalledWith(detail);
		unsubA();
		unsubB();
	});

	it("stops notifying after unsubscribe", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeAutoError(listener);
		unsubscribe();

		publishAutoError({
			endpoint: "/api/workspaces/1/cards/42/move",
			status: 500,
			message: "fail",
			timestamp: "2026-07-02T12:00:00.000Z",
			userAction: "drag-drop",
		});

		expect(listener).not.toHaveBeenCalled();
	});
});
