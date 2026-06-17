# Pitch Exploration: agent-tool-capabilities

Date: 2026-06-17 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement

Camel saat ini punya 2 tool (`web_search`, `create_file`) — agent bisa "berpikir" dan "menyimpan hasil", tapi tidak bisa "bekerja" secara luas. Agent tidak bisa membaca state board sendiri, meringkas informasi, menjalankan code, atau berinteraksi dengan dunia luar. Berbagai tipe user (PM, Developer, Designer, Team Lead, Solo Founder, Data Analyst) mengharapkan agent yang bisa menyelesaikan tugas nyata, bukan hanya generate text.

## Root Tension

Semakin banyak tool = semakin powerful, tapi juga semakin berisiko dan kompleks. Keseimbangan antara **capability** dan **governance** adalah inti desain — terlalu sedikit tool dan agent useless, terlalu banyak tanpa governance dan agent berbahaya.

## Key Constraints

- Tool registry sudah ada dengan pattern DI (confirmed via spike)
- Anthropic SDK support native `tool_use` (confirmed via spike)
- Pipeline synchronous saat ini (confirmed via spike)
- Non-dev users adalah target — tools harus invisible, outcomes terlihat
- Trust butuh transparency — user harus lihat apa yang agent lakukan
- Credential management diperlukan untuk tools yang akses external API
- Sandbox diperlukan untuk code execution

---

## Brainstorming Methods Used

### Question Storming — deep

Key insights:

- Granularity menentukan composability — 1 tool "research" vs 3 tools (search, extract, summarize)
- Tool discovery: agent pilih sendiri vs template-defined toolset
- Error handling menentukan reliability — graceful degradation vs retry vs halt
- Context management menentukan kualitas — setiap tool menghasilkan context baru
- Safety adalah spectrum — read-only aman, write butuh konfirmasi, destructive butuh approval berlapis

### First Principles Thinking — creative

Key insights:

- **Agent tanpa tool adalah chatbot** — tool membedakan agent dari assistant
- **User peduli outcomes, bukan tools** — tools harus invisible
- **Composition > collection** — 5 composable tools > 50 tools terpisah
- **Feedback loop wajib** — agent harus tahu apakah action berhasil atau gagal
- **Tool adalah contract** — input/output schema, error codes, side effects harus eksplisit

### Six Thinking Hats — structured

Key insights:

- **White Hat:** 2 tools ada, tool registry ada, Anthropic SDK support tool_use, pipeline synchronous
- **Yellow Hat:** Tool-enabled agent = digital worker, automation potential, competitive advantage
- **Black Hat:** Tool abuse, permission complexity, cost explosion, reliability, security
- **Green Hat:** "Board as tool" = toolset pertama, tool chains, negative tools
- **Red Hat:** User excitement + anxiety, trust building via transparency
- **Blue Hat:** Perlu taxonomy jelas, governance model, testing strategy, monitoring

### Role Playing — collaborative

Key insights:

- **PM:** butuh status report, competitor research, rekomendasi → board_read + web_search + document generation
- **Developer:** butuh test runner, code review, bug finding → code_execute + file_read
- **Designer:** butuh design research, wireframe, accessibility review → web_search + image analysis
- **Team Lead:** butuh progress summary, bottleneck identification, weekly report → board_query + aggregation
- **Solo Founder:** butuh market research, business plan, competitor monitoring → multi-tool combination
- **Data Analyst:** butuh data analysis, visualization, trend prediction → board_query + calculation

### Analogical Thinking — creative

Key insights:

- **Zapier/Make:** Trigger → Action pattern, credential management, error handling
- **GitHub Copilot:** Context awareness, inline suggestions, multi-file operations
- **ChatGPT Plugins:** Plugin discovery, capability negotiation, sandboxed execution
- **CI/CD Pipelines:** Step-based execution, artifact passing, parallel execution
- **Browser DevTools:** Inspection, breakpoints, step-through
- **Siri/Alexa:** Confirmation for destructive actions, disambiguation, graceful failure

---

## Advisor Synthesis

### Key Insights

1. **"Board as Tool" is the strongest Camel-specific thesis** — board primitives adalah natural Tier 0 toolset
2. **Tool taxonomy 3-tier:** Tier 0 (board primitives), Tier 1 (autonomous read-only), Tier 2 (write/destructive with confirmation)
3. **Composition > collection** — primitif yang bisa di-chain > monolithic tools
4. **Credential management adalah prerequisite** — design schema sekarang
5. **Artifact passing antar tools** — generalize dari `agent_card_outputs`

### Patterns

- **Governance:** Read-only = otonom, write = confirm, destructive = approve
- **Persona needs cluster ke 3 area:** Research/Search, Board Intelligence, Document Generation
- **Trigger implicit di Camel** — "user approve board → pipeline runs"

### Ideas Worth Pursuing

| # | Tool | Tier | Why |
|---|------|------|-----|
| 1 | `board_read` | 0 | Foundation. Semua persona butuh. |
| 2 | `board_query` | 0 | PM, Team Lead, Analyst. Enable "status report". |
| 3 | `text_summarize` | 1 | Pipeline glue. LLM-backed, no external API. |
| 4 | `code_execute` | 1→2 | Developer persona. Highest-leverage single tool. |
| 5 | `file_read` | 1 | Developer persona. Enable code review, bug finding. |
| 6 | `http_request` | 2 | Generalist, Analyst. Perlu confirmation + credential store. |

### Discarded

- **Tool marketplace** — Too early. Core primitives dulu.
- **Negative tools** — Governance policy, bukan tools.
- **Agent debugging tools** — SSE tool events sudah cover.
- **Visualization tool** — Downstream dari composition.
- **Monitoring/scheduling** — Workflow, bukan single tool.

---

## Spike Results

No spike needed. Unknowns sudah terjawab:

- Tool registry ada dan extensible (confirmed via code inspection)
- Anthropic SDK support `tool_use` natively (confirmed via existing implementation)
- Pipeline bisa handle tool execution (confirmed via `executeCardWithTools`)
- Sandbox architecture feasible (code execution pattern umum di AI agents)

---

## Problem Synthesis

**Problem:** Camel's agent punya 2 tools dari ~6 yang dibutuhkan untuk jadi genuinely useful. Agent bisa riset dan simpan hasil, tapi tidak bisa membaca state board sendiri, menjalankan code, meringkas informasi, atau berinteraksi dengan dunia luar.

**Root tension:** Capability vs governance — semakin powerful tools, semakin ketat governance yang dibutuhkan.

**Key constraints:** Tool registry ada, pipeline extensible, non-dev users target, trust butuh transparency.

**Success looks like:** Agent bisa menerima berbagai tipe request, memilih tools yang tepat, mengeksekusi dengan transparan, dan menghasilkan outcomes yang meaningful — dengan governance yang tepat untuk setiap risk tier.

---

## Approach Directions

### Direction A: Board-First — Fondasi dari Dalam

Mulai dari Tier 0 (board primitives) dan Tier 1 (text_summarize). Semua tool berjalan di dalam boundary Camel, zero external dependency.

**Scope:** `board_read`, `board_query`, `text_summarize`, `create_file` (ada), `web_search` (ada)

- **Fastest to value** — semua tool bisa diimplementasi tanpa infra baru
- **Zero security risk** — tidak ada external access
- **Validates tool architecture** sebelum tackle yang kompleks
− **Limited capability** — agent tidak bisa "bekerja" di luar board
− **Developer persona underserved** — tidak ada code execution atau file access

### Direction B: Universal Tools — Fondasi dari Luas

Bangun tool universal: `code_execute`, `file_read`, `http_request`. Ini unlock hampir semua use case.

**Scope:** Direction A + `code_execute` (sandboxed), `file_read`, `http_request`

- **Highest leverage** — code execution adalah "universal tool"
- **Developer persona terlayani** — code review, testing, debugging
- **Extensible** — `http_request` bisa integrate dengan API apapun
- **Complexity** — butuh sandbox, credential store, confirmation flow
- **Security risk** — code execution dan HTTP butuh governance ketat
- **Longer timeline** — lebih banyak yang harus dibangun

### Direction C: Hybrid — Board Primitives + One Killer Tool (RECOMMENDED)

Bangun Direction A, lalu tambah satu "killer tool": `code_execute`.

**Scope:** Direction A + `code_execute` (sandboxed)

- **Balanced** — value cepat + capability signifikan
- **Manageable risk** — hanya satu tool complex, bukan tiga
- **Validates sandbox architecture** sebelum expand
- **Developer persona partially terlayani**
− **`file_read` dan `http_request` deferred**

**Recommended: Direction C** — Board primitives memberi fondasi solid dan zero-risk. `code_execute` sebagai "killer tool" memberi capability leap tanpa complexity explosion.

---

## Tool Detail: 6 Fundamental Tools

### Tier 0 — Board Primitives (Otonom, Zero Risk)

#### 1. `board_read`

**Purpose:** Baca card contents, column state, board summary
**Input:** `{ scope: "card" | "column" | "board", id?: number }`
**Output:** Structured data (card details, column cards, board overview)
**Risk:** Read-only → otonom
**Use cases:**

- "Apa saja task yang belum selesai di board ini?"
- "Kasih saya summary dari column Research"
- "Card #42 isinya apa?"

#### 2. `board_query`

**Purpose:** Aggregate, filter, search across board state
**Input:** `{ query: string, filters?: { status?, assignee?, date_range? } }`
**Output:** Filtered/aggregated results
**Risk:** Read-only → otonom
**Use cases:**

- "Buat status report dari board ini"
- "Card apa yang sudah 3 hari tidak bergerak?"
- "Berapa banyak task yang selesai minggu ini?"

### Tier 1 — Autonomous Read-Only (Otonom, Low Risk)

#### 3. `text_summarize`

**Purpose:** Condense long text into key points
**Input:** `{ text: string, max_length?: number, format?: "bullets" | "paragraph" }`
**Output:** Summarized text
**Risk:** Read-only (LLM-backed, no external API) → otonom
**Use cases:**

- "Rangkum hasil research ini dalam 5 poin"
- "Buat executive summary dari document ini"
- "Simplify penjelasan teknis ini untuk non-technical audience"

#### 4. `web_search` (EXISTING)

**Purpose:** Search the web for current information
**Input:** `{ query: string }`
**Output:** Search results with titles, URLs, snippets
**Risk:** Read-only → otonom
**Status:** Sudah ada

### Tier 2 — Write/Destructive (Butuh Konfirmasi)

#### 5. `create_file` (EXISTING)

**Purpose:** Save markdown deliverable as board artifact
**Input:** `{ content: string, filename?: string }`
**Output:** Confirmation with filename
**Risk:** Write → butuh konfirmasi
**Status:** Sudah ada

#### 6. `code_execute`

**Purpose:** Execute code in sandboxed environment
**Input:** `{ language: "javascript" | "python" | "shell", code: string, timeout?: number }`
**Output:** stdout, stderr, exit code
**Risk:** Read-only (sandbox) → otonom untuk execute; Write (jika akses filesystem) → butuh konfirmasi
**Use cases:**

- "Jalankan test suite ini"
- "Parse CSV ini dan kasih statistiknya"
- "Buat chart dari data ini"
- "Validasi format email di list ini"
**Governance:** Sandbox tanpa network access default. File write butuh explicit confirmation.

---

## Tool Governance Model

```
┌─────────────────────────────────────────────────────────┐
│                    TIER 0: Board Primitives              │
│  board_read, board_query                                │
│  Risk: None                                             │
│  Approval: Otonom (tanpa konfirmasi)                    │
│  Logging: Tool execution logged di SSE                  │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│                  TIER 1: Autonomous Read-Only            │
│  web_search, text_summarize                             │
│  Risk: Low                                              │
│  Approval: Otonom (tanpa konfirmasi)                    │
│  Logging: Tool execution logged di SSE                  │
│  Rate limit: Per-board execution budget                 │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│               TIER 2: Write / Destructive               │
│  create_file, code_execute (file write mode)            │
│  Risk: Medium-High                                      │
│  Approval: User confirmation required                   │
│  Logging: Full audit trail                              │
│  Rate limit: Per-board + per-user budget                │
└─────────────────────────────────────────────────────────┘
```

---

## Artifact Passing Architecture

```
User Request
    │
    ▼
┌─────────────┐    research_output    ┌─────────────┐
│  Research    │ ──────────────────▶   │  Analysis   │
│  Specialist  │                       │  Synthesizer│
└─────────────┘                       └─────────────┘
                                              │
                                        analysis_output
                                              │
                                              ▼
                                       ┌─────────────┐    revised_document
                                       │   Writer    │ ──────────────────▶
                                       └─────────────┘
                                                        │
                                                        ▼
                                                 ┌─────────────┐
                                                 │   Editor    │
                                                 └─────────────┘
                                                        │
                                                  revised_document
                                                        │
                                                        ▼
                                                 ┌─────────────┐  create_file
                                                 │ QA Guardian │ ──────────▶ Artifact
                                                 └─────────────┘
```

Setiap tool menghasilkan output yang disimpan di `agent_card_outputs`. Tool berikutnya bisa mengakses output sebelumnya melalui context injection di system prompt.

---

## Credential Store Schema (Future)

```sql
CREATE TABLE agent_credentials (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER REFERENCES workspaces(id),
    service_name TEXT NOT NULL,  -- 'tavily', 'github', 'jira', etc.
    credential_type TEXT NOT NULL,  -- 'api_key', 'oauth', 'basic_auth'
    credential_data JSONB NOT NULL,  -- encrypted
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, service_name)
);
```

Ini tidak perlu diimplementasi sekarang, tapi schema harus di-design agar tidak breaking change nanti.

---

## Implementation Priority

### Phase 1: Foundation (Week 1-2)

1. `board_read` — Tier 0, zero risk, immediate value
2. `board_query` — Tier 0, zero risk, enables status reports
3. `text_summarize` — Tier 1, LLM-backed, pipeline glue

### Phase 2: Power Tool (Week 3-4)

4. `code_execute` — Tier 1→2, sandboxed, highest leverage

### Phase 3: External Access (Week 5+, Future)

5. `file_read` — Tier 1, needs scope definition
2. `http_request` — Tier 2, needs credential store

---

## Appendix: User Stories

### Product Manager
>
> "Buat status report dari board ini dan rangkum dalam 5 poin"

- Tools: `board_query` → `text_summarize` → `create_file`

### Developer
>
> "Jalankan test suite ini dan kasih tahu yang gagal dengan detail"

- Tools: `code_execute` (read-only mode)

### Designer
>
> "Riset design trends untuk mobile app dan kasih rekomendasi"

- Tools: `web_search` → `text_summarize` → `create_file`

### Team Lead
>
> "Identifikasi bottleneck di workflow tim ini minggu lalu"

- Tools: `board_query` (with date filter) → `text_summarize`

### Solo Founder
>
> "Riset competitor pricing dan buat comparison table"

- Tools: `web_search` → `text_summarize` → `code_execute` (generate table) → `create_file`

### Data Analyst
>
> "Analisis data di board ini dan buat summary statistik"

- Tools: `board_query` → `code_execute` (statistical analysis) → `create_file`
