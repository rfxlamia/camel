import {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import {
	type MyWorkObservability,
	myWorkObservability,
} from "../../core/my-work-observability.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { createMarkDoneHandler } from "./my-work-mark-done-handler.js";
import { parseMyWorkQuery } from "./my-work-query-parser.js";
import { workItemParams } from "./my-work-route-params.js";
import {
	type MyWorkServiceMethods,
	rawWorkItemParams,
	sendUnavailable,
	serviceMethods,
} from "./my-work-router-support.js";
import {
	createMyWorkService,
	MyWorkUnavailableError,
} from "./my-work-service.js";
import type {
	MyWorkRouterOptions,
	MyWorkServiceLike,
} from "./my-work-types.js";

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

/**
 * Observes authentication failures before the API-wide auth middleware rejects
 * the request. Authorized requests are left untouched because requireAuth sets
 * req.user before any response status is written.
 */
export function createMyWorkPreAuthObservabilityMiddleware(
	observability: MyWorkObservability,
) {
	return (req: Request, res: Response, next: NextFunction): void => {
		let recorded = false;
		const originalStatus = res.status.bind(res);
		res.status = (statusCode: number) => {
			if (!recorded && !req.user && statusCode === 401) {
				recorded = true;
				observability.record({
					latencyMs: 0,
					count: 0,
					statusCode,
				});
			}
			return originalStatus(statusCode);
		};
		next();
	};
}

function createMyWorkAuthMiddleware(observability: MyWorkObservability) {
	return (req: Request, res: Response, next: NextFunction): void => {
		if (!req.user) {
			observability.record({
				latencyMs: 0,
				count: 0,
				statusCode: 401,
			});
			res.status(401).json({ error: "authentication required" });
			return;
		}
		next();
	};
}

function createListHandler(
	methods: MyWorkServiceMethods,
	observability: MyWorkObservability,
) {
	return async (req: Request, res: Response) => {
		const measurement = observability.start();
		const parsed = parseMyWorkQuery(req.query);
		if (!parsed.ok) {
			measurement.finish({ count: 0, statusCode: 400 });
			return sendValidationError(res, { error: parsed.error });
		}
		try {
			const result = await methods.list({
				userId: req.user!.id,
				...parsed.value,
			});
			measurement.finish({
				count: result.items.length,
				statusCode: 200,
			});
			return res.json(result);
		} catch (error) {
			if (isMyWorkReadFailure(error)) {
				measurement.finish({ count: 0, statusCode: 503, error });
				sendUnavailable(res);
				return;
			}
			measurement.finish({ count: 0, statusCode: 500, error });
			throw error;
		}
	};
}

function createDetailHandler(methods: MyWorkServiceMethods) {
	return async (req: Request, res: Response) => {
		const parsedParams = parseWith(
			workItemParams,
			rawWorkItemParams(req.params),
		);
		if (!parsedParams.ok) return sendValidationError(res, parsedParams.body);
		const {
			workspaceId,
			source: sourceValue,
			key,
			keyNumber,
		} = parsedParams.data;

		try {
			const result = await methods.detail({
				userId: req.user!.id,
				workspaceId,
				source: sourceValue,
				key,
				keyNumber,
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
type MyWorkRouterOptionsWithObservability = MyWorkRouterOptions & {
	observability?: MyWorkObservability;
};

export function createMyWorkRouter(
	options: MyWorkRouterOptionsWithObservability = {},
): Router {
	const service =
		options.service ??
		createMyWorkService(options.deps ?? options.dbExec ?? {});
	const methods = serviceMethods(service);
	const observability = options.observability ?? myWorkObservability;
	const router = Router();
	router.use(createMyWorkAuthMiddleware(observability));
	router.get("/", createListHandler(methods, observability));
	router.get("/:workspaceId/:source/:key", createDetailHandler(methods));
	router.post(
		"/:workspaceId/:source/:key/done",
		createMarkDoneHandler(methods),
	);
	return router;
}

export const myWorkRouter = createMyWorkRouter();

export type { MyWorkRouterOptions, MyWorkServiceLike };
