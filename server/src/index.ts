import cookieParser from "cookie-parser";
import { config } from "./config.js";
import cors from "cors";
import express from "express";
import { createAgentRouter } from "./agent/routes.js";
import { auth } from "./auth.js";
import { connectRedis } from "./realtime.js";
import { UPLOADS_DIR } from "./routes/settings.js";
import { api } from "./routes.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/health", (_req, res) => res.json({ ok: true }));
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

const port = config.PORT;
app.listen(port, async () => {
	console.log(`Camel Kanban API listening on http://localhost:${port}`);
	await connectRedis();
});
