-- Agent board tables (additive — no existing tables modified except columns)

CREATE TABLE IF NOT EXISTS agent_boards (
  id               SERIAL PRIMARY KEY,
  workspace_id     INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id      TEXT NOT NULL DEFAULT 'research-report',
  original_intent  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved')),
  execution_status TEXT NOT NULL DEFAULT 'idle'
                   CHECK (execution_status IN ('idle', 'running', 'done', 'failed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id         SERIAL PRIMARY KEY,
  board_id   INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_card_outputs (
  id          SERIAL PRIMARY KEY,
  board_id    INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
  column_slug TEXT NOT NULL,
  card_index  INTEGER NOT NULL DEFAULT 0,
  output      TEXT NOT NULL,
  thinking    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE columns ADD COLUMN IF NOT EXISTS board_id
  INTEGER REFERENCES agent_boards(id) ON DELETE CASCADE;
ALTER TABLE columns ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE columns ADD COLUMN IF NOT EXISTS reasoning BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE columns ADD COLUMN IF NOT EXISTS system_prompt TEXT;
ALTER TABLE columns ADD COLUMN IF NOT EXISTS tools TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE columns ADD COLUMN IF NOT EXISTS tool_budget INTEGER;

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id          SERIAL PRIMARY KEY,
  board_id    INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
  column_slug TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  input       JSONB,
  result      TEXT,
  error_code  TEXT,
  attempt     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_boards_workspace ON agent_boards(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_board ON agent_conversations(board_id);
CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_board ON agent_tool_calls(board_id);

CREATE TABLE IF NOT EXISTS agent_artifacts (
  id           SERIAL PRIMARY KEY,
  board_id     INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  format       TEXT NOT NULL DEFAULT 'md' CHECK (format IN ('md')),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (board_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_board ON agent_artifacts(board_id);
