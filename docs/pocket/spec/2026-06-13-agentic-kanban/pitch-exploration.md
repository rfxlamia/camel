# Pitch Exploration: agentic-kanban
Date: 2026-06-13 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement

Non-dev business teams (marketing, ops, support) tidak punya cara untuk delegate pekerjaan ke AI agents sambil tetap memiliki visibility dan kontrol — semua tool yang ada memaksa mereka memilih antara "AI yang powerful tapi black box" (pure chat) atau "visible tapi developer-only" (existing kanban-for-AI tools).

## Root Tension

Non-dev users menginginkan outcomes tanpa complexity, tapi AI agents butuh oversight untuk bisa dipercaya — board adalah bet bahwa visibility > simplicity untuk adoption.

## Key Constraints

- Competitor monetization path (free-majority) sudah terbukti tidak sustainable — Vibe Kanban sunset karena business model failure, bukan demand failure
- Non-dev validation masih kosong — semua existing kanban-for-AI tools (Vibe Kanban, KaibanJS, Agent Kanban) 100% developer-focused
- Direction B (fully dynamic board agent) sangat bergantung pada model capability dan system prompt quality — terlalu gambling untuk MVP
- Async UX (agents kerja menit–jam) belum ada template proven; perlu design khusus untuk progress visibility
- Camel sudah punya primitif yang dibutuhkan: workspace, board, columns, cards, SSE real-time, multi-workspace, team collaboration

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Unknown paling kritis: apakah business users mau AI yang *move* cards mereka, atau hanya *assist* mereka?
- "Board as specialist agent" perlu definisi konkret sebelum bisa dibangun
- Kapan human-in-the-loop terjadi adalah pertanyaan desain, bukan pertanyaan teknis
- Apa minimum viable agentic workflow yang bisa divalidate dengan non-dev users?

### First Principles Thinking — creative
Key insights:
- Kanban board bukan task management tool — ini visibility system untuk work in progress
- Untuk agentic work, yang dibutuhkan bukan "manage tasks" tapi "trust dan oversight"
- Core truth: **Board adalah control room, bukan workflow builder**
- Users tidak ingin manage agents — mereka ingin hasil; board hanya perlu membuktikan AI sedang on-track

### Six Thinking Hats — structured
Key insights:
- Non-dev market benar-benar underserved di AI orchestration space — semua tool ada target developers
- "Cards yang mengerjakan dirinya sendiri" terasa magical jika berhasil, menakutkan jika gagal tanpa warning
- Board memberikan solusi "black box AI" problem — user bisa lihat tanpa harus bertanya
- QA sebagai mandatory last column adalah satu-satunya entity yang hold original intent + final output

### Analogical Thinking — creative
Key insights:
- Kitchen brigade (tickets = cards, "fired" = done) adalah native kanban metaphor yang sudah exist di dunia nyata
- Pattern lintas semua analogi: hierarchical orchestration bekerja dengan exception-based reporting, bukan micromanagement
- Kanban board = async status communication layer antara orchestrator dan workers — value-nya bukan workflow building, tapi *"aku bisa lihat apa yang terjadi tanpa harus bertanya"*

---

## Advisor Synthesis

Semua 4 method konvergen di satu core insight: nilai board adalah oversight dan trust, bukan task management — ini yang harus jadi primary value proposition, bukan arsitektur 3-lapisan. Tension yang belum terjawab dan paling menentukan: jika non-dev users express intent via chat dan mau outcomes, kenapa mereka butuh board sama sekali? Seluruh pitch adalah satu bet: visual oversight cukup berharga sehingga non-dev users memilih kanban tool daripada pure chat. Dua approval gates (approve-plan + QA-validate) adalah spine dari konsep ini — tanpa keduanya, sistem kehilangan oversight di titik yang paling dibutuhkan non-dev users.

---

## Spike Results

**Unknown resolved:** Kenapa Vibe Kanban (26.9k stars) sunset?
**Finding:** Monetization failure, BUKAN demand failure. Ribuan software engineers pakai setiap hari, tapi vast majority free users; Bloop tidak bisa menemukan business model yang sustainable. Project dilanjutkan sebagai Apache 2.0 open-source.
**Implication:** Kanban-for-AI concept terbukti ada demand-nya (developer market). Non-dev market belum pernah dicoba. Warning utama bukan "apakah konsep ini bekerja" melainkan "bagaimana cara monetize ketika mayoritas users akan gratis."

---

## Architecture Mapping (settled during pitch)

```
Chat    → intent capture only; TIDAK pernah mengeksekusi apapun
Board   → satu job / satu request ("Q3 Presentation")
Columns → specialist agents yang dibutuhkan (Research | Ideation | Storyboard | Design | QA)
Cards   → worker agents yang mengeksekusi satu subtask spesifik
QA      → mandatory last column; satu-satunya agent yang hold original intent + final output
```

Flow dengan approval gates:
```
[Chat: capture intent]
  → [Board Agent: generate plan (columns + cards)]
  → ✋ USER APPROVE PLAN
  → [Workers execute per card]
  → ✋ QA GATE: original intent vs final output
  → Done
```

---

## Approach Directions

### Direction A: Template Board + AI Workers (MVP — Recommended)
Board structures adalah pre-defined templates (marketing, support, research, ops). Board agent memilih template yang cocok berdasarkan intent dari chat, lalu generate cards sebagai workers di dalam setiap column.
+ Fastest path to non-dev usability — recognizable structure, tidak perlu trust AI-invented plan
+ Community template marketplace = clear ecosystem play dan monetization path
− "Board agent" hanya template-picker, belum benar-benar agentic reasoning
− Request yang tidak cocok dengan template akan kaku

### Direction B: Fully Dynamic Agentic Board (Long-term Vision)
Board agent sepenuhnya menginvent board per request: columns apa (specialists apa), cards apa (workers apa). User approve rencana sebelum eksekusi. QA column always last.
+ Paling terdiferensiasi; board benar-benar adalah agent yang reason tentang workflow
+ Dua approval gates menjadi safety mechanism yang sufficiently non-threatening untuk non-dev
− Sangat bergantung pada model capability dan system prompt quality
− Jika board agent generate rencana yang jelek, non-dev users tidak bisa judge tanpa help

### Direction C: Chat-Driven Collaborative Planning
Chat dan user co-design board secara interaktif — AI menyarankan columns, user adjust, baru cards di-generate dan dieksekusi.
+ Non-dev users merasa paling in control
− Merusak separasi bersih chat/board yang merupakan insight arsitektur terkuat
− Decision fatigue untuk non-dev users

---

## Open Questions for pocket-grinding

- [ ] Bagaimana cara board agent memilih template yang tepat berdasarkan intent chat — rule-based, LLM classification, atau hybrid?
- [ ] Apa 3-5 template pertama yang paling valuable untuk non-dev users? (marketing pipeline, support triage, research report, ops process?)
- [ ] Bagaimana workers (cards) share context satu sama lain tanpa merusak isolation per-card? (cross-card handoff mechanism)
- [ ] Bagaimana async progress UX — apa yang user lihat ketika agent sedang "working" selama beberapa menit?
- [ ] Apakah QA column bisa reject dan trigger re-run pada specific cards, atau hanya flag ke user?
- [ ] Bagaimana board agent di-trigger dari chat — SSE event baru, webhook, atau chat API endpoint tersendiri?
- [ ] Monetization: apakah template library free semua (ecosystem play) atau ada official premium templates?

---

## Recommended Direction

Direction A (MVP) menuju Direction B (visi) — validate non-dev demand dan template-fit dulu dengan MVP yang manageable, sebelum betting pada dynamic board generation yang bergantung penuh pada model capability.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction A as the working hypothesis untuk MVP
- Direction B tetap sebagai long-term architecture target — jangan discard, tapi jangan jadi scope MVP
- Treat Open Questions di atas sebagai Phase 3 Discovery targets
- Do NOT treat Approach Directions sebagai final architecture — validate through GWT first
- Key non-negotiables dari pitch: (1) chat tidak pernah execute, (2) QA column selalu ada, (3) dua approval gates adalah spine dari sistem
