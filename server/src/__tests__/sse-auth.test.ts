import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — must run before any module that touches config/db.
// ---------------------------------------------------------------------------

// Mock db/pool to avoid real DB and env validation.
vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn() },
}));

// Mock realtime to avoid Redis.
vi.mock('../realtime.js', () => ({
  sseHandler: vi.fn((_req: unknown, res: any) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end();
  }),
}));

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

import { requireAuth } from '../auth.js';
import { requireWorkspaceMember } from '../middleware/workspace.js';
import { sseHandler } from '../realtime.js';

describe('SSE stream auth contract (/events/stream)', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(cookieParser());
    const api = express.Router();
    api.use(requireAuth);
    api.get(
      '/workspaces/:workspaceId/events/stream',
      requireWorkspaceMember,
      (req, res) => sseHandler(req, res),
    );
    app.use('/api', api);
  });

  it('rejects the stream with no session cookie (401)', async () => {
    const res = await request(app)
      .get('/api/workspaces/1/events/stream')
      .expect(401);
    expect(res.body).toEqual({ error: 'authentication required' });
  });
});
