import cookieParser from "cookie-parser";
import { config } from "./config.js";
import cors from "cors";
import express from "express";
import { createOriginValidator } from "./core/cors.js";
import { createAgentRouter } from "./agent/routes.js";
import {
	createAuthRouter,
	createAuthRateLimiter,
	cleanupExpiredSessions,
} from "./auth.js";
import { connectRedis } from "./db/redis.js";
import { initRealtime } from "./realtime.js";
import { UPLOADS_DIR } from "./routes/settings.js";
import { api } from "./routes.js";
import {
	csrfProtection,
	setCsrfToken,
	generateCsrfToken,
} from "./middleware/csrf.js";
import { createErrorHandler } from "./middleware/error-handler.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { requestTimeout, serverTimeout } from "./middleware/timeout.js";

const app = express();
app.use(securityHeaders());
app.use(cors({ origin: createOriginValidator(), credentials: true }));
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
	if (req.path.startsWith("/api/auth/")) return next();
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

app.get("/health", (_req, res) => res.json({ ok: true }));

// CSRF token endpoint for client to retrieve the token
app.get("/api/csrf-token", (req, res) => {
	const token = req.cookies?.csrf_token || generateCsrfToken();
	res.json({ csrfToken: token });
});

// Rate limiter starts as no-op; upgraded to Redis-backed after connectRedis().
let rateLimiterInstance: express.RequestHandler = (_req, _res, next) => next();
const delegatingLimiter: express.RequestHandler = (req, res, next) =>
	rateLimiterInstance(req, res, next);

// Mount routes before async boot so they're always available immediately.
app.use("/api/auth", createAuthRouter(delegatingLimiter));
app.use("/api", api);
app.use("/api", createAgentRouter());

app.use(createErrorHandler());

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

	// Graceful shutdown: clear the interval so the process can exit cleanly.
	const shutdown = () => {
		clearInterval(cleanupInterval);
		process.exit(0);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
});
