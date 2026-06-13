import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { pathToFileURL } from "node:url";
import { auth } from "./auth.js";
import { connectRedis } from "./realtime.js";
import { api } from "./routes.js";
import { UPLOADS_DIR } from "./routes/settings.js";

export const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", auth);
app.use("/api", api);

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

export function startServer(port = Number(process.env.PORT ?? 3001)) {
  return app.listen(port, async () => {
    console.log(`Camel Kanban API listening on http://localhost:${port}`);
    await connectRedis();
  });
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  startServer();
}
