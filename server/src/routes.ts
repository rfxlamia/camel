import { Router } from "express";
import { pool } from "./db/pool.js";
import { neighborsAt, positionBetween, rebalance, POSITION_GAP } from "./core/position.js";
import { checkWipLimit } from "./core/wip.js";
import { computeFlowMetrics } from "./core/metrics.js";

export const api = Router();

// ---- Board ----------------------------------------------------------------

api.get("/board", async (_req, res) => {
  const columns = await pool.query(
    `SELECT id, title, position, wip_limit, policy, is_done
     FROM columns ORDER BY position`,
  );
  const cards = await pool.query(
    `SELECT id, column_id, title, description, position, created_at, started_at, done_at
     FROM cards ORDER BY position`,
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
    "SELECT COUNT(*)::int AS n FROM cards WHERE column_id = $1",
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
     RETURNING id, column_id, title, description, position, created_at, started_at, done_at`,
    [Number(columnId), title.trim(), description ?? "", POSITION_GAP],
  );
  await pool.query(
    "INSERT INTO card_events (card_id, from_column_id, to_column_id) VALUES ($1, NULL, $2)",
    [rows[0].id, Number(columnId)],
  );
  res.status(201).json(rows[0]);
});

api.patch("/cards/:id", async (req, res) => {
  const { title, description } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE cards SET
       title = COALESCE($2, title),
       description = COALESCE($3, description)
     WHERE id = $1
     RETURNING id, column_id, title, description, position, created_at, started_at, done_at`,
    [Number(req.params.id), title ?? null, description ?? null],
  );
  if (rows.length === 0) return res.status(404).json({ error: "card not found" });
  res.json(rows[0]);
});

api.delete("/cards/:id", async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM cards WHERE id = $1", [
    Number(req.params.id),
  ]);
  if (rowCount === 0) return res.status(404).json({ error: "card not found" });
  res.status(204).end();
});

// ---- Move (the WIP-enforced core flow) --------------------------------------

api.post("/cards/:id/move", async (req, res) => {
  const cardId = Number(req.params.id);
  const { toColumnId, index } = req.body ?? {};
  if (!Number.isInteger(toColumnId) || !Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: "toColumnId and index are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cardRes = await client.query(
      "SELECT id, column_id, started_at, done_at FROM cards WHERE id = $1 FOR UPDATE",
      [cardId],
    );
    if (cardRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "card not found" });
    }
    const card = cardRes.rows[0];

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
       WHERE column_id = $1 AND id <> $2
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
         started_at = CASE
           WHEN started_at IS NULL AND ($4 OR NOT $5) THEN now()
           ELSE started_at
         END,
         done_at = CASE WHEN $4 THEN COALESCE(done_at, now()) ELSE NULL END
       WHERE id = $1`,
      [cardId, toColumnId, position, target.is_done, target.is_first],
    );

    if (!isSameColumn) {
      await client.query(
        "INSERT INTO card_events (card_id, from_column_id, to_column_id) VALUES ($1, $2, $3)",
        [cardId, card.column_id, toColumnId],
      );
    }

    await client.query("COMMIT");

    const updated = await pool.query(
      `SELECT id, column_id, title, description, position, created_at, started_at, done_at
       FROM cards WHERE id = $1`,
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
    "SELECT created_at, started_at, done_at FROM cards",
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
