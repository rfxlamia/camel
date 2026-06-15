# Pitch Exploration: agent-tool-system
Date: 2026-06-15 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement
Camel saat ini memiliki agent yang hanya bisa "berpikir" (generate text via LLM) tapi tidak bisa "bekerja" (interact with the real world). Tanpa tool system, agent terjebak sebagai chatbot yang menempel di kanban board — powerful dalam reasoning, tapi helpless dalam execution. User tidak bisa delegate research, code execution, data processing, atau integration tasks ke agent karena tidak ada mekanisme untuk agent berinteraksi dengan dunia di luar board.

## Root Tension
User menginginkan agent yang bisa "bekerja nyata" (research, code, integrate, automate), tapi memberi agent kemampuan action memperkenalkan risiko, kompleksitas, dan cost. Keseimbangan antara **capability** dan **safety** adalah inti dari desain ini — terlalu sedikit tool dan agent useless, terlalu banyak tanpa governance dan agent berbahaya.

## Key Constraints
- Current architecture **tidak punya tool abstraction** — harus dibangun dari nol (confirmed via spike)
- Anthropic SDK **sudah support** `tool_use` natively — bisa leverage ini (confirmed via spike)
- SSE streaming **sudah jalan** — bisa reuse untuk tool execution progress (confirmed via spike)
- Dependency injection pattern **sudah ada** di `service.ts` — tools harus follow pattern yang sama (confirmed via spike)
- Pipeline **synchronous** saat ini — long-running tools butuh async handling (confirmed via spike)
- Hanya ada **1 template** (research-report) — tool system harus template-agnostic
- **Non-dev users** adalah target audience — tool interface harus invisible, yang terlihat outcomes
- **Trust butuh transparency** — user harus bisa lihat apa yang agent lakukan secara real-time

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Apa batasan antara "tool" dan "capability"? Web search bisa jadi 1 tool atau N tools (search, extract, crawl) — granularity matters
- Bagaimana agent tahu tool mana yang relevan? Tool discovery mechanism adalah architectural decision, bukan afterthought
- Tool failure handling adalah design decision: graceful degradation vs retry vs halt

### First Principles Thinking — creative
Key insights:
- **Agent tanpa tool adalah chatbot** — tool adalah yang membedakan agent dari assistant
- **User tidak peduli tentang tools** — mereka peduli tentang outcomes. Tools harus invisible
- **Composition > collection** — 5 composable tools lebih powerful dari 50 tools terpisah
- **Feedback loop wajib** — agent harus tahu apakah tool execution berhasil atau gagal

### Six Thinking Hats — structured
Key insights:
- **White Hat:** Camel punya board CRUD, SSE, LLM call — tapi tidak ada tool abstraction
- **Yellow Hat:** Tool-enabled agent bisa handle repetitive tasks → user fokus pada creative work
- **Black Hat:** Tool abuse, permission complexity, cost explosion, reliability, security
- **Green Hat:** "Board as tool" — board primitives adalah toolset pertama agent. Skill marketplace untuk masa depan.

### What If Scenarios — creative
Key insights:
- **Code execution** adalah "universal tool" — satu capability ini unlock data processing, API integration, file manipulation, report generation
- **Async execution** memungkinkan agent untuk long-running tasks (web crawl, deployment) tanpa blocking
- **Tool memory** (agent ingat results dari masa lalu) adalah optimization, bukan foundation

### Role Playing — collaborative
Key insights:
- Setiap "need" dari user role (PM butuh status reports, designer butuh Figma integration) sebenarnya adalah **workflow**, bukan tool — synthesis harus reframe: apa **atomic tools** yang enable workflows tersebut?
- Pain point universal: context switching antara board dan tools lain — agent harus bridge ini

---

## Advisor Synthesis
Advisor meng-kurasi hasil brainstorming menjadi beberapa poin kunci: (1) **"Board as tool"** adalah thesis paling Camel-specific — board primitives sudah jadi toolset pertama, (2) reframe user needs sebagai workflows lalu identifikasi atomic tools, (3) **composition > collection** adalah architectural thesis, (4) **sandboxed code execution** adalah single highest-leverage capability, dan (5) **tool governance model** (read-only auto-approved, write confirmation, destructive explicit approval) harus didesain sejak awal. Advisor juga mengidentifikasi tool taxonomy 4-tier dan merekomendasikan spike pada arsitektur agent execution.

---

## Spike Results

**Unknown resolved:** Bagaimana arsitektur agent execution di Camel saat ini?

**Finding:** Agent execution berjalan melalui pipeline: `routes.ts` → `service.ts` (DI factory) → `llm.ts` (Anthropic SDK). Key findings:
- `executeCard` memanggil `client.messages.stream()` tanpa `tools` parameter — tidak ada tool/function calling
- Anthropic SDK sudah support `tool_use` natively — ini integration point yang natural
- Dependency injection di `service.ts` berarti tool execution bisa di-inject dan di-test
- Pipeline synchronous (await each card) — butuh async pattern untuk long-running tools
- SSE streaming sudah jalan dengan token batching 200ms — bisa reuse untuk tool progress

**Implication:** Integrasi tools ke existing architecture adalah **incremental change** (tambah `tools` parameter ke `executeCard` + tool execution handler), bukan rewrite. Pattern yang sama (DI) bisa diikuti.

---

## Approach Directions

### Direction A: Tool-First — Build Specific Tools Incrementally
Bangun tools satu per satu sebagai standalone modules: web search dulu, lalu code execution, lalu file system, dst. Setiap tool punya interface sendiri.
+ Clear progress — setiap tool independently useful dan bisa di-validate dengan user
+ Reduced risk — satu tool gagal tidak affect yang lain
− Potensi inconsistent interfaces antar tools
− Lama sampai agent punya "critical mass" of tools

### Direction B: Infrastructure-First — Build the Tool Framework First
Desain tool abstraction layer, execution engine, dan governance model terlebih dahulu. Baru bangun tools di atas framework tersebut.
+ Consistent interface untuk semua tools
+ Better composability — tools bisa di-chain
+ Easier to add tools di masa depan
− Delayed value — tidak ada tools sampai framework selesai
− Risk of over-engineering sebelum validated dengan user

### Direction C: Hybrid — Native Tool Use + Thin Abstraction Layer
Gunakan Anthropic SDK's native `tool_use` untuk LLM integration. Bangun thin abstraction layer di atasnya untuk provider-agnosticism. Mulai dengan Tier 1 tools (read-only) sebagai validation, lalu tambah Tier 2 (code execution) sebagai "universal tool."
+ Fastest to working prototype — leverage existing SDK capabilities
+ Natural fit dengan current architecture (inject tools ke `executeCard`)
+ Thin layer = tidak over-engineering, tapi tetap extensible
+ Incremental — bisa mulai dengan 1-2 tools, expand berdasarkan user feedback
− Sedikit coupling ke Anthropic SDK (mitigated by thin abstraction)

---

## Open Questions for pocket-grinding
- [ ] Apa exact JSON schema untuk tool definitions yang compatible dengan Anthropic SDK's `tool_use`?
- [ ] Bagaimana tool execution loop bekerja? (LLM returns tool_use → agent executes → feeds result back → LLM continues)
- [ ] Apakah `executeCard` perlu di-refactor menjadi `executeWithTools` atau cukup tambah parameter?
- [ ] Bagaimana governance model bekerja secara teknis? (tool approval flow, SSE events untuk tool calls, user confirmation UI)
- [ ] Apa minimum viable tool set untuk validate agentic kanban concept? (1-2 tools pertama)
- [ ] Bagaimana async execution bekerja untuk long-running tools? (polling vs callback vs SSE)
- [ ] Apakah ada cost implications dari tool calls? (token usage, API costs)
- [ ] Bagaimana tool results di-persist? (new table atau extend `agent_card_outputs`?)

---

## Recommended Direction
Direction C (Hybrid — Native Tool Use + Thin Abstraction Layer) — fastest to value, natural fit dengan existing architecture, incremental validation, dan extensible untuk masa depan.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction C as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- Refer to spike results (`server/src/agent/llm.ts`, `service.ts`, `templates.ts`) untuk architectural context
- Refer to existing pitch `docs/pocket/spec/2026-06-13-agentic-kanban/pitch-exploration.md` untuk broader agentic kanban context
