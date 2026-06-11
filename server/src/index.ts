import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { auth } from "./auth.js";
import { connectRedis } from "./realtime.js";
import { api } from "./routes.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

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

const port = Number(process.env.PORT ?? 3001);
app.listen(port, async () => {
  console.log(`Camel Kanban API listening on http://localhost:${port}`);
  await connectRedis();
});
