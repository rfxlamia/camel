import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createAgentRouter } from "./agent/routes.js";
import {
	cleanupExpiredSessions,
	createAuthRateLimiter,
	createAuthRouter,
} from "./auth.js";
import { config } from "./config.js";
import { createOriginValidator } from "./core/cors.js";
import { connectRedis } from "./db/redis.js";
import {
	csrfProtection,
	generateCsrfToken,
	setCsrfToken,
} from "./middleware/csrf.js";
import { createErrorHandler } from "./middleware/error-handler.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { requestTimeout, serverTimeout } from "./middleware/timeout.js";
import { betterAuthHandler, createOAuthBridgeRouter } from "./oauth-bridge.js";
import { initRealtime, shutdownRealtime } from "./realtime.js";
import { oauthRouter } from "./routes/oauth.js";
import { UPLOADS_DIR } from "./routes/settings.js";
import { pool } from "./db/pool.js";
import { api } from "./routes.js";

const app = express();
// Trust the first proxy hop (reverse proxy / LB) so req.ip reflects the real client IP.
// Adjust the number if the deployment has more than one proxy hop.
// See: https://expressjs.com/en/guide/behind-proxies.html
app.set("trust proxy", 1);
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
	path.includes("/agent/") || path.endsWith("/events/stream");

app.use((req, res, next) => {
	if (!req.path.startsWith("/api/")) return next();
	if (isTimeoutExempt(req.path)) return next();
	return requestTimeout(30000)(req, res, next);
});

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

app.get("/health", (_req, res) => {
	if (isShuttingDown) return res.status(503).json({ status: "shutting_down" });
	res.json({ ok: true });
});

// CSRF token endpoint for client to retrieve the token
app.get("/api/csrf-token", (req, res) => {
	// Use the token from cookie (set by setCsrfToken middleware) or generate new one
	const token = req.cookies?.["csrf_token"] || generateCsrfToken();
	res.json({ csrfToken: token });
});

// Rate limiter starts as no-op; upgraded to Redis-backed after connectRedis().
let rateLimiterInstance: express.RequestHandler = (_req, _res, next) => next();
const delegatingLimiter: express.RequestHandler = (req, res, next) =>
	rateLimiterInstance(req, res, next);

// Mount routes before async boot so they're always available immediately.
app.use("/api/auth", createOAuthBridgeRouter()); // camel_session bridge
app.use("/api/auth", oauthRouter); // set-username, set-password (outside email gate)
app.use("/api/auth", createAuthRouter(delegatingLimiter));
app.use("/api", api);
app.use("/api", createAgentRouter());

app.use(createErrorHandler());

// Module-scope flag so health endpoint and shutdown handler share state.
let isShuttingDown = false;

const port = config.PORT;
const server = app.listen(port, async () => {
	console.log(`Camel Kanban API listening on http://localhost:${port}`);

	// Configure server timeouts
	serverTimeout(server, {
		timeout: 0, // no global socket timeout
		keepAliveTimeout: 65000,
		headersTimeout: 66000,
	});

	// Connect Redis, then upgrade the rate limiter to use it.
	await connectRedis();
	rateLimiterInstance = createAuthRateLimiter();

	await initRealtime();

	// Cleanup expired sessions on startup, then every 24 hours.
	await cleanupExpiredSessions();
	const cleanupInterval = setInterval(
		cleanupExpiredSessions,
		24 * 60 * 60 * 1000,
	);

	// Graceful shutdown: drain connections, close resources, then exit.
	const shutdown = () => {
		if (isShuttingDown) return;
		isShuttingDown = true;
		console.log("Shutting down gracefully...");

		// Start forced-exit timer BEFORE async cleanup.
		const forceExit = setTimeout(() => {
			console.error("Graceful shutdown timed out — forcing exit");
			process.exit(1);
		}, 5000);
		// Don't hold the process open just for the timer.
		forceExit.unref();

		// Shorten timeouts so idle sockets drain quickly.
		server.keepAliveTimeout = 1000;
		server.headersTimeout = 2000;

		server.close(async () => {
			clearInterval(cleanupInterval);
			await Promise.allSettled([shutdownRealtime(), pool.end()]);
			clearTimeout(forceExit);
			console.log("Shutdown complete — exiting cleanly");
			process.exit(0);
		});
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
});
