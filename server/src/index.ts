import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import {
	startBackgroundJobs,
	stopBackgroundJobs,
} from "./core/background-jobs.js";
import { createOriginValidator } from "./core/cors.js";
import { pool } from "./db/pool.js";
import { connectRedis } from "./db/redis.js";
import { registerHealthRoutes } from "./lib/health.js";
import { logger } from "./lib/logger.js";
import {
	csrfProtection,
	generateCsrfToken,
	setCsrfToken,
} from "./middleware/csrf.js";
import { createErrorHandler } from "./middleware/error-handler.js";
import { requestContextMiddleware } from "./middleware/request-context.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { requestTimeout, serverTimeout } from "./middleware/timeout.js";
import {
	createAgentRouter,
	ticketIntakeRouter,
} from "./modules/agent/index.js";
import {
	betterAuthHandler,
	createAuthRateLimiter,
	createAuthRouter,
	createOAuthBridgeRouter,
	oauthRouter,
} from "./modules/auth/index.js";
import { createChatRouter } from "./modules/chat/index.js";
import { UPLOADS_DIR } from "./modules/settings/index.js";
import { shutdownRealtime } from "./realtime.js";
import { api } from "./routes.js";

const app = express();
// Trust the first proxy hop (reverse proxy / LB) so req.ip reflects the real client IP.
// Adjust the number if the deployment has more than one proxy hop.
// See: https://expressjs.com/en/guide/behind-proxies.html
app.set("trust proxy", 1);
app.use(requestContextMiddleware());
app.use(securityHeaders());
app.use(cors({ origin: createOriginValidator(), credentials: true }));

// Better Auth handler MUST be mounted BEFORE express.json() — mandatory per Better Auth docs.
// Spike B confirmed: toNodeHandler does NOT call next() for unrecognized routes — it returns 404.
// Mount only the specific paths Better Auth owns, so existing routes (/login, /me, etc.) are unaffected.
if (config.OAUTH_ENABLED === "true") {
	app.all("/api/auth/sign-in/*splat", betterAuthHandler);
	app.all("/api/auth/callback/*splat", betterAuthHandler);
}

app.use(express.json());
app.use(cookieParser());

// 30s request timeout for the STANDARD board API only.
// Skip agent endpoints (buffered, long-running) and the SSE stream.
const isTimeoutExempt = (path: string) =>
	path.includes("/agent/") ||
	path.includes("/chat/") ||
	path.endsWith("/events/stream");

app.use((req, res, next) => {
	if (!req.path.startsWith("/api/")) return next();
	if (isTimeoutExempt(req.path)) return next();
	return requestTimeout(30000)(req, res, next);
});

// Unauthenticated and cookie-free: mounted before CSRF cookie middleware.
registerHealthRoutes(app, { isShuttingDown: () => isShuttingDown });

// Issue CSRF cookie on every response
app.use(setCsrfToken);

// Enforce CSRF on mutating /api requests, EXCEPT auth bootstrap
app.use((req, res, next) => {
	if (!req.path.startsWith("/api/")) return next();
	// Explicit allowlist for auth endpoints that need to bypass CSRF
	const csrfExemptPaths = ["/api/auth/login", "/api/auth/register"];
	const isBetterAuthOAuthRoute =
		req.path.startsWith("/api/auth/sign-in/") ||
		req.path.startsWith("/api/auth/callback/");
	if (csrfExemptPaths.includes(req.path) || isBetterAuthOAuthRoute)
		return next();
	return csrfProtection(req, res, next);
});

// Security headers for uploaded files to prevent content-type sniffing
app.use(
	"/uploads",
	(_req, res, next) => {
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Content-Disposition", "inline");
		next();
	},
	express.static(UPLOADS_DIR),
);

// CSRF token endpoint for client to retrieve the token
app.get("/api/csrf-token", (req, res) => {
	// Use the token from cookie (set by setCsrfToken middleware) or generate new one
	const token = req.cookies?.["csrf_token"] || generateCsrfToken();
	res.json({ csrfToken: token });
});

// Initialize synchronously with the in-memory limiter so auth endpoints are
// rate-limited from the very first request (before Redis connects). Without
// this, there is a window between listen() and connectRedis() where auth has
// no rate limiting. Upgraded to the Redis-backed limiter after connectRedis().
let rateLimiterInstance: express.RequestHandler = createAuthRateLimiter();
const delegatingLimiter: express.RequestHandler = (req, res, next) =>
	rateLimiterInstance(req, res, next);

// Mount routes before async boot so they're always available immediately.
app.use("/api/auth", createOAuthBridgeRouter()); // camel_session bridge
app.use("/api/auth", oauthRouter); // set-username, set-password (outside email gate)
app.use("/api/auth", createAuthRouter(delegatingLimiter));
app.use("/api", api);
app.use(createChatRouter());
app.use("/api", createAgentRouter());
app.use("/api", ticketIntakeRouter);

app.use(createErrorHandler());

// Module-scope flag so health endpoint and shutdown handler share state.
let isShuttingDown = false;
let server: ReturnType<typeof app.listen> | undefined;

// Graceful shutdown: drain connections, close resources, then exit.
// Registered at module scope so signals during startup are handled.
const shutdown = async () => {
	if (isShuttingDown) return;
	isShuttingDown = true;
	logger.info("Shutting down gracefully...");

	// Start forced-exit timer BEFORE async cleanup.
	const forceExit = setTimeout(() => {
		logger.error("Graceful shutdown timed out — forcing exit");
		process.exit(1);
	}, 5000);
	// Don't hold the process open just for the timer.
	forceExit.unref();

	if (!server) {
		logger.error("Signal received before server started — exiting immediately");
		process.exit(1);
	}

	// Shorten timeouts so idle sockets drain quickly.
	server.keepAliveTimeout = 1000;
	server.headersTimeout = 2000;

	// Drain realtime SSE connections BEFORE server.close() so the
	// callback can fire (server.close waits for all sockets to end,
	// and SSE sockets only end once shutdownRealtime() calls res.end()).
	try {
		await shutdownRealtime();
	} catch (err) {
		logger.error({ err }, "shutdownRealtime() failed");
	}

	server.close(async () => {
		stopBackgroundJobs();
		await pool.end();
		clearTimeout(forceExit);
		logger.info("Shutdown complete — exiting cleanly");
		process.exit(0);
	});
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const port = config.PORT;
server = app.listen(port, async () => {
	logger.info({ port }, "Camel Kanban API listening");

	// Configure server timeouts
	serverTimeout(server!, {
		timeout: 0, // no global socket timeout
		keepAliveTimeout: 65000,
		headersTimeout: 66000,
	});

	// Connect Redis, then upgrade the rate limiter to use it.
	await connectRedis();
	rateLimiterInstance = createAuthRateLimiter();

	await startBackgroundJobs();
});
