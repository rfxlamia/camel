# Agentic Kanban — Phase 1: Intent → Plan → Thin Execution

**Date:** 2026-06-14
**Status:** approved
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md

---

## Summary

Membangun lapisan agentic di atas camel-kanban yang memungkinkan non-dev business users (marketing, ops, support) mendelegasikan pekerjaan ke AI agents melalui natural language intent. User mengetik tujuan → board agent generate plan → user approve → satu agent execute dan menghasilkan output nyata. Existing human kanban tidak disentuh — fitur ini sepenuhnya terpisah.

---

## Context

### Current State

camel-kanban memiliki workspace → columns → cards dengan SSE real-time, multi-workspace, team collaboration. Tidak ada tabel `boards`, tidak ada LLM integration, tidak ada chat interface. Semua existing primitif (columns, cards, positions, SSE) tersedia untuk digunakan ulang.

### Problem / Motivation

Non-dev business teams tidak punya cara untuk mendelegasikan pekerjaan ke AI agents sambil tetap memiliki visibility dan kontrol. Pure chat (black box) atau developer-only tools (terlalu kompleks). Phase 1 memvalidasi hipotesis inti: visual oversight board bernilai cukup sehingga non-dev users memilih kanban tool daripada pure chat.

### Related Areas

- `server/src/db/schema.sql` — new tables: `agent_boards`, `agent_conversations`
- `server/src/routes.ts` — new endpoints: `/api/agent/*`
- `server/src/realtime.ts` — new event types: `agent.*`
- `client/src/pages/AgentPage.tsx` — new page (split view)
- `client/src/pages/HistoryPage.tsx` — new page (list)
- `client/src/api.ts` — new typed fetch functions
- `client/src/types.ts` — new interfaces
- `server/package.json` — add `@anthropic-ai/sdk`

---

## Scope

### In-Scope

- `/agent` page: split view (left = board visual, right = chat + controls)
- Chat input untuk capture intent (bukan chatbot — satu text input)
- Board Agent: 1 LLM call classify intent → pilih template → generate board
- Template library: 1 template hardcoded — "Research & Report" (5 columns)
- Pre-approval board: disimpan ke DB sebagai `status = 'pending'`
- Generate-Explain-Refine loop: board generated → chat explains → user approve atau refine
- Refine: unlimited iterations; LLM generates 1 clarification question; board regenerated
- No-match fallback: LLM memberitahu user bahwa request belum bisa diproses
- Queue: jika generation in-progress, input baru auto-queued; auto-fires setelah done/failed
- Approval Gate 1: user klik Approve → board status berubah ke `'approved'`
- Thin execution: card pertama dari column pertama auto-execute dengan 1 LLM call setelah approval
- Execution output visible di card detail panel (read-only)
- Right panel live progress log selama eksekusi (`agent.*` SSE events)
- `execution_status` field: `pending | running | done | failed`
- Read-only card detail panel: system_prompt + reasoning mode per column
- Chat input disabled setelah approval; right panel read-only execution log
- `/history` page: list semua approved boards workspace-scoped, sorted DESC; klik → load ke `/agent`
- Return visit `/agent`: menampilkan board paling recent

### Out-of-Scope

- Worker execution di luar card pertama column pertama — cross-card handoff (Phase 2)
- QA column execution (Phase 2)
- Approval Gate 2 (Phase 2)
- Re-run mechanism (Phase 3)
- Template marketplace / monetization (Phase 3)
- Direction B: dynamic board generation tanpa template (long-term vision)
- `/history` sebagai navigasi utama — hanya list view, load ke `/agent`
- Board switching di dalam `/agent` — switching hanya via `/history`

---

## Architecture Constraints

- **Layers yang boleh disentuh:** `server/src/routes.ts`, `server/src/db/schema.sql`, `server/src/realtime.ts` (agent.* events only), `client/src/pages/`, `client/src/api.ts`, `client/src/types.ts`, `server/package.json` (add @anthropic-ai/sdk)
- **Layers yang TIDAK boleh disentuh:** `server/src/core/position.ts`, `server/src/core/wip.ts`, `server/src/core/metrics.ts`
- **Pattern wajib:** workspace-scoped semua data, `requireAuth` di semua endpoints, fractional positions untuk column ordering, SSE fan-out via `realtime.ts`
- **LLM:** `@anthropic-ai/sdk` di server side only — API key tidak pernah expose ke client
- **columns.board_id nullable** — human kanban columns tetap `NULL`; `GET /board` HARUS diupdate ke `WHERE board_id IS NULL` secara atomik dengan penambahan `boards` table
- **Agent card events** menggunakan tabel terpisah (`agent_card_events`) — TIDAK menulis ke `card_events` (activity feed human kanban)
- **Conversation state** disimpan di DB per board session — client hanya mengirim message baru; server reconstruct full thread; mendukung prompt caching Anthropic (`cache_control` pada static system prompts)
- **Architecture validation:** CONDITIONAL PASS — `GET /board` filter WAJIB diupdate atomik

---

## Template Definition

### Template: Research & Report

```
id: research-report
display_name: "Research & Report"
columns (sequential):
```

#### Column 1 — Research Specialist
```
name: Research Specialist
slug: research-specialist
position: 1
reasoning: false
system_prompt: |
  You are a Research Specialist. Your only job is to gather and organize
  relevant, factual information based on the task objective. You do not
  analyze, interpret, or draw conclusions — that is the next agent's job.

  <task>
  The user has requested: {original_intent}
  </task>

  <your_job>
  Research this topic thoroughly. Use your knowledge to gather concrete,
  factual information. Be specific: include numbers, dates, names, and
  verifiable details wherever possible.
  </your_job>

  <output_format>
  Structure your research brief exactly as follows:

  ## Research Brief: {topic}

  ### Overview
  [2–3 sentence summary of the topic]

  ### Key Facts
  [Bullet list of the most specific, verifiable facts]

  ### Background Context
  [Relevant history, market context, or domain knowledge]

  ### Key Players
  [Companies, people, products relevant to this topic]

  ### Gaps & Limitations
  [What you could not find or verify — be honest]

  ---
  *Handoff: Ready for Analysis Specialist.*
  </output_format>
```

#### Column 2 — Analysis Specialist
```
name: Analysis Specialist
slug: analysis-specialist
position: 2
reasoning: true
system_prompt: |
  You are an Analysis Specialist. You do not conduct new research.
  Your job is to analyze the research brief and extract meaningful insights
  that directly serve the user's original objective.

  <task>
  The user's original objective: {original_intent}
  </task>

  <context>
  Research Brief from previous agent:
  {previous_output}
  </context>

  <your_job>
  Analyze what the research means for this specific objective. Think carefully
  before writing. Identify patterns, implications, and what the user should
  actually know or do based on this data.
  </your_job>

  <constraints>
  - Do NOT introduce facts not in the research brief
  - Do NOT be generic — every insight must connect to the original objective
  - 3 sharp insights beat 7 vague ones
  </constraints>

  <output_format>
  ## Analysis: {topic}

  ### Key Insights
  **Insight [N]: [Title]**
  What it means: [1–2 sentences]
  Why it matters for this objective: [1 sentence]
  (3–5 insights maximum)

  ### Recommended Focus Areas
  [2–3 specific areas the Writer should emphasize]

  ### What to De-emphasize
  [Research that surfaced but is NOT relevant to this objective]

  ---
  *Handoff: Ready for Writer.*
  </output_format>
```

#### Column 3 — Writer
```
name: Writer
slug: writer
position: 3
reasoning: false
system_prompt: |
  You are a professional Writer specializing in clear, actionable documents
  for non-technical business audiences (marketing, ops, support).

  <task>
  The user's original objective: {original_intent}
  </task>

  <context>
  Research Brief: {research_output}
  Analysis: {analysis_output}
  </context>

  <your_job>
  Write the final document. Your reader is a non-technical business professional.
  Use plain language. Every section must be actionable — the reader should know
  what to do, not just what is true.
  </your_job>

  <constraints>
  - Do NOT introduce facts not in the research brief
  - Do NOT use jargon without explanation
  - Do NOT exceed what the objective asked for
  </constraints>

  <output_format>
  Write a complete, polished document with:
  - A clear title
  - An executive summary (3 sentences max)
  - The main body (organized with headers)
  - A "What to do next" section (3–5 concrete action items)

  The document must stand alone — someone who hasn't seen the research
  or analysis should fully understand it.

  ---
  *Handoff: Ready for Editorial review.*
  </output_format>
```

#### Column 4 — Editor
```
name: Editor
slug: editor
position: 4
reasoning: false
system_prompt: |
  You are a meticulous Editor. You do not rewrite — you refine.
  Improve clarity, accuracy, and alignment with the original objective
  without changing the document's structure or scope.

  <task>
  The user's original objective: {original_intent}
  </task>

  <document_to_edit>
  {writer_output}
  </document_to_edit>

  <your_job>
  Check for:
  1. Clarity — clear to a non-technical reader?
  2. Accuracy — contradicts the research brief?
  3. Completeness — fully addresses the original objective?
  4. Tone — appropriate for a business professional?
  5. Actionability — are next steps concrete and achievable?
  </your_job>

  <constraints>
  - Do NOT change the document's scope or add new topics
  - Do NOT remove content that directly serves the objective
  - Do NOT rewrite sections that are already clear
  </constraints>

  <output_format>
  ## Editorial Notes
  [3–5 bullet points: what you changed and why]

  ---

  ## Revised Document
  [Complete final revised document]

  ---
  *Handoff: Ready for QA Guardian.*
  </output_format>
```

#### Column 5 — QA Guardian
```
name: QA Guardian
slug: qa-guardian
position: 5
reasoning: true
system_prompt: |
  You are the QA Guardian. You are the final check before this work reaches
  the user. Your only job is to verify that the final document delivers
  exactly what the user originally asked for. You do not improve or expand — you validate.

  <original_intent>
  {original_intent}
  </original_intent>

  <final_document>
  {editor_output}
  </final_document>

  <your_job>
  Compare the final document ONLY against the original intent.
  Ask yourself:
  1. Does this document directly answer what the user asked for?
  2. Is anything the user asked for missing or inadequately addressed?
  3. Is the core question answered, or just talked around?
  </your_job>

  <constraints>
  - Do NOT suggest improvements beyond what the original intent required
  - Do NOT pass a document that fails the core question
  </constraints>

  <output_format>
  ## QA Verdict

  **Status:** PASS | NEEDS REVISION

  **Original Intent Restated:** [One sentence — what the user asked for]

  **Verdict Reasoning:** [2–3 sentences]

  If PASS:
  **Summary for user:** [2 sentences the user will read]

  If NEEDS REVISION:
  **Gaps found:**
  - Gap [N]: [Specific thing missing or inadequate]
  **Revision instruction:** [One scope-bounded instruction for the Writer]
  </output_format>
```

---

## Stories + Scenarios

### Story 1: Intent → Board Generation

> As a non-dev user, I want to type my work intent and get a structured agent board, so that I can see and approve the AI's plan before it runs.

**Rule 1: Board ter-generate dari 1 LLM call classify intent → pilih template**

```gherkin
Scenario: Successful board generation from clear intent
  Given user authenticated, berada di /agent, left panel empty + CTA
  When  user mengetik "riset kompetitor fintech lokal" dan submit
  Then  LLM dipanggil 1x dengan intent sebagai input
  And   board ter-generate dari template Research & Report (status = 'pending', disimpan ke DB)
  And   left panel menampilkan board visual dengan 5 columns
  And   right panel menampilkan penjelasan board dalam bahasa natural

Scenario: Intent tidak cocok dengan template yang tersedia
  Given user submit intent "buat website landing page untuk produk baru"
  When  LLM classify intent dan tidak menemukan template yang cocok
  Then  LLM menginformasikan user bahwa request ini belum bisa diproses saat ini
  And   right panel menampilkan pesan tersebut
  And   tidak ada board yang di-generate

Scenario: LLM call fails during generation
  Given user submit intent
  When  LLM return error (timeout / API error / rate limit)
  Then  right panel menampilkan error message yang deskriptif
  And   retry button muncul di right panel
  And   left panel tetap dalam state sebelumnya
```

**Rule 2: Input baru queue jika generation in-progress**

```gherkin
Scenario: Concurrent intent submission while generation in-progress
  Given generation sedang berjalan (LLM call in-progress)
  When  user mengetik dan submit intent kedua
  Then  intent kedua masuk queue (tidak dikirim ke LLM)
  And   setelah generation pertama selesai atau gagal, intent kedua auto-fires
  And   queue tidak di-reset jika generation pertama gagal
```

---

### Story 2: Generate-Explain-Refine Loop

> As a non-dev user, I want to refine the generated board jika tidak sesuai, so that board yang saya approve benar-benar reflect my intent.

**Rule 1: Right panel explain board setelah generation**
**Rule 2: Jika user menyatakan tidak pas, chat tanya 1 LLM-generated clarification question**
**Rule 3: User jawab → board di-regenerate → loop berlanjut (unlimited)**

```gherkin
Scenario: User menyatakan board tidak sesuai
  Given board ter-generate dan right panel menampilkan penjelasan
  When  user mengetik "tidak, ini untuk product launch bukan riset umum"
  Then  LLM dipanggil dengan: original intent + board saat ini + feedback user
  And   right panel menampilkan 1 pertanyaan klarifikasi spesifik yang relevan
  And   left panel tetap menampilkan board lama (belum berubah)

Scenario: User menjawab clarification question
  Given right panel menampilkan 1 pertanyaan klarifikasi
  When  user mengetik jawaban dan submit
  Then  LLM dipanggil untuk regenerate board dengan konteks lengkap
  And   board lama di DB diupdate (overwrite, status tetap 'pending')
  And   left panel menampilkan board yang diperbarui
  And   right panel menampilkan penjelasan board baru

Scenario: Multiple refine iterations (5x atau lebih)
  Given user sudah refine board sebanyak 4x
  When  user submit feedback kelima
  Then  sistem memproses tanpa error atau hard stop
  And   flow berlanjut normal

Scenario: LLM fails during refine clarification
  Given user submit feedback "tidak sesuai"
  When  LLM return error saat generate clarification question
  Then  right panel menampilkan error message
  And   retry button muncul
  And   board state tidak berubah
```

---

### Story 3: Approval Gate 1

> As a non-dev user, I want to formally approve the board plan, so that intent saya ter-lock dan board siap untuk dieksekusi.

**Rule 1: Approve button hanya tersedia setelah board ter-generate (status = 'pending')**
**Rule 2: Setelah approved, board status → 'approved', execution dimulai**
**Rule 3: Right panel beralih ke live progress log (agent.* SSE events)**
**Rule 4: Board read-only, chat input disabled**

```gherkin
Scenario: Successful board approval
  Given board ter-generate (status = 'pending') di left panel
  When  user klik tombol "Approve"
  Then  board status diupdate ke 'approved' di DB
  And   execution_status diset ke 'running'
  And   right panel beralih ke live progress log
  And   chat input di right panel menjadi disabled
  And   thin execution dimulai (Story 5)

Scenario: Approve button tidak tersedia sebelum board ter-generate
  Given user baru buka /agent, belum ada board ter-generate
  Then  approve button tidak ada atau disabled

Scenario: DB write fails saat approval
  Given user klik Approve
  When  DB update gagal (connection error)
  Then  error ditampilkan di right panel
  And   board tetap dalam status 'pending'
  And   approve button tetap aktif untuk retry

Scenario: User navigates away then returns after approval
  Given board sudah approved dan tersimpan di DB
  When  user navigate ke /board lalu kembali ke /agent
  Then  left panel menampilkan board yang sudah approved (most recent)
  And   right panel menampilkan execution log state yang sesuai dengan execution_status
```

---

### Story 4: Read-only Card Detail Panel

> As a non-dev user, I want to click a card and see its agent configuration, so that saya bisa memahami apa yang agent ini akan kerjakan sebelum approve.

**Rule 1: Klik card membuka panel dengan system_prompt column**
**Rule 2: Panel tampilkan reasoning mode (true/false) dari column**
**Rule 3: Panel read-only — tidak ada edit controls**

```gherkin
Scenario: User views card detail before approval
  Given board ter-generate, column "Research Specialist" reasoning = false
  When  user klik salah satu card di column Research Specialist
  Then  detail panel terbuka
  And   panel menampilkan system_prompt column Research Specialist
  And   panel menampilkan label "Extended Thinking: OFF"
  And   tidak ada input field atau edit control

Scenario: Card detail shows extended thinking mode
  Given column "Analysis Specialist" reasoning = true
  When  user klik card di column Analysis Specialist
  Then  panel menampilkan system_prompt column Analysis Specialist
  And   panel menampilkan label "Extended Thinking: ON"

Scenario: Card detail after execution (first card only in Phase 1)
  Given card pertama di column Research Specialist sudah execute
  When  user klik card tersebut
  Then  panel menampilkan system_prompt
  And   panel menampilkan execution output dari LLM call
```

---

### Story 5: Thin Execution — First Card

> As a non-dev user, I want to see at least one agent produce real output after I approve, so that saya bisa memvalidasi bahwa sistem bekerja.

**Rule 1: Setelah Approval Gate 1, card pertama dari column pertama (Research Specialist) auto-execute**
**Rule 2: Satu LLM call — system_prompt column + original intent sebagai input**
**Rule 3: Output tersimpan ke DB dan visible di card detail panel**
**Rule 4: Right panel menampilkan live progress via agent.* SSE events**
**Rule 5: Execution error → error di right panel + retry button**

```gherkin
Scenario: First card executes successfully after approval
  Given board approved, column pertama "Research Specialist" punya ≥1 card
  When  approval selesai disimpan ke DB
  Then  card pertama di Research Specialist mulai execute
  And   right panel menampilkan "Research Specialist is working..."
  And   setelah selesai: execution_status = 'done', right panel update "Research Specialist done ✓"
  And   card detail panel menampilkan output eksekusi
  And   output tersimpan di DB (agent_card_events atau field terpisah)

Scenario: Extended thinking enabled on executing column
  Given column "Research Specialist" reasoning = false (sesuai template)
  When  card pertama execute
  Then  LLM dipanggil tanpa extended_thinking (reasoning = false)

Scenario: First card execution fails
  Given card pertama sedang execute
  When  LLM return error
  Then  execution_status = 'failed'
  And   right panel menampilkan error message spesifik
  And   retry button muncul untuk card tersebut
  And   partial output tidak tersimpan

Scenario: User returns to /agent while execution in-progress
  Given execution_status = 'running', card pertama sedang execute
  When  user navigate away lalu kembali ke /agent
  Then  left panel tampil board
  And   right panel tampil progress log yang sesuai (reconnect SSE atau load state dari DB)
```

---

### Story 6: /history Page

> As a non-dev user, I want to see all my approved boards, so that saya bisa revisit past agent sessions.

**Rule 1: /history menampilkan semua approved boards workspace-scoped, sorted created_at DESC**
**Rule 2: Setiap item: intent text, template display name, created_at, execution_status**
**Rule 3: Klik item → navigate ke /agent dengan board tersebut di left panel (read-only replay, bukan re-trigger)**
**Rule 4: Empty state jika belum ada board**

```gherkin
Scenario: User views history with existing boards
  Given user punya 3 approved boards di workspace aktif
  When  user navigate ke /history
  Then  list menampilkan 3 boards sorted created_at DESC
  And   setiap item menampilkan: intent text, "Research & Report", tanggal, execution_status

Scenario: User navigates to a past board from history (read-only replay)
  Given /history menampilkan list
  When  user klik salah satu board
  Then  user di-redirect ke /agent
  And   left panel menampilkan board yang dipilih (read-only)
  And   right panel menampilkan execution log sesuai execution_status board tersebut
  And   TIDAK ada execution yang di-trigger ulang

Scenario: Empty history
  Given user belum approve board apapun di workspace ini
  When  user navigate ke /history
  Then  empty state ditampilkan
  And   CTA link ke /agent tersedia

Scenario: Cross-workspace isolation
  Given user adalah member workspace A dan workspace B
  When  user melihat /history di workspace A
  Then  hanya boards dari workspace A yang ditampilkan
  And   boards workspace B tidak visible
```

---

## Acceptance Criteria

```
Rule: Board Generation
  ✓ Given user submit clear intent, Then board ter-generate dari template, disimpan ke DB (pending), visual muncul di left panel
  ✓ Given user submit saat generation in-progress, Then input queued dan auto-fires setelah done/failed
  ✗ Given intent tidak cocok template, Then LLM informasikan user, tidak ada board di-generate
  ✗ Given LLM error, Then error message + retry button di right panel

Rule: Generate-Explain-Refine
  ✓ Given board ter-generate, Then right panel menampilkan penjelasan natural language
  ✓ Given user menyatakan tidak pas, Then LLM generate 1 clarification question
  ✓ Given user jawab clarification, Then board di-regenerate, left panel update
  ✓ Given user refine 5x berturut-turut, Then sistem tidak hard-stop

Rule: Approval Gate 1
  ✓ Given board pending, When user approve, Then status = 'approved', execution dimulai
  ✓ Given board approved, When user return, Then most recent board loaded (bukan re-triggered)
  ✗ Given belum ada board, Then approve button disabled
  ✗ Given DB write fail saat approve, Then error displayed, board tetap pending

Rule: Card Detail Panel
  ✓ Given user klik card, Then panel tampil system_prompt + reasoning mode (read-only)
  ✓ Given card sudah execute, Then panel tampil output eksekusi
  ✗ Given user mencoba edit, Then tidak ada edit controls tersedia

Rule: Thin Execution (First Card Only)
  ✓ Given board approved, Then card pertama column pertama auto-execute
  ✓ Given execution selesai, Then output di DB dan visible di card detail panel
  ✓ Given right panel, Then SSE live progress log "working..." → "done ✓"
  ✗ Given LLM error saat execute, Then error + retry; execution_status = 'failed'

Rule: /history Page
  ✓ Given user punya approved boards, Then list tampil sorted DESC, per workspace
  ✓ Given user klik board di history, Then /agent load board (read-only, no re-trigger)
  ✗ Given user belum punya boards, Then empty state + CTA ke /agent
  ✗ Given user akses history workspace lain, Then 404 (workspace isolation)
```

---

## Design Decision

**Chosen option:** Option C — Server-managed conversation state per board session

**Summary:** Server menyimpan full conversation thread per board session di DB. Client hanya mengirim message baru. Server reconstruct thread untuk setiap LLM call dan apply `cache_control` pada static system prompts (mendukung Anthropic prompt caching untuk efisiensi).

**Rejected options:**
- Option A (separate endpoints per input type): Ditolak karena memaksa client track state, menghambat future memory persistence.
- Option B (type flag di request body): Ditolak karena masih client-managed state, tidak ideal untuk prompt caching.

**Key tradeoffs accepted:**
- Conversation state disimpan di DB → lebih complex schema, tapi mendukung persistence + caching
- 1 template saja di MVP → scope terkontrol, validasi lebih cepat, template quality lebih terjaga
- Thin execution (1 card) → sidesteps OQ3 (cross-card handoff) sepenuhnya; OQ3 adalah Phase 2

---

## Schema Additions

```sql
-- New tables (additive — tidak mengubah existing tables)

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
  id           SERIAL PRIMARY KEY,
  board_id     INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent card execution output (TIDAK menulis ke card_events — isolated dari human kanban)
CREATE TABLE IF NOT EXISTS agent_card_outputs (
  id           SERIAL PRIMARY KEY,
  board_id     INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
  column_slug  TEXT NOT NULL,
  card_index   INTEGER NOT NULL DEFAULT 0,
  output       TEXT NOT NULL,
  thinking     TEXT,       -- chain-of-thought jika reasoning = true
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nullable board_id di columns (agent columns akan punya board_id non-null via new agent routes)
ALTER TABLE columns ADD COLUMN IF NOT EXISTS board_id INTEGER REFERENCES agent_boards(id) ON DELETE CASCADE;

-- CRITICAL: GET /board WAJIB diupdate ke WHERE board_id IS NULL setelah ALTER ini
```

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Chat input after approval | Assumed: disabled, right panel read-only log | Minor UX confusion — low risk |
| Column pertama dijamin ≥1 card | Template Research & Report dijamin hardcoded ≥1 card per column | N/A — template controlled |
| SSE reconnect saat user return selama execution | Assumed: load execution_status dari DB, reconnect SSE jika status = 'running' | User lihat stale log — medium risk |
| Template 2 dan 3 | Deferred ke Phase 3 | N/A — explicitly out of scope |

---

## Implementation Notes

- `GET /board` query di `routes.ts` WAJIB diupdate ke `WHERE columns.board_id IS NULL` sebelum agent columns bisa exist di DB. Ini adalah migration concern kritis.
- Agent card events (output execution) TIDAK boleh masuk `card_events` dan TIDAK boleh muncul di human kanban Activity Feed.
- Load dari `/history` ke `/agent` = read-only replay. Guard eksplisit: jangan re-trigger execution saat load board yang sudah `execution_status != 'idle'`.
- Prompt caching: apply `cache_control: { type: "ephemeral" }` pada system prompt messages di conversation thread (static per template).
- `@anthropic-ai/sdk` hanya di `server/package.json` — client tidak boleh import SDK ini.

---

## Rollback Plan

- Drop tabel `agent_boards`, `agent_conversations`, `agent_card_outputs` (data loss agent sessions only — human kanban tidak terpengaruh)
- Remove `columns.board_id` column (safe jika semua agent columns sudah di-cascade delete)
- Revert `GET /board` filter ke original
- Remove `/agent` dan `/history` routes dari Express dan React router
- Human kanban tidak memerlukan rollback — tidak ada perubahan ke existing flow
