import { vi } from "vitest";
import type { Card, CardAttachment, Column } from "./types";

export class HarnessEventSource {
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

export function installHarnessEventSourceAdapter(): void {
	HarnessEventSource.instances = [];
	vi.stubGlobal("EventSource", HarnessEventSource);
}

export function resetHarnessEventSourceInstances(): void {
	HarnessEventSource.instances = [];
}

export function getLatestHarnessEventSource(): HarnessEventSource {
	const instance = HarnessEventSource.instances.at(-1);
	if (!instance) throw new Error("EventSource not created");
	return instance;
}

type FetchRouterState<TCard extends Card> = {
	workspaceId: number;
	columnsWith: (card: TCard) => Column[];
	makeCard: (attachments: CardAttachment[]) => TCard;
	boardCallCount: number;
	boardAttachments: CardAttachment[];
};

export function createHarnessFetchRouter<TCard extends Card>({
	workspaceId,
	columnsWith,
	makeCard,
	initialAttachments,
}: {
	workspaceId: number;
	columnsWith: (card: TCard) => Column[];
	makeCard: (attachments: CardAttachment[]) => TCard;
	initialAttachments: CardAttachment[];
}) {
	const state: FetchRouterState<TCard> = {
		workspaceId,
		columnsWith,
		makeCard,
		boardCallCount: 0,
		boardAttachments: initialAttachments,
	};

	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = resolveFetchUrl(input);
		const method = (init?.method ?? "GET").toUpperCase();
		return routeHarnessFetch(state, url, method);
	});

	return {
		fetchImpl,
		getBoardCallCount: () => state.boardCallCount,
		setBoardAttachments: (attachments: CardAttachment[]) => {
			state.boardAttachments = attachments;
		},
	};
}

function resolveFetchUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

function routeHarnessFetch<TCard extends Card>(
	state: FetchRouterState<TCard>,
	url: string,
	method: string,
): Response {
	const { workspaceId } = state;

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
		state.boardCallCount += 1;
		return jsonResponse({
			columns: state.columnsWith(state.makeCard(state.boardAttachments)),
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
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
