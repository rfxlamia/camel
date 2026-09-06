import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { Card, CardAttachment, Column } from "./types";

class HarnessEventSource {
	static instances: HarnessEventSource[] = [];
	url: string;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	close = vi.fn();

	constructor(url: string) {
		this.url = url;
		HarnessEventSource.instances.push(this);
	}
}

export type AttachmentViewerHarness = {
	install: () => void;
	teardown: () => void;
	getBoardCallCount: () => number;
	getEventSource: () => HarnessEventSource;
	_setRefreshedBoard: () => void;
};

type HarnessOptions<TCard extends Card> = {
	workspaceId: number;
	cardId: number;
	initialAttachments: CardAttachment[];
	refreshedAttachments: CardAttachment[];
	columnsWith: (card: TCard) => Column[];
	makeCard: (attachments: CardAttachment[]) => TCard;
};

export function createAttachmentViewerHarness<TCard extends Card>({
	workspaceId,
	initialAttachments,
	refreshedAttachments,
	columnsWith,
	makeCard,
}: HarnessOptions<TCard>): AttachmentViewerHarness {
	let boardCallCount = 0;
	let boardAttachments = initialAttachments;

	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const method = (init?.method ?? "GET").toUpperCase();

		if (url === "/api/workspaces" && method === "GET") {
			return jsonResponse({
				workspaces: [
					{
						id: workspaceId,
						name: "Workspace A",
						role: "member",
						isPersonal: false,
						memberCount: 2,
					},
				],
				invites: [],
			});
		}
		if (url === `/api/workspaces/${workspaceId}/board` && method === "GET") {
			boardCallCount += 1;
			return jsonResponse({
				columns: columnsWith(makeCard(boardAttachments)),
			});
		}
		if (url === `/api/workspaces/${workspaceId}/metrics` && method === "GET") {
			return jsonResponse(null);
		}
		if (url === `/api/workspaces/${workspaceId}/activity` && method === "GET") {
			return jsonResponse({ events: [] });
		}
		if (url === `/api/workspaces/${workspaceId}/settings` && method === "GET") {
			return jsonResponse({ settings: {} });
		}
		if (url === `/api/workspaces/${workspaceId}/presence` && method === "GET") {
			return jsonResponse({ users: [] });
		}
		if (
			url === `/api/workspaces/${workspaceId}/presence/heartbeat` &&
			method === "POST"
		) {
			return jsonResponse({ ok: true });
		}
		if (url === "/api/ticket-intake/config" && method === "GET") {
			return jsonResponse({ enabled: false });
		}
		if (url === "/api/focus/config" && method === "GET") {
			return jsonResponse({ enabled: false });
		}

		throw new Error(`Unhandled harness fetch: ${method} ${url}`);
	});

	return {
		install: () => {
			HarnessEventSource.instances = [];
			vi.stubGlobal("fetch", fetchImpl);
			vi.stubGlobal("EventSource", HarnessEventSource);
		},
		teardown: () => {
			HarnessEventSource.instances = [];
		},
		getBoardCallCount: () => boardCallCount,
		getEventSource: () => {
			const instance = HarnessEventSource.instances.at(-1);
			if (!instance) throw new Error("EventSource not created");
			return instance;
		},
		_setRefreshedBoard: () => {
			boardAttachments = refreshedAttachments;
		},
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function emitAttachmentAddedEvent(
	harness: AttachmentViewerHarness,
	event: Record<string, unknown>,
) {
	harness._setRefreshedBoard();
	const stream = harness.getEventSource();
	await act(async () => {
		stream.onmessage?.({ data: JSON.stringify(event) });
	});
}

export async function advanceRefreshDebounce() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 200));
	});
}
