# Research Report — PostgreSQL for Team Collaboration: Solo vs Adding Redis

- **Date:** 2026-06-11
- **Verdict:** Refuted
- **Confidence:** medium

## Assumption tested
PostgreSQL (single instance, existing infra Camel) mampu menangani SEMUA fitur kolaborasi untuk 5-6 user secara bersamaan — yaitu: (1) presence tracking, (2) activity feed, (3) optimistic locking/conflict resolution, dan (4) event notification (real-time updates) — tanpa memerlukan infrastruktur tambahan seperti Redis, RabbitMQ, atau dedicated WebSocket server.

**Disconfirming observation:** Salah satu dari 4 fitur di atas memerlukan capability yang tidak dimiliki PostgreSQL, atau PostgreSQL bisa secara teknis tapi complexity/cost-nya melebihi menambah infra baru.

## Methods used
- Source Triangulation (triangulation) — Cross-check PostgreSQL capabilities (LISTEN/NOTIFY, optimistic locking, activity feed) melawan 5+ sumber independen
- Counterexample Hunt (adversarial) — Cari kasus konkret di mana tim harus menambah Redis karena PostgreSQL alone tidak cukup
- Documentation vs Reality Check (triangulation) — Bandingkan claim resmi PostgreSQL vs real-world experience di production

## Evidence

| Finding | Source | Supports / Refutes |
|---------|--------|--------------------|
| Optimistic locking via `version` column adalah pattern yang well-established dan battle-tested di PostgreSQL | Reintech, Stormatics, StackOverflow, ByteByteGo, EnterpriseDB | Supports |
| Activity feed queries trivial dengan JSONB + timestamp index di PostgreSQL | PostgreSQL docs, multiple blog posts | Supports |
| Beberapa tim sukses replace Redis sepenuhnya dengan PostgreSQL — simpler ops, lower cost | DEV Community (polliog), Lobsters discussion | Supports |
| LISTEN/NOTIFY punya **global lock** di fase COMMIT — `AccessExclusiveLock` on database 0, serialize semua commit | Recall.ai blog (May 2026), PostgreSQL source code `async.c#L956` | Refutes |
| Recall.ai experienced **production outage** karena LISTEN/NOTIFY bottleneck — database stalled, CPU/disk I/O plummeted | Recall.ai blog + HN discussion | Refutes |
| NOTIFY **not persisted** — at-most-once delivery; listener yang disconnect kehilangan pesan | PostgreSQL docs, Sequin blog, Stack Overflow | Refutes |
| LISTEN/NOTIFY **incompatible dengan PgBouncer** — yang dibutuhkan production apps untuk connection pooling | Lobsters discussion, PgDog blog | Refutes |
| Payload limit **8000 bytes** — harus pass ID saja, fetch full data terpisah | PostgreSQL docs, StackSync blog, OneUptime blog | Refutes (partial) |
| PostgreSQL community acknowledges LISTEN/NOTIFY sebagai **weakest feature** — known scalability bottlenecks | HN discussion (maxbond), pgsql-hackers mailing list (Jul 2025) | Refutes |
| Recall.ai bug **sudah di-fix di PostgreSQL core** (commit 282b1cde) — tapi fix baru, belum teruji luas | Recall.ai blog update (May 2026) | Supports (partial) |
| Untuk 5-6 user, connection limit PostgreSQL (default 100) **bukan bottleneck** — polling 30s × 6 user = 0.2 QPS | Calculated from PostgreSQL docs | Supports |
| Redis Pub/Sub lebih efisien untuk fan-out ke multiple listeners daripada PostgreSQL LISTEN/NOTIFY | Redis docs, OneUptime blog, LinkedIn posts | Refutes |

## Curation notes
*(Inline fallback digunakan — advisor tidak tersedia)*

**Strongest support:** Optimistic locking dan activity feed *definitif* bisa di PostgreSQL. Ini bukan asumsi — ini sudah proven pattern. Untuk small team (5-6), PostgreSQL lebih dari cukup untuk data layer.

**Strongest counter-evidence:** LISTEN/NOTIFY punya fundamental architectural flaw (global lock di COMMIT). Recall.ai case adalah counterexample yang kuat — tapi konteksnya sangat berbeda (tens of thousands writers vs 5-6 users). Untuk 5-6 user, LISTEN/NOTIFY *mungkin* cukup, tapi ada risk tersembunyi: tidak compatible dengan PgBouncer, notifikasi tidak persisted, dan 8000 byte limit.

**Gap:** Tidak ada benchmark untuk small team use case. Semua counterexample dari high-scale scenarios. Tidak ada spike test di project Camel sendiri.

**Key insight:** Asumsi ini **bundled** — ada 4 fitur berbeda. PostgreSQL cukup untuk 2 (optimistic locking, activity feed) tapi punya real limitations untuk 2 lainnya (presence/real-time notification). Jawabannya **partial, bukan binary**.

## Verdict & reasoning

**Verdict: Refuted** (confidence: medium)

Asumsi bahwa PostgreSQL bisa handle SEMUA fitur kolaborasi tanpa infra tambahan adalah **tidak sepenuhnya benar**. Evidence menunjukkan:

1. **Optimistic locking dan activity feed** — PostgreSQL lebih dari cukup. Tidak perlu Redis.
2. **Real-time notifications** — LISTEN/NOTIFY punya known limitations yang serius (global lock, no persistence, PgBouncer incompatibility). Untuk 5-6 user, mungkin *cukup* secara teknis, tapi ini "memaksa" PostgreSQL melakukan sesuatu yang bukan kekuatannya.
3. **Presence tracking** — polling 30s ke PostgreSQL *bisa* work, tapi ini bukan real-time dan ada latency trade-off.

Confidence **medium** (bukan high) karena: counterexample terkuat (Recall.ai) beroperasi di scale yang sangat berbeda (tens of thousands writers vs 5-6 users). Untuk small team, PostgreSQL *mungkin* cukup untuk semua fitur, tapi ada risk yang tidak perlu diambil ketika Redis sudah sangat mudah di-deploy.

## Recommendation (non-binding)

**Hybrid approach (recommended):**
- **Gunakan PostgreSQL** untuk: optimistic locking, activity feed, data layer
- **Tambah Redis** untuk: presence tracking, real-time event notification (pub/sub)
- Alasan: Redis pub/sub adalah purpose-built untuk real-time fan-out. Cost menambah Redis sangat rendah (satu container Docker), tapi menghilangkan semua risk dari LISTEN/NOTIFY limitations

**Alternatif (jika ingin zero infra baru):**
- Gunakan **polling 15-30 detik** untuk presence + activity feed (no LISTEN/NOTIFY)
- Gunakan **SSE (Server-Sent Events)** untuk real-time updates — server push tanpa WebSocket, lebih sederhana
- Accept trade-off: ada delay 15-30 detik, bukan real-time sesungguhnya

**Tidak disarankan:**
- Mengandalkan LISTEN/NOTIFY untuk fitur kritikal — terlalu banyak known issues dan compatibility problems

## What would change this verdict
- Jika ada evidence bahwa LISTEN/NOTIFY di PostgreSQL 17+ (dengan fix dari commit 282b1cde) sudah stabil untuk 10-50 concurrent listeners tanpa global lock issue
- Jika ada benchmark yang menunjukkan LISTEN/NOTIFY bekerja dengan baik untuk small team (5-10 users) di belakang PgBouncer
- Jika Redis menambah complexity yang tidak terduga (misalnya: deployment, monitoring, backup) yang melebihi manfaatnya untuk small team
