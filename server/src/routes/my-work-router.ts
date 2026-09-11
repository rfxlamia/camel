import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { parseKeyFromUrl } from "../core/tracker-key.js";
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
	return { list, detail };
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
	return router;
}

export const myWorkRouter = createMyWorkRouter();

export type { MyWorkRouterOptions, MyWorkServiceLike };
