import { Router } from "express";
import { pool } from "./db/pool.js";
import { neighborsAt, positionBetween, rebalance, POSITION_GAP } from "./core/position.js";
import { checkWipLimit } from "./core/wip.js";
import { computeFlowMetrics, computeMetricsHistory } from "./core/metrics.js";
import { requireAuth, type AuthUser } from "./auth.js";
import {
  clearPresence,
  heartbeat,
  onlineUsers,
  publishEvent,
  sseHandler,
} from "./realtime.js";

export const api = Router();

api.use(requireAuth);

type Queryable = Pick<typeof pool, "query">;

async function recordActivity(
  db: Queryable,
  actor: AuthUser,
  eventType: "create" | "update" | "move" | "delete",
  opts: {
    cardId?: number | null;
    fromColumnId?: number | null;
    toColumnId?: number | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO card_events (card_id, from_column_id, to_column_id, actor_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      opts.cardId ?? null,
      opts.fromColumnId ?? null,
      opts.toColumnId ?? null,
      actor.id,
      eventType,
      JSON.stringify(opts.payload ?? {}),
    ],
  );
}

// ---- Board ----------------------------------------------------------------

api.get("/board", async (_req, res) => {
  const columns = await pool.query(
    `SELECT id, title, position, wip_limit, policy, is_done
     FROM columns ORDER BY position`,
  );
  const cards = await pool.query(
    `SELECT id, column_id, title, description, position, version, created_at, started_at, done_at
     FROM cards WHERE deleted_at IS NULL ORDER BY position`,
  );
  res.json({
    columns: columns.rows.map((col) => ({
      id: col.id,
      title: col.title,
      position: col.position,
      wipLimit: col.wip_limit,
      policy: col.policy,
      isDone: col.is_done,
      cards: cards.rows
        .filter((c) => c.column_id === col.id)
        .map((c) => ({
          id: c.id,
          columnId: c.column_id,
          title: c.title,
          description: c.description,
          position: c.position,
          version: c.version,
          createdAt: c.created_at,
          startedAt: c.started_at,
          doneAt: c.done_at,
        })),
    })),
  });
});

// ---- Columns ---------------------------------------------------------------

api.post("/columns", async (req, res) => {
  const { title } = req.body ?? {};
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "title is required" });
  }
  const { rows } = await pool.query(
    `INSERT INTO columns (title, position)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM columns), 0) + $2)
     RETURNING id, title, position, wip_limit, policy, is_done`,
    [title.trim(), POSITION_GAP],
  );
  res.status(201).json(rows[0]);
});

api.patch("/columns/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { title, wipLimit, policy } = req.body ?? {};
  if (wipLimit !== undefined && wipLimit !== null) {
    if (!Number.isInteger(wipLimit) || wipLimit < 1) {
      return res.status(400).json({ error: "wipLimit must be a positive integer or null" });
    }
  }
  const { rows } = await pool.query(
    `UPDATE columns SET
       title = COALESCE($2, title),
       wip_limit = CASE WHEN $3 THEN $4 ELSE wip_limit END,
       policy = COALESCE($5, policy)
     WHERE id = $1
     RETURNING id, title, position, wip_limit, policy, is_done`,
    [id, title ?? null, wipLimit !== undefined, wipLimit ?? null, policy ?? null],
  );
  if (rows.length === 0) return res.status(404).json({ error: "column not found" });
  await publishEvent({ type: "column.updated", actor: req.user! });
  res.json(rows[0]);
});

api.delete("/columns/:id", async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM columns WHERE id = $1", [
    Number(req.params.id),
  ]);
  if (rowCount === 0) return res.status(404).json({ error: "column not found" });
  res.status(204).end();
});

// ---- Cards -----------------------------------------------------------------

api.post("/cards", async (req, res) => {
  const { columnId, title, description } = req.body ?? {};
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "title is required" });
  }
  const col = await pool.query(
    "SELECT id, wip_limit FROM columns WHERE id = $1",
    [Number(columnId)],
  );
  if (col.rows.length === 0) {
    return res.status(404).json({ error: "column not found" });
  }
  const count = await pool.query(
    "SELECT COUNT(*)::int AS n FROM cards WHERE column_id = $1 AND deleted_at IS NULL",
    [Number(columnId)],
  );
  const wip = checkWipLimit({
    currentCount: count.rows[0].n,
    wipLimit: col.rows[0].wip_limit,
    isSameColumn: false,
  });
  if (!wip.allowed) {
    return res.status(409).json({ error: "WIP limit reached for this column" });
  }
  const { rows } = await pool.query(
    `INSERT INTO cards (column_id, title, description, position)
     VALUES ($1, $2, $3,
             COALESCE((SELECT MAX(position) FROM cards WHERE column_id = $1), 0) + $4)
     RETURNING id, column_id, title, description, position, version, created_at, started_at, done_at`,
    [Number(columnId), title.trim(), description ?? "", POSITION_GAP],
  );
  await recordActivity(pool, req.user!, "create", {
    cardId: rows[0].id,
    toColumnId: Number(columnId),
    payload: { cardTitle: rows[0].title },
  });
  await publishEvent({ type: "card.created", actor: req.user!, cardId: rows[0].id });
  res.status(201).json(rows[0]);
});

api.patch("/cards/:id", async (req, res) => {
  const { title, description, version } = req.body ?? {};
  const id = Number(req.params.id);
  if (version !== undefined && !Number.isInteger(version)) {
    return res.status(400).json({ error: "version must be an integer" });
  }
  const { rows } = await pool.query(
    `UPDATE cards SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       version = version + 1
     WHERE id = $1 AND deleted_at IS NULL AND ($4::int IS NULL OR version = $4)
     RETURNING id, column_id, title, description, position, version, created_at, started_at, done_at`,
    [id, title ?? null, description ?? null, version ?? null],
  );
  if (rows.length === 0) {
    const current = await pool.query(
      `SELECT id, column_id, title, description, position, version, created_at, started_at, done_at
       FROM cards WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: "card not found" });
    }
    return res.status(409).json({
      error: "Someone else updated this card first.",
      code: "version_conflict",
      card: current.rows[0],
    });
  }
  await recordActivity(pool, req.user!, "update", {
    cardId: id,
    payload: {
      cardTitle: rows[0].title,
      changed: [title != null && "title", description != null && "description"].filter(Boolean),
    },
  });
  await publishEvent({ type: "card.updated", actor: req.user!, cardId: id });
  res.json(rows[0]);
});

api.delete("/cards/:id", async (req, res) => {
  const id = Number(req.params.id);
  // Soft delete: mark the row, don't remove it. Keeps activity history and
  // the card_events FK intact; all read/flow queries filter deleted_at IS NULL.
  const { rows } = await pool.query(
    "UPDATE cards SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING title, column_id",
    [id],
  );
  if (rows.length === 0) return res.status(404).json({ error: "card not found" });
  await recordActivity(pool, req.user!, "delete", {
    fromColumnId: rows[0].column_id,
    payload: { cardTitle: rows[0].title },
  });
  await publishEvent({ type: "card.deleted", actor: req.user!, cardId: id });
  res.status(204).end();
});

// ---- Move (the WIP-enforced core flow) --------------------------------------

api.post("/cards/:id/move", async (req, res) => {
  const cardId = Number(req.params.id);
  const { toColumnId, index, version } = req.body ?? {};
  if (!Number.isInteger(toColumnId) || !Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: "toColumnId and index are required" });
  }
  if (version !== undefined && !Number.isInteger(version)) {
    return res.status(400).json({ error: "version must be an integer" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cardRes = await client.query(
      "SELECT id, column_id, title, version, started_at, done_at FROM cards WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [cardId],
    );
    if (cardRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "card not found" });
    }
    const card = cardRes.rows[0];

    if (version !== undefined && card.version !== version) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Someone else moved this card first.",
        code: "version_conflict",
      });
    }

    const colRes = await client.query(
      `SELECT id, wip_limit, is_done,
              (position = (SELECT MIN(position) FROM columns)) AS is_first
       FROM columns WHERE id = $1`,
      [toColumnId],
    );
    if (colRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "column not found" });
    }
    const target = colRes.rows[0];
    const isSameColumn = card.column_id === toColumnId;

    const siblingsRes = await client.query(
      `SELECT id, position FROM cards
       WHERE column_id = $1 AND id <> $2 AND deleted_at IS NULL
       ORDER BY position FOR UPDATE`,
      [toColumnId, cardId],
    );
    const siblings = siblingsRes.rows;

    const wip = checkWipLimit({
      currentCount: siblings.length,
      wipLimit: target.wip_limit,
      isSameColumn,
    });
    if (!wip.allowed) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "WIP limit reached for this column",
        reason: wip.reason,
      });
    }

    let position: number;
    try {
      const { before, after } = neighborsAt(
        siblings.map((s) => Number(s.position)),
        index,
      );
      position = positionBetween(before, after);
    } catch {
      // Neighbors too close to split — respace the whole column, then insert.
      const fresh = rebalance(siblings.length);
      for (let i = 0; i < siblings.length; i++) {
        await client.query("UPDATE cards SET position = $2 WHERE id = $1", [
          siblings[i].id,
          fresh[i],
        ]);
      }
      const { before, after } = neighborsAt(fresh, index);
      position = positionBetween(before, after);
    }

    await client.query(
      `UPDATE cards SET
         column_id = $2,
         position = $3,
         version = version + 1,
         started_at = CASE
           WHEN started_at IS NULL AND ($4 OR NOT $5) THEN now()
           ELSE started_at
         END,
         done_at = CASE WHEN $4 THEN COALESCE(done_at, now()) ELSE NULL END
       WHERE id = $1`,
      [cardId, toColumnId, position, target.is_done, target.is_first],
    );

    if (!isSameColumn) {
      await recordActivity(client, req.user!, "move", {
        cardId,
        fromColumnId: card.column_id,
        toColumnId,
        payload: { cardTitle: card.title },
      });
    }

    await client.query("COMMIT");

    if (!isSameColumn) {
      await publishEvent({ type: "card.moved", actor: req.user!, cardId });
    }

    const updated = await pool.query(
      `SELECT id, column_id, title, description, position, version, created_at, started_at, done_at
       FROM cards WHERE id = $1 AND deleted_at IS NULL`,
      [cardId],
    );
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// ---- Flow metrics (feedback loop) -------------------------------------------

api.get("/metrics", async (req, res) => {
  const windowDays = req.query.windowDays
    ? Number(req.query.windowDays)
    : undefined;
  const { rows } = await pool.query(
    "SELECT created_at, started_at, done_at FROM cards WHERE deleted_at IS NULL",
  );
  const metrics = computeFlowMetrics(
    rows.map((r) => ({
      createdAt: r.created_at,
      startedAt: r.started_at,
      doneAt: r.done_at,
    })),
    { windowDays },
  );
  res.json(metrics);
});

api.get("/metrics/history", async (req, res) => {
  const weeks = req.query.weeks ? Number(req.query.weeks) : undefined;
  if (weeks !== undefined && (!Number.isInteger(weeks) || weeks < 1 || weeks > 26)) {
    return res.status(400).json({ error: "weeks must be an integer between 1 and 26" });
  }
  const { rows } = await pool.query(
    "SELECT created_at, started_at, done_at FROM cards WHERE deleted_at IS NULL",
  );
  const history = computeMetricsHistory(
    rows.map((r) => ({
      createdAt: r.created_at,
      startedAt: r.started_at,
      doneAt: r.done_at,
    })),
    { weeks },
  );
  res.json({ weeks: history });
});

// ---- Activity feed -----------------------------------------------------------

const ACTIVITY_SELECT = `
  SELECT e.id, e.event_type, e.payload, e.created_at, e.card_id,
         u.username, u.display_name,
         c.title AS current_card_title,
         fc.title AS from_column_title,
         tc.title AS to_column_title
  FROM card_events e
  LEFT JOIN users u ON u.id = e.actor_id
  LEFT JOIN cards c ON c.id = e.card_id AND c.deleted_at IS NULL
  LEFT JOIN columns fc ON fc.id = e.from_column_id
  LEFT JOIN columns tc ON tc.id = e.to_column_id`;

function toActivityEvent(e: {
  id: number;
  event_type: string;
  payload: { cardTitle?: string } | null;
  created_at: Date;
  card_id: number | null;
  username: string | null;
  display_name: string | null;
  current_card_title: string | null;
  from_column_title: string | null;
  to_column_title: string | null;
}) {
  return {
    id: e.id,
    type: e.event_type,
    cardId: e.card_id,
    cardTitle: e.current_card_title ?? e.payload?.cardTitle ?? null,
    fromColumn: e.from_column_title,
    toColumn: e.to_column_title,
    actor: e.username
      ? { username: e.username, displayName: e.display_name }
      : null,
    createdAt: e.created_at,
  };
}

api.get("/activity", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await pool.query(
    `${ACTIVITY_SELECT}
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $1`,
    [limit],
  );
  res.json({ events: rows.map(toActivityEvent) });
});

// Per-card history for the context panel. All rows, newest first (no
// pagination this cycle); uses idx_events_card.
api.get("/cards/:id/activity", async (req, res) => {
  const cardId = Number(req.params.id);
  if (!Number.isInteger(cardId)) {
    return res.status(400).json({ error: "card id must be an integer" });
  }
  const { rows } = await pool.query(
    `${ACTIVITY_SELECT}
     WHERE e.card_id = $1
     ORDER BY e.created_at DESC, e.id DESC`,
    [cardId],
  );
  res.json({ events: rows.map(toActivityEvent) });
});

// ---- Presence (Redis TTL heartbeat) -------------------------------------------

api.post("/presence/heartbeat", async (req, res) => {
  await heartbeat(req.user!);
  res.json({ ok: true });
});

api.get("/presence", async (req, res) => {
  res.json({ users: await onlineUsers(req.user!) });
});

api.delete("/presence", async (req, res) => {
  await clearPresence(req.user!.id);
  res.status(204).end();
});

// ---- Real-time stream (Redis Pub/Sub -> SSE) ----------------------------------

api.get("/events/stream", sseHandler);
