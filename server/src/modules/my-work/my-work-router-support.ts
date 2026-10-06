import type { Response } from "express";
import type { MyWorkServiceLike } from "./my-work-types.js";

export function serviceMethods(service: MyWorkServiceLike) {
	const list = "list" in service ? service.list : service.listMyWork;
	const detail =
		"getDetail" in service ? service.getDetail : service.getMyWorkItem;
	const markDone = service.markDone ?? service.markMyWorkDone;
	return { list, detail, markDone };
}

export type MyWorkServiceMethods = ReturnType<typeof serviceMethods>;

/** Coerces an Express route param (possibly an array) to a string. */
export function routeParam(value: unknown): string {
	return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

export function sendUnavailable(res: Response): void {
	res.status(503).json({
		error: "Unable to load My Work",
		code: "my_work_unavailable",
		retryable: true,
	});
}

/** Raw `:workspaceId/:source/:key` params, array-coerced for validation. */
export function rawWorkItemParams(params: Record<string, unknown>) {
	return {
		workspaceId: routeParam(params.workspaceId),
		source: routeParam(params.source),
		key: routeParam(params.key),
	};
}
