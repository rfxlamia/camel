# Pitch Exploration: team-collaboration
Date: 2026-06-10 | Project: Camel | Status: pitch-only

---

## Problem Statement
Small dev team (5-6 orang) tidak bisa menggunakan Camel secara bersamaan karena tidak ada cara untuk: (1) melihat siapa yang sedang mengerjakan card, (2) melihat perubahan yang dibuat orang lain secara real-time, (3) berkomunikasi tentang card tertentu tanpa keluar dari board.

## Root Tension
Kesederhanaan (single-user, local) vs kolaborasi (multi-user, real-time). Menambah kolaborasi meningkatkan complexity, tapi tanpa itu Camel hanya berguna untuk individual, bukan team.

## Key Constraints
- Small team (5-6 orang) — toleransi eventual consistency tinggi
- Existing PostgreSQL — bisa extend schema untuk data layer (optimistic locking, activity feed)
- ⚠️ PostgreSQL TIDAK cukup untuk real-time notifications — perlu Redis (see research report)
- Existing `card_events` — bisa extended untuk audit trail
- Pragmatic incrementalism — polling dulu sebelum WebSocket
- Single-user app saat ini — tidak ada auth, tidak ada multi-user support

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Core question: "Apa yang terjadi ketika 2 orang drag card yang sama secara bersamaan?"
- Visibility adalah kebutuhan dasar — semua stakeholder ingin tahu "siapa sedang apa"
- Conflict resolution harus sederhana — notify user, biarkan human resolve

### First Principles Thinking — creative
Key insights:
- Kolaborasi terjadi ketika ≥2 orang bekerja pada shared resource (board)
- Shared resource membutuhkan mekanisme untuk mencegah conflict (race condition)
- Manusia perlu tahu "siapa sedang apa" untuk koordinasi (visibility)
- Trust dibangun dari transparency — siapa yang melakukan perubahan, kapan, mengapa

### Six Thinking Hats — structured
Key insights:
- White Hat: PostgreSQL sudah ada, `card_events` sudah ada, bisa extend
- Green Hat: Mulai dari "presence" saja dulu, polling 30s sebelum WebSocket
- Black Hat: Complexity meningkat — auth, WebSocket, conflict resolution
- Yellow Hat: Real-time sync → team bisa kerja bersama tanpa conflict

### Role Playing — collaborative
Key insights:
- Developer (IC): Ingin tahu apakah card sedang dikerjakan orang lain
- Team Lead: Ingin tahu siapa yang overloaded, ingin activity feed
- Product Manager: Ingin tahu progress tanpa tanya orang satu-satu
- New Member: Ingin tahu siapa yang online, ingin context sebelum join

---

## Advisor Synthesis
Advisor mengkonfirmasi bahwa **visibility adalah core need** — semua stakeholder ingin "melihat" dalam bentuk berbeda. **Presence adalah fondasi** — prerequisite untuk semua hal lain. **Concurrency control adalah masalah tersulit**, tapi jawaban pragmatis: optimistic update + rollback (bukan locking). Pola yang muncul: **layered approach** (Auth → Presence → Real-time → Activity), **visibility first**, **optimistic over pessimistic**, **small team = simpler rules**.

---

## Spike Results

**Unknown resolved:** Data model untuk users, presence, dan conflict resolution
**Finding:** 
- Current schema tidak ada `version`/`updated_at` column — perlu tambah untuk optimistic locking
- Optimistic locking: tambah `version` column ke `cards`, update pakai `WHERE version = expected_version`
- Presence: `user_sessions` table dengan heartbeat (last_seen_at)
- Conflict resolution: optimistic update + rollback, notify user, biarkan human resolve
**Implication:** Optimistic locking dan activity feed viable di PostgreSQL. Tapi real-time notifications TIDAK — LISTEN/NOTIFY punya fundamental issues (global lock di COMMIT, no persistence, PgBouncer incompatibility). Perlu Redis untuk real-time layer.

---

## Approach Directions

### Direction A: Presence-First + Redis Hybrid (Recommended)
Tambahkan fitur kolaborasi secara incremental dengan hybrid approach: PostgreSQL untuk data layer, Redis untuk real-time layer.

**Layer 1 — PostgreSQL (data layer):**
- Auth → Optimistic Locking (`version` column) → Activity Feed (JSONB + timestamp)

**Layer 2 — Redis (real-time layer):**
- Presence tracking (Redis key TTL + heartbeat)
- Real-time event notification (Redis Pub/Sub → SSE ke client)

+ Incremental, low risk, bisa deliver value cepat
+ Real-time notifications reliable (Redis purpose-built untuk ini)
+ PostgreSQL tidak dipaksa melakukan yang bukan kekuatannya
− Tambah satu infra component (Redis) — tapi cost sangat rendah (satu Docker container)

### Direction B: PostgreSQL-Only (Polling + SSE)
Tetap gunakan PostgreSQL saja, tanpa Redis. Gunakan polling 15-30 detik untuk presence + activity feed, SSE untuk server push.
+ Zero infra baru — hanya PostgreSQL yang sudah ada
+ SSE lebih sederhana dari WebSocket
− Bukan real-time sesungguhnya (ada delay 15-30 detik)
− LISTEN/NOTIFY punya known issues (global lock, no persistence, PgBouncer incompatibility)
− Risk: kalau team grow atau butuh real-time yang lebih baik, harus refactor

### Direction C: Real-Time First (WebSocket)
Langsung investasi di WebSocket untuk true real-time collaboration.
+ Experience terbaik, seperti Figma/Linear
− Complexity tinggi, lebih banyak yang bisa salah
− Over-engineered untuk 5-6 orang

---

## Open Questions for pocket-grinding
- [x] ~~Apakah PostgreSQL cukup untuk semua fitur kolaborasi?~~ **ANSWERED by research: TIDAK. Perlu Redis untuk real-time layer.** (see research report)
- [ ] Bagaimana cara implementasi auth sederhana yang cukup untuk 5-6 orang? (JWT? Session? Magic link?)
- [ ] Apakah Redis perlu di-deploy sebagai container terpisah atau managed service?
- [ ] Bagaimana cara menampilkan conflict resolution UI yang tidak membingungkan user?
- [ ] Apakah perlu "lock" card ketika sedang diedit, atau cukup optimistic update?
- [ ] Bagaimana cara menampilkan activity feed yang tidak terlalu noise tapi tetap informatif?
- [ ] Bagaimana cara handle reconnection untuk SSE/Redis Pub/Sub ketika user koneksi terputus?

---

## Recommended Direction
Direction A (Presence-First + Redis Hybrid) — paling pragmatic, low risk, dan solve real problem. PostgreSQL untuk data layer (proven, reliable), Redis untuk real-time layer (purpose-built). Cost menambah Redis sangat rendah (satu Docker container), tapi risk elimination signifikan.

**Research-backed rationale:** Structured research (2026-06-11) membuktikan bahwa PostgreSQL TIDAK cukup untuk semua fitur kolaborasi — LISTEN/NOTIFY punya fundamental issues yang bisa menyebabkan production problems. Hybrid approach adalah sweet spot: tidak over-engineered, tidak under-engineered.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction A (Presence-First + Redis Hybrid) sebagai working hypothesis untuk Phase 5 Design Proposals
- Treat Open Questions di atas sebagai Phase 3 Discovery targets
- Do NOT treat Approach Directions sebagai final architecture — validate through GWT first
- Read research report: `docs/pocket/research/2026-06-11-pg-collaboration-capability/research-report.md` untuk evidence backing

## Research References
- **Structured Research Report:** `docs/pocket/research/2026-06-11-pg-collaboration-capability/research-report.md`
- **Verdict:** Refuted (medium confidence) — PostgreSQL alone TIDAK cukup untuk semua fitur kolaborasi
- **Key finding:** LISTEN/NOTIFY punya global lock di COMMIT phase, incompatible dengan PgBouncer, notifikasi tidak persisted
- **Recommendation:** Hybrid PostgreSQL (data) + Redis (real-time)
