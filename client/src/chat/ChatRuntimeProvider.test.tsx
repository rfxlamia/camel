// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRuntimeProvider } from "./ChatRuntimeProvider";
import { ChatPanel } from "./ui";

vi.mock("../hooks/useChatStream", () => ({
	useChatStream: () => ({
		messages: [],
		retry: vi.fn(),
		canRetry: true,
		overflowError: null,
		overflowMessage: null,
		send: vi.fn(),
		runModelTurn: async function* () {
			yield { content: [{ type: "text" as const, text: "" }] };
		},
	}),
}));

describe("ChatRuntimeProvider", () => {
	beforeEach(() => {
		global.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as typeof ResizeObserver;
	});

	it("renders assistant-ui primitives without AuiProvider error", () => {
		render(
			<ChatRuntimeProvider threadId="42" workspaceId={7}>
				<ChatPanel />
			</ChatRuntimeProvider>,
		);
		expect(screen.getByPlaceholderText("Message Camel…")).toBeTruthy();
	});
});
