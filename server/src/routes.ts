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
import { settingsRouter } from "./routes/settings.js";
import {
  cardCreateBodySchema,
  cardMoveBodySchema,
  cardUpdateBodySchema,
  validateRequestBody,
} from "./validation.js";

export const WORKSPACE_LIMIT = 10;
export const CAP_ERROR_MESSAGE = `You've reached the workspace limit (${WORKSPACE_LIMIT}).`;

export type WorkspaceCapacity =
  | { ok: true }
  | { ok: false; status: 409; error: string };

export function getWorkspaceCapacity(membershipCount: number): WorkspaceCapacity {
  if (membershipCount >= WORKSPACE_LIMIT) {
    return { ok: false, status: 409, error: CAP_ERROR_MESSAGE };
  }
  return { ok: true };
}

export function serializeWorkspaceList(input: {
  workspaces: Array<{
    id: number;
    name: string;
    role: string;
    isPersonal: boolean;
    memberCount?: number;
  }>;
  invites: Array<{ id: number; workspaceId: number; workspaceName: string; role: string }>;
}) {
  return {
    workspaces: input.workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      role: ws.role,
      isPersonal: ws.isPersonal,
      ...(ws.memberCount !== undefined ? { memberCount: ws.memberCount } : {}),
    })),
    pendingInvites: input.invites.map((inv) => ({
      id: inv.id,
      workspaceId: inv.workspaceId,
      workspaceName: inv.workspaceName,
      role: inv.role,
    })),
  };
}

export type AuthCheck =
  | { allowed: true }
  | { allowed: false; status: number; error: string };

export function checkActorCanManage(role: string): AuthCheck {
  if (role === "admin" || role === "owner") return { allowed: true };
  return { allowed: false, status: 404, error: "Not found" };
}

export function checkCanRemoveUser(_actorRole: string, targetRole: string): AuthCheck {
  if (targetRole === "owner") {
    return { allowed: false, status: 403, error: "Cannot remove workspace owner" };
  }
  return { allowed: true };
}

export function checkInviteeCap(membershipCount: number): WorkspaceCapacity {
  return getWorkspaceCapacity(membershipCount);
}

async function countUserMemberships(userId: number): Promise<number> {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM workspace_members WHERE user_id = $1",
    [userId],
  );
  return rows[0].n;
}

async function lookupMembership(
  userId: number,
  workspaceId: number,
): Promise<string | undefined> {
  const { rows } = await pool.query(
    "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, userId],
  );
  return rows[0]?.role as string | undefined;
}

function parseWorkspaceId(raw: string): number | null {
  const workspaceId = Number(raw);
  return Number.isInteger(workspaceId) ? workspaceId : null;
}

export type ScopedBoardDeps = {
  getMembership: (
    workspaceId: number,
    userId: number,
  ) => Promise<{ role: string } | null>;
  getCardById: (
    workspaceId: number,
    cardId: number,
  ) => Promise<{ id: number; workspaceId: number; title: string } | null>;
  getBoardRows: (workspaceId: number) => Promise<
    Array<{
      id: number;
      workspaceId: number;
      title: string;
      cards: Array<{ id: number; workspaceId: number; title: string }>;
    }>
  >;
  getActivityRows: (
    workspaceId: number,
  ) => Promise<Array<{ id: number; workspaceId: number; cardTitle: string }>>;
};

export function createScopedBoardService(deps: ScopedBoardDeps) {
  return {
    async getCard({
      userId,
      workspaceId,
      cardId,
    }: {
      userId: number;
      workspaceId: number;
      cardId: number;
    }) {
      const membership = await deps.getMembership(workspaceId, userId);
      if (!membership) return { status: 404 as const, error: "Not found" };

      const card = await deps.getCardById(workspaceId, cardId);
      if (!card || card.workspaceId !== workspaceId) {
        return { status: 404 as const, error: "Not found" };
      }
      return card;
    },

    async getBoard({
      userId,
      workspaceId,
    }: {
      userId: number;
      workspaceId: number;
    }) {
      const membership = await deps.getMembership(workspaceId, userId);
      if (!membership) return { status: 404 as const, error: "Not found" };

      const columns = await deps.getBoardRows(workspaceId);
      const activity = await deps.getActivityRows(workspaceId);
      return { columns, activity };
    },
  };
}

export type WorkspaceAccessDeps = {
  getActorMembership: (
    workspaceId: number,
    actorId: number,
  ) => Promise<{ userId: number; role: string } | null>;
  getWorkspace: (workspaceId: number) => Promise<{ id: number; name: string } | null>;
  getTargetMembership: (
    workspaceId: number,
    userId: number,
  ) => Promise<{ userId: number; role: string } | null>;
  removeMember: (
    workspaceId: number,
    userId: number,
  ) => Promise<{ userId: number; username: string }>;
  publishEvent: (
    workspaceId: number,
    event: {
      type: "membership.removed";
      userId: number;
      workspaceId: number;
      workspaceName: string;
    },
  ) => Promise<void>;
  clearPresence: (workspaceId: number, userId: number) => Promise<void>;
};

export function createWorkspaceAccessService(deps: WorkspaceAccessDeps) {
  return {
    async removeMember({
      actorId,
      workspaceId,
      userId,
    }: {
      actorId: number;
      workspaceId: number;
      userId: number;
    }) {
      const actorMembership = await deps.getActorMembership(workspaceId, actorId);
      if (!actorMembership) return { status: 404 as const, error: "Not found" };

      const manage = checkActorCanManage(actorMembership.role);
      if (!manage.allowed) {
        return { status: manage.status, error: manage.error };
      }

      const targetMembership = await deps.getTargetMembership(workspaceId, userId);
      if (!targetMembership) return { status: 404 as const, error: "Not found" };

      const canRemove = checkCanRemoveUser(actorMembership.role, targetMembership.role);
      if (!canRemove.allowed) {
        return { status: canRemove.status, error: canRemove.error };
      }

      const workspace = await deps.getWorkspace(workspaceId);
      if (!workspace) return { status: 404 as const, error: "Not found" };

      const removed = await deps.removeMember(workspaceId, userId);
      await deps.clearPresence(workspaceId, userId);
      await deps.publishEvent(workspaceId, {
        type: "membership.removed",
        userId: removed.userId,
        workspaceId,
        workspaceName: workspace.name,
      });
      return { status: 204 as const };
    },
  };
}

const workspaceAccessService = createWorkspaceAccessService({
  getActorMembership: async (workspaceId, actorId) => {
    const role = await lookupMembership(actorId, workspaceId);
    return role ? { userId: actorId, role } : null;
  },
  getWorkspace: async (workspaceId) => {
    const { rows } = await pool.query(
      "SELECT id, name FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    return rows[0] ? { id: rows[0].id as number, name: rows[0].name as string } : null;
  },
  getTargetMembership: async (workspaceId, userId) => {
    const role = await lookupMembership(userId, workspaceId);
    return role ? { userId, role } : null;
  },
  removeMember: async (workspaceId, userId) => {
    const { rows } = await pool.query(
      `DELETE FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2
       RETURNING user_id`,
      [workspaceId, userId],
    );
    const { rows: userRows } = await pool.query(
      "SELECT username FROM users WHERE id = $1",
      [rows[0].user_id],
    );
    return { userId: rows[0].user_id as number, username: userRows[0].username as string };
  },
  publishEvent,
  clearPresence,
});

export const api = Router();

api.use(requireAuth);

// ---- Workspaces --------------------------------------------------------------

api.get("/workspaces", async (req, res) => {
  const userId = req.user!.id;
  const username = req.user!.username;

  const wsRes = await pool.query(
    `SELECT w.id, w.name, w.is_personal, wm.role,
            (SELECT COUNT(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count
     FROM workspace_members wm
     JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1
     ORDER BY w.name`,
    [userId],
  );

  const invRes = await pool.query(
    `SELECT wi.id, wi.workspace_id, w.name AS workspace_name, wi.role
     FROM workspace_invites wi
     JOIN workspaces w ON w.id = wi.workspace_id
     WHERE wi.username = $1
     ORDER BY wi.created_at`,
    [username],
  );

  res.json(
    serializeWorkspaceList({
      workspaces: wsRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        isPersonal: row.is_personal,
        memberCount: row.member_count,
      })),
      invites: invRes.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        role: row.role,
      })),
    }),
  );
});

api.post("/workspaces", async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }

  const membershipCount = await countUserMemberships(req.user!.id);
  const cap = getWorkspaceCapacity(membershipCount);
  if (!cap.ok) {
    return res.status(cap.status).json({ error: cap.error });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const wsRes = await client.query(
      `INSERT INTO workspaces (name, owner_user_id, is_personal)
       VALUES ($1, $2, false)
       RETURNING id, name, is_personal`,
      [name.trim(), req.user!.id],
    );
    const ws = wsRes.rows[0];
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [ws.id, req.user!.id],
    );
    await client.query("COMMIT");

    res.status(201).json({
      id: ws.id,
      name: ws.name,
      role: "owner",
      isPersonal: ws.is_personal,
      memberCount: 1,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

api.get("/workspaces/:workspaceId/members", async (req, res) => {
  const workspaceId = Number(req.params.workspaceId);
  if (!Number.isInteger(workspaceId)) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.username, u.display_name, wm.role
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY wm.role, u.username`,
    [workspaceId],
  );

  res.json({
    members: rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    })),
  });
});

api.post("/workspaces/:workspaceId/members", async (req, res) => {
  const workspaceId = Number(req.params.workspaceId);
  if (!Number.isInteger(workspaceId)) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const actorRole = await lookupMembership(req.user!.id, workspaceId);
  if (!actorRole) return res.status(404).json({ error: "Not found" });

  const manage = checkActorCanManage(actorRole);
  if (!manage.allowed) {
    return res.status(manage.status).json({ error: manage.error });
  }

  const { username, role: inviteRole } = req.body ?? {};
  if (typeof username !== "string" || username.trim() === "") {
    return res.status(400).json({ error: "username is required" });
  }
  const memberRole =
    inviteRole === "admin" || inviteRole === "member" ? inviteRole : "member";

  const normalizedUsername = username.trim().toLowerCase();
  const targetRes = await pool.query(
    "SELECT id, username, display_name FROM users WHERE username = $1",
    [normalizedUsername],
  );

  if (targetRes.rows.length > 0) {
    const target = targetRes.rows[0];
    const existing = await lookupMembership(target.id, workspaceId);
    if (existing) {
      return res.status(409).json({ error: "User is already a member of this workspace" });
    }

    const inviteeCount = await countUserMemberships(target.id);
    const cap = checkInviteeCap(inviteeCount);
    if (!cap.ok) {
      return res.status(cap.status).json({ error: cap.error });
    }

    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [workspaceId, target.id, memberRole],
    );

    return res.status(201).json({
      userId: target.id,
      username: target.username,
      displayName: target.display_name,
      role: memberRole,
    });
  }

  const dupInvite = await pool.query(
    "SELECT id FROM workspace_invites WHERE workspace_id = $1 AND username = $2",
    [workspaceId, normalizedUsername],
  );
  if (dupInvite.rows.length > 0) {
    return res.status(409).json({ error: "Invite already pending for this username" });
  }

  const invRes = await pool.query(
    `INSERT INTO workspace_invites (workspace_id, username, role, invited_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, workspace_id, username, role`,
    [workspaceId, normalizedUsername, memberRole, req.user!.id],
  );
  const inv = invRes.rows[0];

  res.status(201).json({
    id: inv.id,
    workspaceId: inv.workspace_id,
    username: inv.username,
    role: inv.role,
    pending: true,
  });
});

api.delete("/workspaces/:workspaceId/members/:userId", async (req, res) => {
  const workspaceId = Number(req.params.workspaceId);
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(workspaceId) || !Number.isInteger(targetUserId)) {
    return res.status(400).json({ error: "workspaceId and userId must be integers" });
  }

  const result = await workspaceAccessService.removeMember({
    actorId: req.user!.id,
    workspaceId,
    userId: targetUserId,
  });
  if (result.status !== 204) {
    return res.status(result.status).json({ error: result.error });
  }
  res.status(204).end();
});

api.post("/workspaces/:workspaceId/invites/:inviteId/accept", async (req, res) => {
  const workspaceId = Number(req.params.workspaceId);
  const inviteId = Number(req.params.inviteId);
  if (!Number.isInteger(workspaceId) || !Number.isInteger(inviteId)) {
    return res.status(400).json({ error: "workspaceId and inviteId must be integers" });
  }

  const invRes = await pool.query(
    `SELECT id, workspace_id, username, role
     FROM workspace_invites
     WHERE id = $1 AND workspace_id = $2 AND username = $3`,
    [inviteId, workspaceId, req.user!.username],
  );
  if (invRes.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }
  const invite = invRes.rows[0];

  const existing = await lookupMembership(req.user!.id, workspaceId);
  if (existing) {
    return res.status(409).json({ error: "Already a member of this workspace" });
  }

  const membershipCount = await countUserMemberships(req.user!.id);
  const cap = checkInviteeCap(membershipCount);
  if (!cap.ok) {
    return res.status(cap.status).json({ error: cap.error });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [workspaceId, req.user!.id, invite.role],
    );
    await client.query("DELETE FROM workspace_invites WHERE id = $1", [inviteId]);
    await client.query("COMMIT");

    const wsRes = await client.query(
      "SELECT id, name, is_personal FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    const ws = wsRes.rows[0];

    res.json({
      id: ws.id,
      name: ws.name,
      role: invite.role,
      isPersonal: ws.is_personal,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

api.delete("/workspaces/:workspaceId/invites/:inviteId", async (req, res) => {
  const workspaceId = Number(req.params.workspaceId);
  const inviteId = Number(req.params.inviteId);
  if (!Number.isInteger(workspaceId) || !Number.isInteger(inviteId)) {
    return res.status(400).json({ error: "workspaceId and inviteId must be integers" });
  }

  const { rowCount } = await pool.query(
    `DELETE FROM workspace_invites
     WHERE id = $1 AND workspace_id = $2 AND username = $3`,
    [inviteId, workspaceId, req.user!.username],
  );
  if (rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

api.post("/workspaces/:workspaceId/transfer-ownership", async (req, res) => {
  const workspaceId = Number(req.params.workspaceId);
  if (!Number.isInteger(workspaceId)) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const actorRole = await lookupMembership(req.user!.id, workspaceId);
  if (!actorRole || actorRole !== "owner") {
    return res.status(404).json({ error: "Not found" });
  }

  const { newOwnerId, previousOwnerRole } = req.body ?? {};
  if (!Number.isInteger(newOwnerId)) {
    return res.status(400).json({ error: "newOwnerId is required" });
  }
  if (newOwnerId === req.user!.id) {
    return res.status(400).json({ error: "Cannot transfer ownership to yourself" });
  }
  const demotedRole =
    previousOwnerRole === "admin" || previousOwnerRole === "member"
      ? previousOwnerRole
      : "admin";

  const newOwnerRole = await lookupMembership(newOwnerId, workspaceId);
  if (!newOwnerRole) {
    return res.status(404).json({ error: "Not found" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE workspace_members SET role = 'owner'
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, newOwnerId],
    );
    await client.query(
      `UPDATE workspace_members SET role = $3
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, req.user!.id, demotedRole],
    );
    await client.query(
      "UPDATE workspaces SET owner_user_id = $2 WHERE id = $1",
      [workspaceId, newOwnerId],
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

api.delete("/workspaces/:workspaceId", async (req, res) => {
  const workspaceId = Number(req.params.workspaceId);
  if (!Number.isInteger(workspaceId)) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const actorRole = await lookupMembership(req.user!.id, workspaceId);
  if (!actorRole) return res.status(404).json({ error: "Not found" });
  if (actorRole !== "owner") return res.status(404).json({ error: "Not found" });

  const wsRes = await pool.query(
    "SELECT is_personal FROM workspaces WHERE id = $1",
    [workspaceId],
  );
  if (wsRes.rows.length === 0) return res.status(404).json({ error: "Not found" });
  if (wsRes.rows[0].is_personal) {
    return res.status(403).json({ error: "Personal workspaces cannot be deleted" });
  }

  const countRes = await pool.query(
    "SELECT COUNT(*)::int AS n FROM workspace_members WHERE workspace_id = $1",
    [workspaceId],
  );
  if (countRes.rows[0].n > 1) {
    return res.status(409).json({
      error: "Remove all other members before deleting this workspace",
    });
  }

  await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
  res.status(204).end();
});

api.use("/workspaces/:workspaceId/settings", settingsRouter);

type Queryable = Pick<typeof pool, "query">;

async function recordActivity(
  db: Queryable,
  actor: AuthUser,
  workspaceId: number,
  eventType: "create" | "update" | "move" | "delete",
  opts: {
    cardId?: number | null;
    fromColumnId?: number | null;
    toColumnId?: number | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO card_events (card_id, from_column_id, to_column_id, actor_id, event_type, payload, workspace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      opts.cardId ?? null,
      opts.fromColumnId ?? null,
      opts.toColumnId ?? null,
      actor.id,
      eventType,
      JSON.stringify(opts.payload ?? {}),
      workspaceId,
    ],
  );
}

// ---- Board (workspace-scoped) -----------------------------------------------

api.get("/workspaces/:workspaceId/board", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const columns = await pool.query(
    `SELECT id, title, position, wip_limit, policy, is_done
     FROM columns WHERE workspace_id = $1 ORDER BY position`,
    [workspaceId],
  );
  const cards = await pool.query(
    `SELECT id, column_id, title, description, position, version, created_at, started_at, done_at
     FROM cards WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY position`,
    [workspaceId],
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

api.post("/workspaces/:workspaceId/columns", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const { title } = req.body ?? {};
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "title is required" });
  }
  const { rows } = await pool.query(
    `INSERT INTO columns (title, position, workspace_id)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM columns WHERE workspace_id = $2), 0) + $3, $2)
     RETURNING id, title, position, wip_limit, policy, is_done`,
    [title.trim(), workspaceId, POSITION_GAP],
  );
  await publishEvent(workspaceId, { type: "column.created", actor: req.user! });
  res.status(201).json(rows[0]);
});

api.patch("/workspaces/:workspaceId/columns/:id", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

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
     WHERE id = $1 AND workspace_id = $6
     RETURNING id, title, position, wip_limit, policy, is_done`,
    [id, title ?? null, wipLimit !== undefined, wipLimit ?? null, policy ?? null, workspaceId],
  );
  if (rows.length === 0) return res.status(404).json({ error: "column not found" });
  await publishEvent(workspaceId, { type: "column.updated", actor: req.user! });
  res.json(rows[0]);
});

api.delete("/workspaces/:workspaceId/columns/:id", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const { rowCount } = await pool.query(
    "DELETE FROM columns WHERE id = $1 AND workspace_id = $2",
    [Number(req.params.id), workspaceId],
  );
  if (rowCount === 0) return res.status(404).json({ error: "column not found" });
  res.status(204).end();
});

// ---- Cards -----------------------------------------------------------------

api.get("/workspaces/:workspaceId/cards/:id", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const cardId = Number(req.params.id);
  const result = await createScopedBoardService({
    getMembership: async (wsId, userId) => {
      const r = await lookupMembership(userId, wsId);
      return r ? { role: r } : null;
    },
    getCardById: async (wsId, cId) => {
      const { rows } = await pool.query(
        `SELECT id, workspace_id, column_id, title, description, position, version,
                created_at, started_at, done_at
         FROM cards WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [cId, wsId],
      );
      if (rows.length === 0) return null;
      const c = rows[0];
      return {
        id: c.id,
        workspaceId: c.workspace_id,
        title: c.title,
        columnId: c.column_id,
        description: c.description,
        position: c.position,
        version: c.version,
        createdAt: c.created_at,
        startedAt: c.started_at,
        doneAt: c.done_at,
      };
    },
    getBoardRows: async () => [],
    getActivityRows: async () => [],
  }).getCard({ userId: req.user!.id, workspaceId, cardId });

  if ("status" in result) {
    return res.status(result.status).json({ error: result.error });
  }
  res.json(result);
});

api.post("/workspaces/:workspaceId/cards", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const body = validateRequestBody(cardCreateBodySchema, req.body);
  if (!body.ok) {
    return res.status(body.status).json(body.body);
  }
  const { columnId, title, description } = body.data;

  const col = await pool.query(
    "SELECT id, wip_limit FROM columns WHERE id = $1 AND workspace_id = $2",
    [columnId, workspaceId],
  );
  if (col.rows.length === 0) {
    return res.status(404).json({ error: "column not found" });
  }
  const count = await pool.query(
    "SELECT COUNT(*)::int AS n FROM cards WHERE column_id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
    [columnId, workspaceId],
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
    `INSERT INTO cards (column_id, title, description, position, workspace_id)
     VALUES ($1, $2, $3,
             COALESCE((SELECT MAX(position) FROM cards WHERE column_id = $1), 0) + $4,
             $5)
     RETURNING id, column_id, title, description, position, version, created_at, started_at, done_at`,
    [columnId, title, description, POSITION_GAP, workspaceId],
  );
  await recordActivity(pool, req.user!, workspaceId, "create", {
    cardId: rows[0].id,
    toColumnId: columnId,
    payload: { cardTitle: rows[0].title },
  });
  await publishEvent(workspaceId, { type: "card.created", actor: req.user!, cardId: rows[0].id });
  res.status(201).json(rows[0]);
});

api.patch("/workspaces/:workspaceId/cards/:id", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const body = validateRequestBody(cardUpdateBodySchema, req.body);
  if (!body.ok) {
    return res.status(body.status).json(body.body);
  }
  const { title, description, version } = body.data;

  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `UPDATE cards SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       version = version + 1
     WHERE id = $1 AND workspace_id = $4 AND deleted_at IS NULL AND ($5::int IS NULL OR version = $5)
     RETURNING id, column_id, title, description, position, version, created_at, started_at, done_at`,
    [id, title ?? null, description ?? null, workspaceId, version ?? null],
  );
  if (rows.length === 0) {
    const current = await pool.query(
      `SELECT id, column_id, title, description, position, version, created_at, started_at, done_at
       FROM cards WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, workspaceId],
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
  await recordActivity(pool, req.user!, workspaceId, "update", {
    cardId: id,
    payload: {
      cardTitle: rows[0].title,
      changed: [title != null && "title", description != null && "description"].filter(Boolean),
    },
  });
  await publishEvent(workspaceId, { type: "card.updated", actor: req.user!, cardId: id });
  res.json(rows[0]);
});

api.delete("/workspaces/:workspaceId/cards/:id", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const id = Number(req.params.id);
  const { rows } = await pool.query(
    "UPDATE cards SET deleted_at = now() WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL RETURNING title, column_id",
    [id, workspaceId],
  );
  if (rows.length === 0) return res.status(404).json({ error: "card not found" });
  await recordActivity(pool, req.user!, workspaceId, "delete", {
    fromColumnId: rows[0].column_id,
    payload: { cardTitle: rows[0].title },
  });
  await publishEvent(workspaceId, { type: "card.deleted", actor: req.user!, cardId: id });
  res.status(204).end();
});

// ---- Move (the WIP-enforced core flow) --------------------------------------

api.post("/workspaces/:workspaceId/cards/:id/move", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const cardId = Number(req.params.id);
  const body = validateRequestBody(cardMoveBodySchema, req.body);
  if (!body.ok) {
    return res.status(body.status).json(body.body);
  }
  const { toColumnId, index, version } = body.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cardRes = await client.query(
      "SELECT id, column_id, title, version, started_at, done_at FROM cards WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR UPDATE",
      [cardId, workspaceId],
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
              (position = (SELECT MIN(position) FROM columns WHERE workspace_id = $2)) AS is_first
       FROM columns WHERE id = $1 AND workspace_id = $2`,
      [toColumnId, workspaceId],
    );
    if (colRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "column not found" });
    }
    const target = colRes.rows[0];
    const isSameColumn = card.column_id === toColumnId;

    const siblingsRes = await client.query(
      `SELECT id, position FROM cards
       WHERE column_id = $1 AND workspace_id = $2 AND id <> $3 AND deleted_at IS NULL
       ORDER BY position FOR UPDATE`,
      [toColumnId, workspaceId, cardId],
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
      await recordActivity(client, req.user!, workspaceId, "move", {
        cardId,
        fromColumnId: card.column_id,
        toColumnId,
        payload: { cardTitle: card.title },
      });
    }

    await client.query("COMMIT");

    if (!isSameColumn) {
      await publishEvent(workspaceId, { type: "card.moved", actor: req.user!, cardId });
    }

    const updated = await pool.query(
      `SELECT id, column_id, title, description, position, version, created_at, started_at, done_at
       FROM cards WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [cardId, workspaceId],
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

api.get("/workspaces/:workspaceId/metrics", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const windowDays = req.query.windowDays
    ? Number(req.query.windowDays)
    : undefined;
  const { rows } = await pool.query(
    "SELECT created_at, started_at, done_at FROM cards WHERE workspace_id = $1 AND deleted_at IS NULL",
    [workspaceId],
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

api.get("/workspaces/:workspaceId/metrics/history", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const weeks = req.query.weeks ? Number(req.query.weeks) : undefined;
  if (weeks !== undefined && (!Number.isInteger(weeks) || weeks < 1 || weeks > 26)) {
    return res.status(400).json({ error: "weeks must be an integer between 1 and 26" });
  }
  const { rows } = await pool.query(
    "SELECT created_at, started_at, done_at FROM cards WHERE workspace_id = $1 AND deleted_at IS NULL",
    [workspaceId],
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

api.get("/workspaces/:workspaceId/activity", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await pool.query(
    `${ACTIVITY_SELECT}
     WHERE e.workspace_id = $1
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $2`,
    [workspaceId, limit],
  );
  res.json({ events: rows.map(toActivityEvent) });
});

api.get("/workspaces/:workspaceId/cards/:id/activity", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  const cardId = Number(req.params.id);
  if (!Number.isInteger(cardId)) {
    return res.status(400).json({ error: "card id must be an integer" });
  }

  const cardCheck = await pool.query(
    "SELECT id FROM cards WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
    [cardId, workspaceId],
  );
  if (cardCheck.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  const { rows } = await pool.query(
    `${ACTIVITY_SELECT}
     WHERE e.card_id = $1 AND e.workspace_id = $2
     ORDER BY e.created_at DESC, e.id DESC`,
    [cardId, workspaceId],
  );
  res.json({ events: rows.map(toActivityEvent) });
});

// ---- Presence (Redis TTL heartbeat) -------------------------------------------

api.post("/workspaces/:workspaceId/presence/heartbeat", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  await heartbeat(workspaceId, req.user!);
  res.json({ ok: true });
});

api.get("/workspaces/:workspaceId/presence", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  res.json({ users: await onlineUsers(workspaceId, req.user!) });
});

api.delete("/workspaces/:workspaceId/presence", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  await clearPresence(workspaceId, req.user!.id);
  res.status(204).end();
});

// ---- Real-time stream (Redis Pub/Sub -> SSE) ----------------------------------

api.get("/workspaces/:workspaceId/events/stream", async (req, res) => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (workspaceId === null) {
    return res.status(400).json({ error: "workspaceId must be an integer" });
  }

  const role = await lookupMembership(req.user!.id, workspaceId);
  if (!role) return res.status(404).json({ error: "Not found" });

  sseHandler(req, res);
});

// ---- Integration test helpers (in-memory, no DB) ------------------------------

const LEGACY_WORKSPACE_API_ROUTES = [
  { method: "GET", path: "/board" },
  { method: "POST", path: "/cards" },
  { method: "GET", path: "/settings" },
  { method: "GET", path: "/events/stream" },
  { method: "GET", path: "/presence" },
] as const;

type RouteLayer = {
  route?: { path: string; methods: Record<string, boolean> };
};

function listTopLevelApiRoutes(router: Router): Set<string> {
  const keys = new Set<string>();
  for (const layer of (router as unknown as { stack: RouteLayer[] }).stack ?? []) {
    if (!layer.route) continue;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled && method !== "_all") {
        keys.add(`${method.toUpperCase()} ${layer.route.path}`);
      }
    }
  }
  return keys;
}

/**
 * Documents legacy global routes and verifies they are not mounted on the API router.
 * Uses router stack inspection — does not issue real HTTP requests.
 */
export function legacyWorkspaceRouteMatrix() {
  const registered = listTopLevelApiRoutes(api);
  return LEGACY_WORKSPACE_API_ROUTES.map(({ method, path }) => ({
    method,
    path: `/api${path}`,
    status: registered.has(`${method} ${path}`) ? (200 as const) : (404 as const),
  }));
}

export type IntegrationUser = { userId: number; username: string };

/**
 * In-process isolation harness — no DB or real HTTP involved.
 * Verifies workspace boundary logic via the same pure services used by route handlers.
 */
export function createWorkspaceIntegrationHarness() {
  let nextUserId = 1;
  let nextWorkspaceId = 1;
  let nextCardId = 1;
  let nextColumnId = 1;
  let nextEventId = 1;

  const users = new Map<string, number>();
  const memberships = new Map<string, { role: string }>();
  const columnsByWorkspace = new Map<number, number[]>();
  const cards = new Map<
    number,
    { id: number; workspaceId: number; title: string; columnId: number }
  >();
  const activities: Array<{ id: number; cardId: number; workspaceId: number }> = [];

  const boardService = createScopedBoardService({
    getMembership: async (workspaceId, userId) => {
      const role = memberships.get(`${workspaceId}:${userId}`);
      return role ? { role: role.role } : null;
    },
    getCardById: async (workspaceId, cardId) => {
      const card = cards.get(cardId);
      if (!card || card.workspaceId !== workspaceId) return null;
      return card;
    },
    getBoardRows: async () => [],
    getActivityRows: async (workspaceId) =>
      activities
        .filter((e) => e.workspaceId === workspaceId)
        .map((e) => ({ id: e.id, workspaceId: e.workspaceId, cardTitle: "" })),
  });

  return {
    async signIn(username: string): Promise<IntegrationUser> {
      if (!users.has(username)) {
        users.set(username, nextUserId++);
      }
      return { userId: users.get(username)!, username };
    },

    async createWorkspace(
      user: IntegrationUser,
      name: string,
    ): Promise<{ id: number; name: string; role: string; isPersonal: boolean }> {
      const id = nextWorkspaceId++;
      memberships.set(`${id}:${user.userId}`, { role: "owner" });
      const columnId = nextColumnId++;
      columnsByWorkspace.set(id, [columnId]);
      return { id, name, role: "owner", isPersonal: false };
    },

    async createCard(
      user: IntegrationUser,
      workspaceId: number,
      opts: { title: string },
    ): Promise<{ id: number; workspaceId: number; title: string }> {
      const membership = memberships.get(`${workspaceId}:${user.userId}`);
      if (!membership) throw new Error("not a workspace member");

      const columnId = columnsByWorkspace.get(workspaceId)?.[0];
      if (columnId === undefined) throw new Error("workspace has no columns");

      const id = nextCardId++;
      const card = { id, workspaceId, title: opts.title, columnId };
      cards.set(id, card);
      activities.push({ id: nextEventId++, cardId: id, workspaceId });
      return { id, workspaceId, title: opts.title };
    },

    async getCard(
      user: IntegrationUser,
      workspaceId: number,
      cardId: number,
    ): Promise<{ status: 404 } | { id: number; workspaceId: number; title: string }> {
      const result = await boardService.getCard({
        userId: user.userId,
        workspaceId,
        cardId,
      });
      if ("status" in result) return { status: result.status };
      return result;
    },

    async getActivity(
      user: IntegrationUser,
      workspaceId: number,
    ): Promise<Array<{ cardId: number; workspaceId: number }>> {
      const membership = memberships.get(`${workspaceId}:${user.userId}`);
      if (!membership) return [];

      return activities
        .filter((e) => e.workspaceId === workspaceId)
        .map((e) => ({ cardId: e.cardId, workspaceId: e.workspaceId }));
    },
  };
}
