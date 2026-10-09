# Pitch Exploration: agentic-kanban-phase2-full-pipeline
Date: 2026-06-14 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement

Pipeline 5-card (Research → Analysis → Writer → Editor → QA) hanya mengeksekusi card pertama karena `executeCard` menerima `previousOutputs: string[]` generik, sedangkan template menggunakan named placeholders (`{research_output}`, `{analysis_output}`, dll) yang tidak pernah diresolvkan.

## Root Tension

Service layer vs LLM layer — siapa yang bertanggung jawab membangun named-output map dan meresolvkan placeholder sebelum tiap LLM call, tanpa melanggar separation of concerns yang ada.

## Key Constraints

- `renderSystemPrompt` di `templates.ts` sudah ada: membiarkan unmatched placeholder **intact** — jadi named map harus lengkap sebelum dikirim ke fungsi ini
- `agent_card_outputs` sudah ada di DB dari Phase 1 — tersedia sebagai accumulator antar-card
- MiMo tidak support `thinking` atau `cache_control` — card dengan `reasoning: true` harus skip gracefully
- SSE via `realtime.ts` sudah ada — tinggal tambah event types baru (`card:start`, `card:complete`, `card:failed`)
- `executeCard` dipanggil satu kali sekarang; perlu dibungkus dalam loop tanpa blocking event loop (async/await, bukan spawn)
- Pipeline bisa berjalan 5–15 menit untuk 5 LLM call — harus decoupled dari request HTTP (fire-and-forget)

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Siapa yang trigger eksekusi card ke-2: client, server, atau card sebelumnya? → Server (loop otonom)
- Bagaimana "previous output" diakses oleh card berikutnya? → Via DB `agent_card_outputs`, bukan in-memory
- Apakah pipeline berhenti jika satu card gagal? → Ya (minimal failure semantics wajib)
- Apakah output tiap card di-stream ke client atau hanya setelah selesai? → SSE event per card milestone, token stream optional
- Siapa yang mengatur urutan eksekusi? → Template definition (position field)

### First Principles Thinking — creative
Key insights:
- "Client harus trigger setiap card" adalah asumsi yang salah — server bisa loop autonomous setelah approval
- Pipeline = fungsi `runPipeline(boardId)` yang loop tiap card: executeCard → simpan output → SSE event → next
- `previousOutputs: string[]` adalah shape yang salah — harus `Record<slug, output>` agar named placeholders bisa resolved
- `renderSystemPrompt` sudah mendukung `Record<string, string>` — tinggal isi dengan map yang benar

### Six Thinking Hats — structured
Key insights:
- (White) Template sudah mendefinisikan urutan via `position: 1-5`; `agent_card_outputs` sudah ada untuk chain
- (Yellow) Server-side loop sederhana: tidak perlu protokol baru; SSE events per card memberikan visibility real-time
- (Black) Pipeline 5-15 menit membutuhkan decoupling dari HTTP request; SSE disconnect tidak boleh kill pipeline
- (Green) Per-card DB persistence = seam untuk future resume-on-restart gratis (simpan sekarang, build nanti)
- (Blue) Scope: server-side loop + named-output resolution + SSE card events. Out of scope: retry UI, parallel cards, job queue

### Constraint Mapping — deep
Key insights:
- "Client harus trigger setiap card" dan "pipeline harus blocking" adalah constraint imajiner — bukan real
- Fire-and-forget + SSE menyelesaikan dua concern sekaligus: timeout dan disconnect safety
- `renderSystemPrompt` sudah bisa menerima map yang benar; hanya input yang perlu diubah
- Named slug accumulation sudah dicakup oleh template design: tiap placeholder adalah slug card sebelumnya

---

## Advisor Synthesis

Advisor mengkonfirmasi bahwa akar masalah bukan "build the loop" melainkan "handoff broken by design": Writer butuh dua predecessor (`{research_output}` AND `{analysis_output}`), bukan hanya immediate predecessor. Named-output map (`Record<slug, output>`) adalah fix yang diperlukan. Semua 4 method convergent pada server-side async loop + per-card DB persistence + SSE per transition. Parallel cards, BullMQ, dan retry UI dibuang — inherently sequential dan YAGNI untuk fase ini. Minimal failure semantics (halt + FAILED status) harus dalam scope.

---

## Approach Directions

### Direction A: Service-layer accumulator (executeCard stays dumb)
`runPipeline` di `service.ts` membangun `{ slug → output }` map dari DB setelah tiap card selesai. Sebelum memanggil `executeCard`, service meresolvkan seluruh placeholder dan meneruskan system prompt yang sudah fully-rendered. Signature `executeCard` di `llm.ts` tidak berubah.
+ Perubahan minimal pada `llm.ts`; separation of concerns terjaga; DB sudah jadi source of truth
− Service perlu tahu bahwa placeholder mengikuti pola slug (ringan tapi ada coupling)

### Direction B: executeCard receives named map
Ubah signature `executeCard` menjadi menerima `Record<string, string>` sebagai `previousOutputs`. `executeCard` sendiri yang memanggil `renderSystemPrompt` dengan map tersebut.
+ LLM layer self-contained, lebih testable secara isolated
− Breaking change pada semua caller; `llm.ts` menjadi aware terhadap template structure

### Direction C: Template-driven resolver sebagai pure function
Tambah fungsi `resolvePrompt(column, accumulator)` di `templates.ts` sebagai pure function terpisah dari `executeCard`. Service memanggil resolver dulu, lalu pass hasil ke `executeCard` yang tidak berubah.
+ Paling testable; pisahan concerns paling clean; mudah extend untuk template lain
− Satu abstraksi tambahan yang mungkin prematur untuk pipeline 1 template saat ini

---

## Open Questions for pocket-grinding

- [ ] Apakah `writer` column butuh akses `research_output` dan `analysis_output` secara eksplisit, atau cukup concatenated blob? (cek system prompt templates.ts:127-161)
- [ ] Bagaimana `topic` placeholder (dipakai di Research + Analysis prompt) diresolvkan — dari intent atau dari board metadata?
- [ ] Apakah `agent_card_outputs` schema sudah punya kolom `card_slug` atau hanya `card_id`? (cek agent-schema.sql)
- [ ] SSE event schema apa yang harus dikirim saat `card:start` dan `card:complete` agar client bisa update board state?
- [ ] Apakah service sudah punya wrapper untuk SSE fan-out, atau harus import `realtime.ts` langsung?

---

## Recommended Direction

Direction A — perubahan terkecil, tidak ada breaking change ke `llm.ts`, service sudah punya DB access dan SSE, dapat difaktorkan ke Direction C jika template kedua ditambahkan nanti.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction A as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets — terutama named-output map shape dan `topic` resolution
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- Key file refs: `server/src/agent/llm.ts` (executeCard), `server/src/agent/service.ts` (business logic), `server/src/agent/templates.ts` (renderSystemPrompt + placeholder schema), `server/src/db/agent-schema.sql` (output storage)
