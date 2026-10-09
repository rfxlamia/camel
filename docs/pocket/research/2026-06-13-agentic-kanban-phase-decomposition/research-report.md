# Research Report — Agentic Kanban: Phase Decomposition Validity

- **Date:** 2026-06-13
- **Verdict:** Confirmed
- **Confidence:** medium

## Assumption tested

Direction A (Template Board + AI Workers) dapat diisolasi sebagai grinding Phase 1 yang self-contained — 7 open questions dari pitch dapat dipilah menjadi Phase 1 blockers vs deferrable — tanpa ada OQ yang memblok Direction A tapi tidak teridentifikasi di pitch.

**Disconfirming observation:** Ditemukan ≥1 OQ yang tidak bisa di-defer DAN berada di luar Direction A scope.

## Methods used

- Assumption Mapping (analytical) — memetakan 7 OQ ke komponen Direction A, rank by impact × uncertainty
- Steelmanning (adversarial) — membangun argumen terkuat bahwa Direction A TIDAK bisa jadi Phase 1 yang self-contained
- First-Principles Decomposition (analytical) — memecah Direction A ke atomic build steps dan memetakan OQ ke tiap step
- Empirical check (empirical) — grep codebase untuk memverifikasi tidak ada chat interface yang existing

## Evidence

| Finding | Source | Supports / Refutes |
|---------|--------|--------------------|
| Semua 5 blocking OQs (OQ1, OQ2, OQ3, OQ4, OQ6) berada dalam Direction A scope | pitch-exploration.md — OQ list vs Direction A definition | Supports |
| Natural seam ditemukan antara Step 5 (Approval Gate 1) dan Step 6 (worker execution) | First-Principles Decomposition (M3) | Supports partition claim |
| Tidak ada chat interface di codebase — OQ6 adalah greenfield build | `grep -ri chat client/src server/src` — zero chat feature hits | Supports (confirms OQ6 scope) |
| OQ5 (QA reject mechanism) dan OQ7 (monetization) dapat di-defer tanpa memblok Phase 1 | M1 mapping — OQ5 impact MEDIUM/LOW uncertainty, OQ7 fully business decision | Supports |
| OQ6 (HIGH uncertainty) jatuh di Phase 1A — membawa risiko arsitektur lebih tinggi dari yang pitch framing-kan | M1 × M3 reconciliation | Refutes "Phase 1A is low-risk" sub-claim |
| Phase 1A tanpa eksekusi tidak memvalidasi core non-dev bet ("agents that move cards") | Steelmanning point D + advisor curation | Refutes "Phase 1A = sufficient validation" |
| Direction A dan B lebih tipis batasnya — LLM template picker = minimal agentic reasoning | Steelmanning point C | Refutes "Direction A is safe from model dependency" |

## Curation notes

*Advisor curation pass dijalankan (bukan inline fallback).*

**Strongest support:** Semua 5 blocking OQs berada dalam Direction A scope — disconfirming observation literal tidak terjadi. Partisi berhasil.

**Strongest counter-evidence / tension:**
1. OQ6 rated HIGH uncertainty di Method 1 tapi ditempatkan di "safe" Phase 1A di Method 3 — ini kontradiksi internal yang harus diakui. Rekonsiliasi: OQ6 punya HIGH uncertainty untuk *optimal approach* tapi LOW uncertainty untuk *ability to decide and proceed* — berbeda dari OQ3 yang blockers di kedua dimensi.
2. Phase 1A (Steps 1–5, no execution) adalah unit *buildable* pertama tapi bukan unit *validatable* pertama. Non-dev validation membutuhkan setidaknya thin slice of execution.

**Remaining gap:** Tidak ada spike yang memvalidasi bagaimana cross-card handoff (OQ3) akan disolve secara teknis. Ini adalah uncertainty tertinggi di seluruh pitch dan tidak terjawab oleh research ini.

## Verdict & reasoning

Disconfirming observation yang dioperasionalisasikan di Phase 1 tidak terjadi: tidak ada OQ yang memblok Direction A tapi berada di luar scope-nya. Partisi valid. Confidence medium — bukan high — karena OQ6 (HIGH uncertainty untuk optimal approach) ada di Phase 1A, artinya phase pertama ini tidak bebas risiko arsitektur.

Temuan terpenting bukan pada verdict, tapi pada struktur yang ditemukan: Direction A secara natural terpecah menjadi dua sub-phase di seam antara Step 5 (approve plan) dan Step 6 (execute workers). Phase 1A hanya membangun plan generation; Phase 1B baru membangun eksekusi. Keduanya diperlukan agar validation non-dev demand bisa terjadi.

## Recommendation (non-binding)

**Pecah grinding menjadi tiga fase, bukan dua:**

### Grinding Phase 1: Intent → Plan → Approval (Direction A, Steps 1–5)
*Scope: chat UI, board agent (template picker), template library (3–5 template awal), board generation, Approval Gate 1*

Harus jawab dulu sebelum grinding:
- OQ1: Template selection mechanism — rekomendasikan **LLM classification dengan rule-based fallback** (hybrid) sebagai starting bet
- OQ2: 3–5 templates pertama — rekomendasikan **marketing pipeline, ops process, research report** sebagai starting set
- OQ6: Chat trigger mechanism — rekomendasikan **new REST endpoint** (simplest, refine to SSE/webhook nanti)

Deliverable: user bisa ketik intent di chat → lihat board plan ter-generate → approve atau reject. **Zero execution.** Ini buildable tapi belum validatable untuk core bet.

### Grinding Phase 2: Thin Execution Slice (Direction A, Steps 6–8 — minimal)
*Scope: satu worker type bisa execute satu card, async UX untuk in-progress state, QA column yang hanya flag (OQ5 deferred re-run), Approval Gate 2*

Harus jawab dulu sebelum grinding:
- OQ3: Cross-card handoff — **ini adalah blocker terbesar dan harus di-spike dulu sebelum Phase 2 grinding dimulai**. Rekomendasikan dedicated spike session: apakah shared context store (Redis), sequential card output passing, atau message-passing pattern.
- OQ4: Async progress UX — ini design problem, bisa diselesaikan di awal Phase 2 grinding itu sendiri

Deliverable: satu board request end-to-end bisa dijalankan dengan satu template. **Ini adalah unit pertama yang bisa dipakai untuk non-dev validation.**

### Grinding Phase 3: Full Direction A + Template Ecosystem
*Scope: semua 3–5 templates fully working, re-run mechanism (OQ5), template marketplace foundation, monetization groundwork (OQ7)*

Ini baru menjadi foundation untuk Direction B (dynamic board) di masa depan.

---

**Warning yang harus dibawa ke grinding:** Direction A vs Direction B batasnya lebih tipis dari yang pitch framing-kan. Begitu LLM digunakan untuk classify template, Anda sudah bergantung pada model capability. "Template-based = safe from model failure" adalah partial truth — template structure aman, tapi template selection tidak.

## Post-research additions (session 2026-06-13)

### OQ8: Intent underspecification — RESOLVED (not a new OQ, resolved by design)

Setelah research selesai, ditemukan bahwa pitch tidak memiliki mekanisme untuk menangani vague user input ("GIGO problem"). Ini adalah OQ8 yang tidak ada di pitch original.

**Resolution:** Generate-Explain-Refine pattern (Option B):
```
[User ketik intent]
       ↓
[Board Agent: best-guess template selection]
       ↓
[Board ter-generate]
       ↓
[Chat: jelaskan board yang dibuat + scope dalam bahasa natural]
       ↓
User setuju? → ✋ Approval Gate 1 → proceed
User tidak pas? → Chat tanya 1 pertanyaan spesifik → regenerate board
```
Pattern ini tidak melanggar chat/board separation dan tidak membuka Direction C (co-design). Semua tiga non-negotiable intact.

### Architectural constraint (tidak eksplisit di pitch): Columns = Agent Definition Bundles

Columns bukan label — setiap column adalah **system prompt untuk specialist agent**. User tidak bisa edit columns karena yang mereka edit adalah konfigurasi agent, bukan visual label. Ini adalah non-editable by design untuk non-dev users.

Implikasi:
- "Template" = bundel specialist agents yang sudah dikonfigurasi (column name + system prompt per column)
- Template picker memilih seluruh bundel, bukan hanya struktur
- OQ2 scope meluas: bukan hanya "nama template apa" tapi "system prompt specialist seperti apa untuk tiap column"
- Refine = regenerate seluruh board (bundel agent baru), bukan edit kolom individual
- Template quality menjadi critical path — template yang salah satu-satunya jalan keluarnya adalah regenerate dengan template lain

Contoh struktur template:
```
Template: Marketing Pipeline
  ├── Column "Research"    → system_prompt: "You are a market researcher. Given [intent]..."
  ├── Column "Ideation"    → system_prompt: "You are a creative strategist. Given [context]..."
  ├── Column "Storyboard"  → system_prompt: "You are a content planner. Given [context]..."
  ├── Column "Design"      → system_prompt: "You are a visual director. Given [context]..."
  └── Column "QA"          → system_prompt: "You are a brand guardian. Given [original intent + all outputs]..."
```

## What would change this verdict

- Ditemukan OQ yang memblok Direction A tapi tidak ada di 7 OQ yang terdaftar → verdict menjadi Inconclusive
- OQ3 (cross-card handoff) ternyata tidak bisa disolve tanpa mengubah arsitektur fundamental camel-kanban → Phase 1B scope meluas secara signifikan
- Spike OQ3 menunjukkan bahwa context sharing membutuhkan infrastructure yang tidak ada di camel dan tidak bisa dibangun di Phase 2 grinding → entire Direction A mungkin perlu di-rescope
