import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { Client } = pg;

const runIntegration = process.env.HTTP_INTEGRATION === "1";
const httpDescribe = runIntegration ? describe : describe.skip;
const defaultTestDatabaseUrl = "postgres://camel:camel@localhost:5432/camel_kanban_test";

let app: Express;
let pool: Awaited<typeof import("./db/pool.js")>["pool"];

function testDatabaseUrl(): string {
  return process.env.HTTP_INTEGRATION_DATABASE_URL ?? defaultTestDatabaseUrl;
}

function databaseName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

function quoteIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe test database name: ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

async function ensureTestDatabase(databaseUrl: string): Promise<void> {
  const dbName = databaseName(databaseUrl);
  if (!dbName.toLowerCase().includes("test")) {
    throw new Error(
      `Refusing to run HTTP integration tests against non-test database "${dbName}"`,
    );
  }

  const adminUrl =
    process.env.HTTP_INTEGRATION_ADMIN_DATABASE_URL ??
    (() => {
      const url = new URL(databaseUrl);
      url.pathname = "/postgres";
      return url.toString();
    })();

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (existing.rows.length === 0) {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(dbName)}`);
    }
  } finally {
    await admin.end();
  }
}

async function applySchema(databaseUrl: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(join(here, "db", "schema.sql"), "utf8");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(schema);
  } finally {
    await client.end();
  }
}

async function resetDatabase(): Promise<void> {
  await pool.query(
    `TRUNCATE TABLE
       card_events,
       cards,
       columns,
       workspace_invites,
       workspace_members,
       sessions,
       settings,
       workspaces,
       users
     RESTART IDENTITY CASCADE`,
  );
}

type TestAgent = ReturnType<typeof request.agent>;

async function registerUser(
  username: string,
  displayName = username,
): Promise<{
  agent: TestAgent;
  user: { id: number; username: string; displayName: string };
  personalWorkspace: { id: number; name: string; role: string; isPersonal: boolean };
}> {
  const agent = request.agent(app);
  const register = await agent
    .post("/api/auth/register")
    .send({ username, password: "password123", displayName });

  expect(register.status).toBe(201);
  expect(register.body.user).toMatchObject({
    username: username.toLowerCase(),
    displayName,
  });

  const workspaces = await agent.get("/api/workspaces");
  expect(workspaces.status).toBe(200);
  const personalWorkspace = workspaces.body.workspaces.find(
    (workspace: { isPersonal: boolean }) => workspace.isPersonal,
  );
  expect(personalWorkspace).toBeDefined();

  return {
    agent,
    user: register.body.user,
    personalWorkspace,
  };
}

async function createColumn(
  agent: TestAgent,
  workspaceId: number,
  title: string,
): Promise<{ id: number; title: string; position: number; wip_limit: number | null }> {
  const response = await agent
    .post(`/api/workspaces/${workspaceId}/columns`)
    .send({ title });

  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ title });
  return response.body;
}

async function createCard(
  agent: TestAgent,
  workspaceId: number,
  columnId: number,
  title: string,
): Promise<{ id: number; column_id: number; title: string; version: number }> {
  const response = await agent
    .post(`/api/workspaces/${workspaceId}/cards`)
    .send({ columnId, title, description: `${title} description` });

  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ column_id: columnId, title, version: 1 });
  return response.body;
}

httpDescribe("HTTP routes", () => {
  beforeAll(async () => {
    const databaseUrl = testDatabaseUrl();
    process.env.DATABASE_URL = databaseUrl;
    await ensureTestDatabase(databaseUrl);
    await applySchema(databaseUrl);

    ({ app } = await import("./index.js"));
    ({ pool } = await import("./db/pool.js"));
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("rejects unauthenticated API requests", async () => {
    const response = await request(app).get("/api/workspaces");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "authentication required" });
  });

  it("registers, reads the current session, logs out, and logs back in", async () => {
    const agent = request.agent(app);

    const register = await agent.post("/api/auth/register").send({
      username: "alice",
      password: "password123",
      displayName: "Alice",
    });
    expect(register.status).toBe(201);
    expect(register.body.user).toMatchObject({
      username: "alice",
      displayName: "Alice",
    });

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ username: "alice" });

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(204);

    const afterLogout = await agent.get("/api/auth/me");
    expect(afterLogout.status).toBe(401);

    const login = await agent
      .post("/api/auth/login")
      .send({ username: "alice", password: "password123" });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ username: "alice" });
  });

  it("performs board column and card CRUD through workspace-scoped routes", async () => {
    const { agent, personalWorkspace } = await registerUser("boarduser", "Board User");
    const workspaceId = personalWorkspace.id;
    const todo = await createColumn(agent, workspaceId, "Todo");
    const doing = await createColumn(agent, workspaceId, "Doing");
    const card = await createCard(agent, workspaceId, todo.id, "Write HTTP tests");

    const board = await agent.get(`/api/workspaces/${workspaceId}/board`);
    expect(board.status).toBe(200);
    expect(board.body.columns).toEqual([
      expect.objectContaining({
        id: todo.id,
        title: "Todo",
        cards: [expect.objectContaining({ id: card.id, title: "Write HTTP tests" })],
      }),
      expect.objectContaining({ id: doing.id, title: "Doing", cards: [] }),
    ]);

    const update = await agent
      .patch(`/api/workspaces/${workspaceId}/cards/${card.id}`)
      .send({
        title: "Write reliable HTTP tests",
        description: "Cover critical routes",
        version: card.version,
      });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({
      id: card.id,
      title: "Write reliable HTTP tests",
      description: "Cover critical routes",
      version: card.version + 1,
    });

    const fetched = await agent.get(`/api/workspaces/${workspaceId}/cards/${card.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({
      id: card.id,
      workspaceId,
      title: "Write reliable HTTP tests",
    });

    const staleUpdate = await agent
      .patch(`/api/workspaces/${workspaceId}/cards/${card.id}`)
      .send({ title: "Stale title", version: card.version });
    expect(staleUpdate.status).toBe(409);
    expect(staleUpdate.body).toMatchObject({ code: "version_conflict" });

    const remove = await agent.delete(`/api/workspaces/${workspaceId}/cards/${card.id}`);
    expect(remove.status).toBe(204);

    const afterDelete = await agent.get(`/api/workspaces/${workspaceId}/cards/${card.id}`);
    expect(afterDelete.status).toBe(404);

    const activity = await agent.get(`/api/workspaces/${workspaceId}/activity`);
    expect(activity.status).toBe(200);
    expect(activity.body.events.map((event: { type: string }) => event.type)).toEqual([
      "delete",
      "update",
      "create",
    ]);
  });

  it("moves cards and rejects moves that exceed the target column WIP limit", async () => {
    const { agent, personalWorkspace } = await registerUser("mover", "Mover");
    const workspaceId = personalWorkspace.id;
    const todo = await createColumn(agent, workspaceId, "Todo");
    const doing = await createColumn(agent, workspaceId, "Doing");

    const limit = await agent
      .patch(`/api/workspaces/${workspaceId}/columns/${doing.id}`)
      .send({ wipLimit: 1 });
    expect(limit.status).toBe(200);
    expect(limit.body).toMatchObject({ id: doing.id, wip_limit: 1 });

    const first = await createCard(agent, workspaceId, todo.id, "First");
    const firstMove = await agent
      .post(`/api/workspaces/${workspaceId}/cards/${first.id}/move`)
      .send({ toColumnId: doing.id, index: 0, version: first.version });
    expect(firstMove.status).toBe(200);
    expect(firstMove.body).toMatchObject({
      id: first.id,
      column_id: doing.id,
      version: first.version + 1,
    });

    const second = await createCard(agent, workspaceId, todo.id, "Second");
    const blockedMove = await agent
      .post(`/api/workspaces/${workspaceId}/cards/${second.id}/move`)
      .send({ toColumnId: doing.id, index: 1, version: second.version });
    expect(blockedMove.status).toBe(409);
    expect(blockedMove.body).toEqual({
      error: "WIP limit reached for this column",
      reason: "wip_limit_reached",
    });
  });

  it("adds, authorizes, and removes workspace members", async () => {
    const owner = await registerUser("owner1", "Owner One");
    const member = await registerUser("member1", "Member One");
    const workspaceId = owner.personalWorkspace.id;

    const addMember = await owner.agent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ username: member.user.username, role: "member" });
    expect(addMember.status).toBe(201);
    expect(addMember.body).toMatchObject({
      userId: member.user.id,
      username: "member1",
      role: "member",
    });

    const members = await member.agent.get(`/api/workspaces/${workspaceId}/members`);
    expect(members.status).toBe(200);
    expect(members.body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: owner.user.id, role: "owner" }),
        expect.objectContaining({ userId: member.user.id, role: "member" }),
      ]),
    );

    const memberCannotInvite = await member.agent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ username: "pendinguser", role: "member" });
    expect(memberCannotInvite.status).toBe(404);

    const removeMember = await owner.agent.delete(
      `/api/workspaces/${workspaceId}/members/${member.user.id}`,
    );
    expect(removeMember.status).toBe(204);

    const removedMemberBoard = await member.agent.get(
      `/api/workspaces/${workspaceId}/board`,
    );
    expect(removedMemberBoard.status).toBe(404);
  });
});
