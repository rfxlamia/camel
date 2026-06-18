import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createAgentRouter } from "./agent/routes.js";
import { auth, createAuthRateLimiter } from "./auth.js";
import { connectRedis } from "./db/redis.js";
import { initRealtime } from "./realtime.js";
import { UPLOADS_DIR } from "./routes/settings.js";
import { api } from "./routes.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Rate limiting is applied after Redis connects (see boot sequence below).
// For now, register routes without rate limiting — it will be added lazily.
app.use("/api/auth", auth);
app.use("/api", api);
app.use("/api", createAgentRouter());

app.use(
	(
		err: Error,
		_req: express.Request,
		res: express.Response,
		_next: express.NextFunction,
	) => {
		console.error(err);
		res.status(500).json({ error: "internal server error" });
	},
);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, async () => {
	console.log(`Camel Kanban API listening on http://localhost:${port}`);

	// Boot sequence: connect Redis first, then init rate limiters and realtime.
	await connectRedis();

	// Apply IP-scoped rate limiting to auth routes after Redis is connected.
	// createAuthRateLimiter() returns a no-op middleware if Redis is unavailable (fail-open).
	const authRateLimiter = createAuthRateLimiter();
	auth.use(authRateLimiter);

	await initRealtime();
});
