import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "./db/pool.js";

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const SESSION_COOKIE = "camel_session";
const SESSION_TTL_DAYS = 30;
const BCRYPT_ROUNDS = 10;

const USERNAME_RE = /^[a-z0-9_]{3,32}$/i;

function toUser(row: { id: number; username: string; display_name: string }): AuthUser {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

async function createSession(res: Response, userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
    [token, userId, expiresAt],
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return res.status(401).json({ error: "authentication required" });
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token],
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "session expired — sign in again" });
    }
    req.user = toUser(rows[0]);
    next();
  } catch (err) {
    next(err);
  }
}

export const auth = Router();

auth.post("/register", async (req, res) => {
  const { username, password, displayName } = req.body ?? {};
  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return res.status(400).json({
      error: "Username must be 3-32 characters: letters, numbers, underscore.",
    });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const name =
    typeof displayName === "string" && displayName.trim() !== ""
      ? displayName.trim()
      : username;

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, display_name`,
      [username.toLowerCase(), name, hash],
    );
    await createSession(res, rows[0].id);
    res.status(201).json({ user: toUser(rows[0]) });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "That username's already taken — try another." });
    }
    throw err;
  }
});

auth.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password are required." });
  }
  const { rows } = await pool.query(
    "SELECT id, username, display_name, password_hash FROM users WHERE username = $1",
    [username.toLowerCase()],
  );
  const ok = rows.length > 0 && (await bcrypt.compare(password, rows[0].password_hash));
  if (!ok) {
    return res.status(401).json({ error: "Wrong username or password — try again." });
  }
  await createSession(res, rows[0].id);
  res.json({ user: toUser(rows[0]) });
});

auth.post("/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

auth.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
