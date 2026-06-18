import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createOriginValidator } from "./core/cors.js";
import { createAgentRouter } from "./agent/routes.js";
import { createAuthRouter, createAuthRateLimiter } from "./auth.js";
import { connectRedis } from "./db/redis.js";
import { initRealtime } from "./realtime.js";
import { UPLOADS_DIR } from "./routes/settings.js";
import { api } from "./routes.js";

const app = express();
app.use(cors({ origin: createOriginValidator(), credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, async () => {
	console.log(`Camel Kanban API listening on http://localhost:${port}`);

	// Boot sequence: connect Redis first, then init rate limiters and realtime.
	await connectRedis();

	// Create auth router with rate limiter applied before routes.
	const authRateLimiter = createAuthRateLimiter();
	const auth = createAuthRouter(authRateLimiter);

	// Mount routes
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

	await initRealtime();
});
