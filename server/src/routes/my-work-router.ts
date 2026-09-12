import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { parseKeyFromUrl } from "../core/tracker-key.js";
import { domainBus, EVENTS } from "../events.js";
import { publishEvent } from "../realtime.js";
import { parseMyWorkQuery } from "./my-work-query-parser.js";
import {
	createMyWorkService,
	MyWorkUnavailableError,
} from "./my-work-service.js";
import type {
	MyWorkRouterOptions,
	MyWorkServiceLike,
} from "./my-work-types.js";

function serviceMethods(service: MyWorkServiceLike) {
	const list = "list" in service ? service.list : service.listMyWork;
	const detail =
		"getDetail" in service ? service.getDetail : service.getMyWorkItem;
	const markDone = service.markDone ?? service.markMyWorkDone;
	return { list, detail, markDone };
}

function routeParam(value: unknown): string {
	return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function sendUnavailable(res: Response): void {
	res.status(503).json({
		error: "Unable to load My Work",
		code: "my_work_unavailable",
		retryable: true,
	});
}

function isMyWorkReadFailure(error: unknown): boolean {
	if (error instanceof MyWorkUnavailableError) return true;
	if (error instanceof Error) return true;
	if (typeof error !== "object" || error === null) return true;
	const candidate = error as {
		retryable?: unknown;
		status?: unknown;
		statusCode?: unknown;
	};
	return (
		candidate.retryable === true ||
		(typeof candidate.status === "number" && candidate.status >= 500) ||
		(typeof candidate.statusCode === "number" && candidate.statusCode >= 500)
	);
}

function requireMyWorkAuth(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	if (!req.user) {
		res.status(401).json({ error: "authentication required" });
		return;
	}
	next();
}

function createListHandler(methods: ReturnType<typeof serviceMethods>) {
	return async (req: Request, res: Response) => {
		const parsed = parseMyWorkQuery(req.query);
		if (!parsed.ok) return res.status(400).json({ error: parsed.error });
		try {
			const result = await methods.list({
				userId: req.user!.id,
				...parsed.value,
			});
			return res.json(result);
		} catch (error) {
			if (isMyWorkReadFailure(error)) {
				sendUnavailable(res);
				return;
			}
			throw error;
		}
	};
}

function createDetailHandler(methods: ReturnType<typeof serviceMethods>) {
	return async (req: Request, res: Response) => {
		const workspaceValue = routeParam(req.params.workspaceId);
		const workspaceId = Number(workspaceValue);
		if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
			return res
				.status(400)
				.json({ error: "workspaceId must be a positive integer" });
		}
		const sourceValue = routeParam(req.params.source);
		if (sourceValue !== "board" && sourceValue !== "tracker") {
			return res.status(400).json({ error: "source must be board or tracker" });
		}
		const key = routeParam(req.params.key);
		const parsedKey = parseKeyFromUrl(key);
		if (!parsedKey) {
			return res.status(400).json({ error: "invalid work item key" });
		}

		try {
			const result = await methods.detail({
				userId: req.user!.id,
				workspaceId,
				source: sourceValue,
				key,
				keyNumber: parsedKey.keyNumber,
			});
			if (!result) return res.status(404).json({ error: "Not found" });
			return res.json(result);
		} catch (error) {
			if (isMyWorkReadFailure(error)) {
				sendUnavailable(res);
				return;
			}
			throw error;
		}
	};
}

function createMarkDoneHandler(methods: ReturnType<typeof serviceMethods>) {
	return async (req: Request, res: Response) => {
		const workspaceValue = routeParam(req.params.workspaceId);
		const workspaceId = Number(workspaceValue);
		if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
			return res
				.status(400)
				.json({ error: "workspaceId must be a positive integer" });
		}

		const sourceValue = routeParam(req.params.source);
		if (sourceValue !== "board" && sourceValue !== "tracker") {
			return res.status(400).json({ error: "source must be board or tracker" });
		}

		const key = routeParam(req.params.key);
		const parsedKey = parseKeyFromUrl(key);
		if (!parsedKey) {
			return res.status(400).json({ error: "invalid work item key" });
		}

		const body = req.body ?? {};
		const version = body.version as unknown;
		if (version !== undefined && !Number.isInteger(version)) {
			return res.status(400).json({ error: "version must be an integer" });
		}
		if (!methods.markDone) {
			sendUnavailable(res);
			return;
		}

		try {
			const result = await methods.markDone({
				userId: req.user!.id,
				actor: req.user!,
				workspaceId,
				source: sourceValue,
				keyNumber: parsedKey.keyNumber,
				version: version as number | undefined,
			});
			if (result.kind === "not_found") {
				return res.status(404).json({ error: "Not found" });
			}
			if (result.kind === "conflict") {
				return res.status(409).json({
					error: "Someone else updated this item first.",
					code: "version_conflict",
				});
			}
			if (result.kind === "unmappable" || result.kind === "invalid_status") {
				return res.status(409).json({
					error: "This status cannot be mapped to the current board columns.",
					code: "status_column_unmappable",
				});
			}
			if (result.kind === "wip") {
				return res.status(409).json({
					error: "WIP limit reached for this column",
					reason: result.reason,
				});
			}

			const item = await methods.detail({
				userId: req.user!.id,
				workspaceId,
				source: sourceValue,
				key,
				keyNumber: parsedKey.keyNumber,
			});
			if (!item) return res.status(404).json({ error: "Not found" });

			if (result.source === "tracker") {
				await publishEvent(workspaceId, {
					type: "tracker.updated",
					actor: req.user!,
					trackerItemId: result.itemId,
				});
			} else {
				await publishEvent(workspaceId, {
					type: result.moved ? "card.moved" : "card.updated",
					actor: req.user!,
					cardId: result.itemId,
					payload: { key: item.key },
				});

				if (result.addedSignableAssignee != null) {
					domainBus.emit(EVENTS.CARD_ASSIGNED, {
						type: EVENTS.CARD_ASSIGNED,
						workspaceId,
						actorId: req.user!.id,
						payload: {
							cardId: result.itemId,
							assigneeId: result.addedSignableAssignee,
							cardTitle: result.itemTitle,
							actorDisplayName: req.user!.displayName,
						},
					});
				}
			}
			return res.json(item);
		} catch {
			sendUnavailable(res);
		}
	};
}

/** Creates the global authenticated router. It is mounted under /api/my-work. */
export function createMyWorkRouter(options: MyWorkRouterOptions = {}): Router {
	const service =
		options.service ??
		createMyWorkService(options.deps ?? options.dbExec ?? {});
	const methods = serviceMethods(service);
	const router = Router();
	router.use(requireMyWorkAuth);
	router.get("/", createListHandler(methods));
	router.get("/:workspaceId/:source/:key", createDetailHandler(methods));
	router.post(
		"/:workspaceId/:source/:key/done",
		createMarkDoneHandler(methods),
	);
	return router;
}

export const myWorkRouter = createMyWorkRouter();

export type { MyWorkRouterOptions, MyWorkServiceLike };
