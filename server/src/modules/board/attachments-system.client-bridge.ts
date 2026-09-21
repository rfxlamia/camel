// @ts-nocheck
// Runtime-only bridge to the client public API for integration tests.

type CreateCardInput = {
	baseUrl: string;
	workspaceId: number;
	columnId: number;
	title: string;
	thumbnail: Buffer;
	original: Buffer;
};

export async function invokeClientCreateCard(input: CreateCardInput) {
	const clientApi = await import("../../../../client/src/api");
	clientApi.configureRequestBoundaryForTests({ baseUrl: input.baseUrl });
	const thumbnailFile = new File([input.thumbnail], "thumbnail-0.png", {
		type: "image/png",
	});
	const originalFile = new File([input.original], "original-0.png", {
		type: "image/png",
	});
	return clientApi.api.createCard(input.workspaceId, {
		columnId: input.columnId,
		title: input.title,
		attachments: [{ thumbnail: thumbnailFile, original: originalFile }],
	});
}

export async function resetClientRequestBoundary(): Promise<void> {
	const clientApi = await import("../../../../client/src/api");
	clientApi.resetRequestBoundaryForTests();
}
