# Pitch Exploration: team-collaboration
Date: 2026-06-10 | Project: Camel | Status: pitch-only

---

## Problem Statement
Small dev team (5-6 orang) tidak bisa menggunakan Camel secara bersamaan karena tidak ada cara untuk: (1) melihat siapa yang sedang mengerjakan card, (2) melihat perubahan yang dibuat orang lain secara real-time, (3) berkomunikasi tentang card tertentu tanpa keluar dari board.

## Root Tension
Kesederhanaan (single-user, local) vs kolaborasi (multi-user, real-time). Menambah kolaborasi meningkatkan complexity, tapi tanpa itu Camel hanya berguna untuk individual, bukan team.

## Key Constraints
- Small team (5-6 orang) — toleransi eventual consistency tinggi
- Existing PostgreSQL — bisa extend schema
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
**Implication:** Semua approach viable di PostgreSQL existing. Tidak perlu infra baru.

---

## Approach Directions

### Direction A: Presence-First (Recommended)
Tambahkan fitur kolaborasi secara incremental, mulai dari yang paling sederhana: Auth → Presence → Optimistic Locking → Polling → Activity Feed.
+ Incremental, low risk, bisa deliver value cepat
− Tidak "real-time" sesungguhnya (ada delay 30s)

### Direction B: Real-Time First
Langsung investasi di WebSocket/SSE untuk true real-time collaboration.
+ Experience terbaik, seperti Figma/Linear
− Complexity tinggi, lebih banyak yang bisa salah

### Direction C: GitHub-Native
Leverage GitHub sebagai identity provider dan sync source.
+ Sesuai creative brief ("terhubung langsung dengan GitHub issue")
− Dependency pada GitHub API, complexity tinggi, rate limits

---

## Open Questions for pocket-grinding
- [ ] Bagaimana cara implementasi auth sederhana yang cukup untuk 5-6 orang? (JWT? Session? Magic link?)
- [ ] Apakah presence harus real-time (WebSocket) atau polling cukup untuk small team?
- [ ] Bagaimana cara menampilkan conflict resolution UI yang tidak membingungkan user?
- [ ] Apakah perlu "lock" card ketika sedang diedit, atau cukup optimistic update?
- [ ] Bagaimana cara menampilkan activity feed yang tidak terlalu noise tapi tetap informatif?

---

## Recommended Direction
Direction A (Presence-First) — paling pragmatic, low risk, dan bisa deliver value cepat untuk small team. Real-time bisa di-upgrade nanti setelah foundation solid.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction A (Presence-First) sebagai working hypothesis untuk Phase 5 Design Proposals
- Treat Open Questions di atas sebagai Phase 3 Discovery targets
- Do NOT treat Approach Directions sebagai final architecture — validate through GWT first
