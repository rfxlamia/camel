import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { Card, CardAttachment, Column } from "./types";
import {
	createHarnessFetchRouter,
	getLatestHarnessEventSource,
	installHarnessEventSourceAdapter,
	resetHarnessEventSourceInstances,
	type HarnessEventSource,
} from "./attachments-system.harness-adapters";

export type { HarnessEventSource };

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
	const router = createHarnessFetchRouter({
		workspaceId,
		columnsWith,
		makeCard,
		initialAttachments,
	});

	return {
		install: () => {
			installHarnessEventSourceAdapter();
			vi.stubGlobal("fetch", router.fetchImpl);
		},
		teardown: () => {
			resetHarnessEventSourceInstances();
		},
		getBoardCallCount: router.getBoardCallCount,
		getEventSource: getLatestHarnessEventSource,
		_setRefreshedBoard: () => {
			router.setBoardAttachments(refreshedAttachments);
		},
	};
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
