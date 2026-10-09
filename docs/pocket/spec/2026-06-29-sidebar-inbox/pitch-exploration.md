# Pitch Exploration: sidebar-inbox
Date: 2026-06-29 | Project: Camel Kanban | Status: pitch-only

---

## Problem Statement
Camel Kanban tidak punya notification center personal — user tidak bisa melihat secara terpusat hal-hal yang relevan untuk mereka (card yang di-assign ke mereka, deadline yang mendekati, perubahan pada kartu mereka). Diperlukan fitur **Inbox** di sidebar Kanban mode yang berfungsi sebagai notification center — mencakup card changes, due dates, assignments, comments, mentions, system alerts, dan welcome message — tetapi tidak termasuk agent events.

## Root Tension
Realtime layer sudah ada (Redis Pub/Sub → SSE) tapi broadcast ke semua subscriber workspace — tidak ada filtering per-user. Menambahkan personal inbox berarti menambah layer relevancy di atas event stream yang sudah ada, sambil menjaga agar tidak menjadi "Activity page clone" yang noisy.

## Key Constraints
- Realtime infrastructure sudah ada: `publishEvent()` → Redis pub/sub → SSE fan-out
- Card schema sudah punya `assignee_id` dan `due_date` columns
- Event payload saat ini TIDAK carry target user — hanya `actor` (pelaku aksi) dan `cardId`
- Sidebar sudah punya mode system (Kanban/Agent) — Inbox masuk ke Kanban mode saja
- Activity page sudah ada sebagai workspace changelog — Inbox harus terpisah secara arsitektural (personal vs workspace-wide)
- Brand persona: "terkontrol, terorganisir, tenang" — Inbox harus mengurangi anxiety, bukan menambah noise
- Workspace limit: hard cap 10 workspaces per user (dari AGENTS.md)

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- "Sudah dibaca" vs "belum dibaca" memerlukan state tracking — `read_at` timestamp column cukup, jangan over-engineer
- Notifikasi perlu grouping per-card untuk menghindari 50 entries dari card yang sama
- Welcome message punya lifecycle berbeda dari card event — one-shot, stateless, bukan "notifikasi" sejati
- Perlu deep link dari notifikasi ke card yang relevan — tanpa ini Inbox tidak actionable
- Retention policy diperlukan — berapa lama notifikasi disimpan sebelum expired

### First Principles Thinking — creative
Key insights:
- Notifikasi pada dasarnya adalah "delta dari state" — sesuatu berubah sejak terakhir kali user lihat
- Yang user butuhkan bukan "daftar semua event" tapi relevansi — apa yang perlu perhatian mereka sekarang
- Inbox yang baik = filter + prioritization dari noise realtime menjadi actionable signals
- Welcome message bukan "notifikasi" — itu onboarding context yang berbeda nature-nya

### Six Thinking Hats — structured
Key insights:
- **White (Facts):** Tidak ada tabel `notifications` di DB. Tidak ada mekanisme read/unread. SSE stream sudah ada.
- **Red (Emotions):** User merasa "ketinggalan" kalau tidak cek board → anxiety. Notifikasi relevan → tenang, terkontrol.
- **Yellow (Benefits):** User bisa fokus kerja tanpa bolak-balik cek board. Due date reminder mencegah deadline terlewat.
- **Black (Risks):** Notifikasi overload → user ignore semua. Performance risk dari polling. Complexity bertambah.
- **Green (Creativity):** Smart grouping, digest mode, quick actions dari Inbox — valid future features.
- **Blue (Process):** Perlu phased approach — MVP (basic list) → enrichment → smart features.

### Reverse Brainstorming — creative
Key insights
- "Semua notifikasi equal priority" → user overwhelmed, ignore semua → perlu filtering/prioritization
- "Tidak ada mark as read" → badge count naik terus → anxiety → perlu read state
- "Tidak ada grouping" → 50 update di card sama = 50 entries → noise → perlu grouping
- "Fetch setiap detik" → battery drain, server load → perlu SSE push, bukan polling
- Semua failure mode berujung pada relevancy, control, dan performance

---

## Advisor Synthesis

Advisor mengkonfirmasi 3 hal kritis:

1. **Notification types punya lifecycle berbeda** — welcome message (one-shot), due date (time-triggered recurring), card changes (transient state delta). Jangan paksa 1 model untuk semua. Design 2-3 notification archetypes.

2. **Activity ≠ Inbox harus terpisah arsitektural** — Activity = workspace changelog (semua lihat sama). Inbox = personal, actionable, filtered ke "me". Sharing data source = confusion later.

3. **Relevancy filter = #1 differentiator** — tanpa per-user filtering (`assigned_to_me`, `mentioned`, `due_soon`), Inbox jadi Activity clone yang noisy. Filter layer lebih penting dari list UI.

Pola yang muncul dari semua metode: **overwhelm/noise** adalah failure mode utama. **Grouping + read state + filtering** adalah table-stakes, bukan nice-to-have.

---

## Spike Results

**Unknown resolved:** Apakah `BoardEvent` carry `userId` dari affected user (assignee)?

**Finding:** TIDAK. `BoardEvent` punya `actor` (pelaku aksi) dan `cardId`, tapi TIDAK punya field untuk target user. `userId` hanya dipakai di `presence.changed` dan `membership.removed`. Card events (`card.created`, `card.updated`, `card.moved`, `card.deleted`) hanya carry `actor` dan `cardId`.

**Implication:** Untuk route notifikasi ke inbox personal assignee, ada 2 opsi:
1. Enrich event payload — tambahkan `targetUserId` saat publish
2. Query `assignee_id` dari kartu saat fan-out/notification creation

Opsi 2 lebih robust karena assignee bisa berubah setelah event dipublish.

---

## Approach Directions

### Direction A: Event Listener + Notifications Table
Pasang interceptor di `publishEvent` pipeline yang menulis ke tabel `notifications` baru. Setiap card event yang melibatkan user tertentu (assignee berdasarkan card lookup) di-insert sebagai notifikasi. Client fetch notifikasi via REST endpoint baru. SSE push untuk realtime delivery.

+ Simple, reliable, queryable — notifikasi persist di DB, bisa pagination, bisa filter
+ Mudah extend ke grouping, read state, retention policy
− Perlu schema migration (tabel `notifications` baru)
− Perlu logic enrichment: setiap card event harus lookup assignee_id untuk target routing

### Direction B: Client-Side SSE Filter
Tidak ada tabel notifikasi baru. Client subscribe ke SSE stream yang sudah ada, filter di sisi client berdasarkan kartu yang di-assign ke mereka. Badge count dihitung dari "events sejak last seen timestamp".

+ Zero backend changes — tidak perlu tabel baru, tidak perlu API baru
+ Paling cepat diimplementasi
− Tidak ada persistence — notifikasi hilang saat refresh/page reload
− Tidak ada "unread" state yang persist across sessions
− Client harus fetch kartu untuk tahu apakah event relevan — N+1 problem

### Direction C: Hybrid — SSE Push + Notification Log
Tambah tabel `notifications` yang di-write oleh server-side event interceptor. Delivery ke client via SSE push (bukan polling). Client bisa juga fetch history saat initial load. Best of both worlds: realtime + persistent.

+ Realtime delivery + persistent history — pengalaman terbaik
+ Bisa evolve ke smart features (grouping, digest, priority) karena data persist
− Paling kompleks: perlu schema, API endpoint, SSE enrichment, client state management
− Perlu design notification routing rules (siapa yang dapat notifikasi untuk event apa)

---

## Open Questions for pocket-grinding
- [ ] Apa saja notification types yang perlu di-support di MVP? (card assigned, card due soon, card moved, card updated, welcome message — atau subset?)
- [ ] Bagaimana routing rules: untuk setiap event type, siapa yang dapat notifikasi? (hanya assignee? juga creator? semua watcher?)
- [ ] Schema design untuk tabel `notifications` — columns apa saja? (id, user_id, workspace_id, event_type, card_id, actor_id, read_at, created_at, payload?)
- [ ] Apakah Inbox perlu grouping per-card atau flat list? Kalau grouping, bagaimana aggregation logic?
- [ ] Retention policy — berapa lama notifikasi disimpan? Auto-expire atau manual delete?
- [ ] Apakah perlu user preference untuk memilih jenis notifikasi mana yang masuk Inbox?
- [ ] Bagaimana handle due date notification — server-side scheduled job atau client-side check?

---

## Recommended Direction
Direction C (Hybrid — SSE Push + Notification Log) — karena realtime infrastructure sudah ada dan card schema sudah lengkap, hybrid approach memberikan pengalaman terbaik (realtime + persistent) dengan complexity yang manageable. Direction A kurang realtime-native, Direction B terlalu fragile tanpa persistence.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction C (Hybrid) as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Spike result menunjukkan perlu card lookup untuk notification routing — validate ini di Phase 3
- Do NOT treat Approach Directions as final architecture — validate through GWT first
