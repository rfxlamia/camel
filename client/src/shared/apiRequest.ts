import type { FocusSession } from "../types";
import type { TaskCreateFieldErrors } from "./taskCreateContracts";
import { publishAutoError } from "./ticketIntakeBus";

export class ApiError extends Error {
	session?: FocusSession | null;

	constructor(
		message: string,
		public status: number,
		public code?: string,
		public retryAfterMs?: number,
		public fieldErrors?: TaskCreateFieldErrors,
		session?: FocusSession | null,
	) {
		super(message);
		this.session = session;
	}
}

export interface RequestOptions {
	userInitiated?: boolean;
	userAction?: string;
}

type ErrorFallback = string | ((status: number) => string);

export interface ApiRequest {
	<T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T>;
	stream(
		path: string,
		body: Record<string, unknown>,
	): Promise<ReadableStream<Uint8Array>>;
	blob(path: string, credentials?: RequestCredentials): Promise<Blob>;
	raw<T>(
		path: string,
		init?: RequestInit,
		fallback?: ErrorFallback,
		validateStatus?: boolean,
	): Promise<T>;
}

let requestBaseUrl = "";
let requestFetch: typeof fetch | null = null;

export function configureRequestBoundaryForTests(
	options: { baseUrl?: string; fetchImpl?: typeof fetch | null } = {},
): void {
	if (options.baseUrl !== undefined) requestBaseUrl = options.baseUrl;
	if (options.fetchImpl !== undefined) requestFetch = options.fetchImpl;
}

export function resetRequestBoundaryForTests(): void {
	requestBaseUrl = "";
	requestFetch = null;
}

function readCookie(name: string): string | null {
	if (typeof document === "undefined") return null;
	const match = document.cookie.match(
		new RegExp(
			"(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)",
		),
	);
	return match ? decodeURIComponent(match[1]) : null;
}

async function throwRequestError(
	res: Response,
	endpoint: string,
	options?: RequestOptions,
	fallback = `Request failed (${res.status})`,
): Promise<never> {
	let message = fallback;
	let code: string | undefined;
	let retryAfterMs: number | undefined;
	let fieldErrors: TaskCreateFieldErrors | undefined;
	let session: FocusSession | null | undefined;
	try {
		const body = await res.json();
		if (body.error) message = body.error;
		if (body.message) message = body.message;
		if (body.code) code = body.code;
		if (typeof body.retryAfterMs === "number") retryAfterMs = body.retryAfterMs;
		if (body.fieldErrors !== undefined) fieldErrors = body.fieldErrors;
		if ("session" in body) session = body.session as FocusSession | null;
	} catch {
		// Non-JSON error body.
	}
	if (options?.userInitiated && res.status >= 500) {
		publishAutoError({
			endpoint,
			status: res.status,
			message,
			timestamp: new Date().toISOString(),
			userAction: options.userAction,
		});
	}
	throw new ApiError(
		message,
		res.status,
		code,
		retryAfterMs,
		fieldErrors,
		session,
	);
}

export function createApiRequest(): ApiRequest {
	const execute = async (
		path: string,
		init?: RequestInit,
		options?: RequestOptions,
		fallback?: ErrorFallback,
		validateStatus = true,
	): Promise<Response> => {
		const method = (init?.method ?? "GET").toUpperCase();
		const headers = new Headers(init?.headers);
		const endpoint = `${requestBaseUrl}/api${path}`;
		if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
			headers.set("Content-Type", "application/json");
		}
		if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
			const csrf = readCookie("csrf_token");
			if (csrf) headers.set("X-CSRF-Token", csrf);
		}
		const res = await (requestFetch ?? fetch)(endpoint, {
			...init,
			headers,
			credentials: init?.credentials ?? "include",
		});
		if (validateStatus && !res.ok) {
			await throwRequestError(
				res,
				endpoint,
				options,
				typeof fallback === "function" ? fallback(res.status) : fallback,
			);
		}
		return res;
	};

	const request = (async <T>(
		path: string,
		init?: RequestInit,
		options?: RequestOptions,
	): Promise<T> => {
		const res = await execute(path, init, options);
		if (res.status === 204) return undefined as T;
		return res.json();
	}) as ApiRequest;

	request.stream = async (path, body) => {
		const res = await execute(path, {
			method: "POST",
			body: JSON.stringify(body),
		});
		if (!res.body) throw new ApiError("Empty response body", res.status);
		return res.body;
	};
	request.blob = async (path, credentials = "include") =>
		(await execute(path, { credentials })).blob();
	request.raw = async <T>(
		path: string,
		init?: RequestInit,
		fallback?: ErrorFallback,
		validateStatus = true,
	): Promise<T> => {
		const res = await execute(path, init, undefined, fallback, validateStatus);
		// Specialized JSON fetches (logo upload / OAuth) historically parse
		// their response even on 204; only the ordinary request skips parsing.
		return res.json();
	};
	return request;
}
