# Agent Live Thinking Stream + Clickable Active Column

**Date:** 2026-06-16
**Status:** approved
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-16-agent-live-thinking-stream/live-thinking.md

---

## Summary

Saat board agent di-approve dan pipeline berjalan, user saat ini hanya bisa menonton
layar diam — kolom yang sedang diproses tidak bisa diklik dan tidak ada visibilitas ke
proses berpikir agent. Fitur ini membuat **setiap kolom mengeksekusi dengan extended
thinking enabled**, **men-stream thinking + output + aktivitas tool secara live** per
kolom, dan **membuat kolom yang sedang diproses bisa diklik** untuk membuka panel detail
yang menampilkan aliran live tersebut (akumulasi penuh + auto-follow), lalu beralih ke
hasil final dari DB setelah kolom selesai.

---

## Context

### Current State
- **Server** (`server/src/agent/`):
  - `executeCard` (llm.ts) sudah men-stream **teks output** token-per-token via `onToken`
    pada jalur single-shot (`executeCardSingleShot`). Pada jalur tool
    (`executeCardWithTools`), teks **dibuffer per-turn** dan baru dipancarkan via
    `onToken(turnText)` di turn final — **belum live**.
  - Param `_reasoning` di `executeCard` **diabaikan** (Phase 1 deferred). Tidak ada param
    `thinking` yang dikirim → MiMo memakai default-nya (**thinking ON**), sehingga semua
    kolom diam-diam memproduksi blok thinking yang hanya ditangkap di `finalMessage` dan
    dipersist ke `agent_card_outputs.thinking`.
  - `service.ts` (`runPipeline`) memancarkan SSE `agent.card.started|token|done|failed`
    (token **dengan** `columnSlug`) dan `agent.tool.started|result|failed`. Fase
    `reasoning` (teks interim sebelum tool call) **sengaja tidak** dipublish ke SSE
    (`if (e.phase !== "reasoning")`) — hanya dipersist ke DB sebagai `_reasoning`.
  - Approve flow memanggil `service.runPipeline` (bukan `triggerExecution` yang legacy).
- **Client** (`client/src/`):
  - `BoardContext` menampung semua event `agent.*` ke array `agentEvents` (append).
  - `AgentPage` → `AgentBoardVisual`: hanya kolom **done** yang clickable. Kolom aktif
    menampilkan animasi `LoadingCamel` dan **tidak** clickable.
  - `AgentCardDetail` (panel slide-over kanan) menarik output+thinking final dari API,
    dan sudah menampilkan **tool trace live** via `deriveToolTrace(agentEvents)`.

### Problem / Motivation
User melapor: "ketika user sudah approve board, user tidak bisa apa-apa dan hanya melihat
layar tanpa bisa melakukan apapun." Thinking model tidak terlihat live (hanya hitungan
token di Execution Log), dan kolom aktif tidak bisa dibuka untuk melihat proses.

### Verifikasi MiMo (probe `server/probe-mimo-thinking.mjs`, dijalankan user 2026-06-16)
Project memakai MiMo (`ANTHROPIC_BASE_URL=https://api.xiaomimimo.com/anthropic`,
`ANTHROPIC_MODEL=mimo-v2.5-pro`, sehingga `NATIVE=false`). Hasil probe:
- **TEST A** (`thinking:{type:"enabled",budget_tokens:1024}`): `thinking_delta=23`,
  `signature_delta=1`, `finalMessage` blok = `thinking, text`. → **Live thinking_delta
  streaming BERFUNGSI** lewat Anthropic SDK.
- **TEST B** (`thinking:{type:"enabled"}` tanpa budget): tetap jalan (15 delta, no error).
  → `budget_tokens` **opsional** di MiMo (native Anthropic mewajibkannya).
- **TEST C** (`thinking:{type:"disabled"}`): 0 thinking_delta, hanya text. → mematikan
  thinking benar-benar menghemat.
- `signature_delta` hadir → SDK merakit blok thinking bertanda-tangan; mengirim ulang
  `finalMessage.content` mentah di tool-loop otomatis memenuhi syarat passback
  `reasoning_content` MiMo.

### Related Areas
- `server/src/agent/llm.ts` — `executeCard`, `executeCardSingleShot`, `executeCardWithTools`
- `server/src/agent/service.ts` — `runPipeline` (SSE publish, token/tool batching)
- `client/src/types.ts` — `AgentEvent`
- `client/src/context/BoardContext.tsx` — akumulasi `agentEvents`
- `client/src/pages/AgentPage.tsx` — `AgentBoardVisual`, derivasi kolom aktif/done
- `client/src/components/AgentCardDetail.tsx` — panel detail
- `client/src/lib/toolTrace.ts` — pola derivasi live (acuan untuk thinking/output)

---

## Scope

### In-Scope
- Aktifkan extended thinking pada eksekusi card untuk **SEMUA kolom**
  (`thinking:{type:"enabled", budget_tokens: THINKING_BUDGET}`), menggantikan param
  `_reasoning` yang menganggur.
- **Token budget (anti-truncation, lihat commit f24f292):** Native Anthropic menghitung
  thinking DI DALAM `max_tokens`. Untuk mempertahankan headroom output 16384 yang sudah
  terbukti mencegah truncation laporan panjang, naikkan `max_tokens` sebesar budget
  thinking. Konstanta: `OUTPUT_BUDGET = 16384`, `THINKING_BUDGET = 8192`,
  `MAX_TOKENS = OUTPUT_BUDGET + THINKING_BUDGET = 24576`. Berlaku untuk
  `executeCardSingleShot` & `executeCardWithTools` (keduanya kini `max_tokens: 16384`).
- Stream `thinking_delta` live dari `executeCard` lewat callback baru `onThinking`, pada
  **kedua** jalur (`executeCardSingleShot` dan `executeCardWithTools`).
- Stream **teks output live** juga pada jalur tool (`executeCardWithTools`) — bukan lagi
  dibuffer sampai turn final.
- Event SSE baru `agent.card.thinking` (membawa `columnSlug` + potongan teks), dibatch
  ~200ms seperti token, di-flush sebelum event tool.
- Kolom yang **sedang diproses (active) bisa diklik** → buka `AgentCardDetail` (reuse).
- Akumulasi thinking & output live **per-kolom** dari `agentEvents` di client; panel
  menampilkan dari awal + auto-follow; tutup-buka tetap utuh.
- Sumber konten panel: **live jika ada, DB jika live kosong** (mirror
  `pickToolTraceForColumn`). Tanpa swap saat done dalam sesi yang sama; DB hanya dipakai
  saat data live kolom tidak tersedia (reload/reopen/switch). Lihat EC1.
- Pertahankan blok thinking bertanda-tangan antar-turn di tool-loop (jangan di-strip).

### Out-of-Scope
- Chat input / interupsi / cancel eksekusi di tengah jalan — input tetap disabled saat
  running (keluhan user terjawab oleh clickable column, bukan chat).
- Perubahan board manusia (`card_events`), reorder/edit agent card.
- Persist tiap delta thinking ke DB — hanya thinking final yang disimpan (seperti sekarang).
- Memperbaiki `triggerExecution` legacy (token tanpa `columnSlug`) — tak dipakai approve
  flow; hanya disentuh jika perlu, dan jika ya harus menambahkan `columnSlug`.
- Gating thinking per-flag `reasoning` — **ditolak user**; semua kolom enabled.

---

## Architecture Constraints

- **Boleh sentuh:** `server/src/agent/llm.ts`, `server/src/agent/service.ts`,
  `server/src/realtime.ts` (tambah `agent.card.thinking` + field `token`/`columnSlug`/`boardId`
  ke allowlist tipe `BoardEvent`), `client/src/types.ts`,
  `client/src/context/BoardContext.tsx`, `client/src/pages/AgentPage.tsx`,
  `client/src/components/AgentCardDetail.tsx`,
  `client/src/lib/toolTrace.ts` (atau util derivasi baru sejenis).
- **Tidak boleh sentuh:** route board manusia, `card_events`, `server/src/core/` (fungsi
  murni), schema DB (tanpa migrasi).
- **Pola yang wajib diikuti:** DI pada `service.ts`; SSE via `publishEvent`; batching
  `setInterval(200ms)` + flush sebelum tool event; derivasi live mirror `deriveToolTrace`;
  Biome (tab + double-quote); ESM `.js` import di server (NodeNext); test Vitest;
  UI wajib konsultasi `docs/pocket/rule/creative-brief.md`.
- **Architecture validation result: PASS** (lihat checklist di bawah).

---

## Stories + Scenarios

### Story: Tonton proses agent live & buka kolom aktif
> Sebagai user yang sudah approve board, saya ingin mengklik kolom yang sedang diproses
> dan menonton thinking + output + tool agent mengalir live, supaya tidak menatap layar diam.

**Rule 1: Setiap kolom eksekusi dengan thinking enabled + thinking di-stream live**
- Example A: kolom Analysis diproses → `thinking_delta` tiba → dipancarkan sebagai
  `agent.card.thinking{columnSlug:"analysis-specialist", token:"..."}` (dibatch 200ms).
- Example B: kolom Research (tool path) diproses → thinking + text + tool event semua live.

```gherkin
Scenario: Live thinking happy path
  Given board approved dan kolom Analysis sedang diproses
  When user mengklik kolom Analysis
  Then panel AgentCardDetail terbuka
  And bagian Thinking bertambah token-demi-token secara live
  And bagian Output dan Tool Activity juga tampil live
  And panel auto-scroll mengikuti aliran terbaru

Scenario: Kolom tool path streaming output live
  Given kolom Research Specialist (memakai web_search) sedang diproses
  When user membuka panelnya
  Then teks output tampil mengalir live (bukan muncul sekaligus di akhir)
  And event tool started/result tampil live
```

**Rule 2: Akumulasi penuh + auto-follow saat panel dibuka telat/ulang**
- Example C: thinking sudah mengalir 10 detik → user baru klik → tampil seluruh thinking
  dari awal lalu lanjut live.

```gherkin
Scenario: Buka panel telat
  Given thinking kolom Analysis sudah mengalir 10 detik
  When user baru mengklik kolom itu
  Then panel langsung menampilkan SELURUH thinking dari awal
  And aliran berlanjut live setelahnya

Scenario: Tutup lalu buka lagi saat masih proses
  Given user menutup panel saat kolom masih diproses
  When user membuka panel kolom yang sama lagi
  Then seluruh thinking & output sejauh ini tetap tampil utuh
```

**Rule 3: Setelah done → final dari DB; gagal → berhenti rapi**
```gherkin
Scenario: Selesai — tetap live dalam sesi, DB saat live kosong
  Given kolom Analysis menerima agent.card.done dan data live-nya masih ada di agentEvents
  When panel kolom itu dilihat dalam sesi yang sama
  Then indikator "streaming" berhenti
  And konten tetap dari live (tanpa kedip/swap)
  And jika halaman di-reload (live kosong), panel fetch & tampilkan final dari agent_card_outputs

Scenario: Kolom gagal saat streaming
  Given kolom menerima agent.card.failed saat diproses
  When user melihat panelnya
  Then streaming berhenti tanpa crash
  And status gagal terlihat
```

**Rule 4: Klik kolom yang belum mulai**
```gherkin
Scenario: Kolom pending diklik
  Given pipeline sedang di kolom 2 dan kolom 4 belum mulai
  When user mengklik kolom 4
  Then panel menampilkan state netral "belum diproses" tanpa error
```

**Rule 5: Tool-loop passback (regresi MiMo)**
```gherkin
Scenario: Thinking enabled + multi-turn tool tetap valid
  Given kolom dengan tool berjalan dalam thinking mode (≥2 turn)
  When request lanjutan dikirim ke MiMo
  Then blok thinking bertanda-tangan ikut terkirim di messages
  And tidak terjadi error 400 "reasoning_content must be passed back"
```

---

## Acceptance Criteria

```
Rule: Thinking enabled + streamed live untuk semua kolom
  ✓ Given kolom apa pun dieksekusi, When LLM dipanggil, Then request memuat
    thinking:{type:"enabled",budget_tokens:THINKING_BUDGET(8192)} dan max_tokens=24576
  ✓ Given kolom laporan panjang (mis. Writer) dengan thinking enabled, When dieksekusi,
    Then output TIDAK terpotong (stop_reason !== "max_tokens") — regresi anti-truncation
    commit f24f292 terjaga (output headroom ≥ 16384)
  ✓ Given thinking_delta tiba, When streaming, Then dipancarkan sebagai
    agent.card.thinking dengan columnSlug, dibatch ~200ms, di-flush sebelum tool event
  ✓ Given jalur tool, When kolom diproses, Then text_delta output dipancarkan live
    (bukan dibuffer ke turn final)

Rule: Kolom aktif clickable + panel live
  ✓ Given kolom sedang diproses, When user klik, Then AgentCardDetail terbuka
  ✓ Given panel kolom aktif terbuka, When thinking/output/tool mengalir, Then ketiganya
    tampil live + auto-follow

Rule: Akumulasi penuh
  ✓ Given thinking sudah mengalir lalu panel baru dibuka, When dibuka, Then seluruh
    thinking dari awal tampil lalu lanjut live
  ✓ Given panel ditutup lalu dibuka lagi saat running, When dibuka, Then konten utuh

Rule: Sumber konten & transisi done/failed
  ✓ Given kolom punya data live di agentEvents, When panel dilihat, Then render dari live
    (mirror pickToolTraceForColumn), tanpa swap saat done; indikator streaming berhenti
  ✓ Given data live kolom kosong (reload/reopen/switch), When panel dibuka, Then fetch &
    tampilkan output+thinking final dari DB
  ✓ Given agent.card.failed saat streaming, When panel dilihat, Then berhenti rapi tanpa crash

Rule: Edge & regresi
  ✓ Given kolom pending diklik, When dibuka, Then state netral tanpa error
  ✗ Given thinking mode + multi-turn tool, When passback dikirim tanpa blok thinking,
    Then MiMo akan menolak (400) — maka blok thinking WAJIB dipertahankan
```

---

## Design Decision

**Chosen option:** Option A — Reuse `agentEvents` + derivasi live (mirror `deriveToolTrace`)

**Summary:**
- Server: tambah callback `onThinking` di `executeCard` (kedua jalur), kirim param
  `thinking:{type:"enabled",budget_tokens:1024}` untuk semua kolom; stream `text_delta`
  live juga di jalur tool. `service.runPipeline` memancarkan event SSE baru
  `agent.card.thinking{columnSlug, token}` dengan buffer + `setInterval(200ms)` dan
  flush-sebelum-tool, identik pola token.
- Client: tambah tipe `agent.card.thinking` ke `AgentEvent`; `BoardContext` cukup
  mem-push ke `agentEvents` yang sudah ada (akumulasi otomatis). Tambah helper derivasi
  per-kolom (mis. `deriveThinkingForColumn` / `deriveStreamedOutputForColumn`) yang
  mengonkatenasi event untuk kolom tsb. `AgentBoardVisual` membuat kolom **active** (dan
  pending) clickable. `AgentCardDetail` menampilkan thinking/output live saat running
  (dari derivasi) dan final dari DB saat done (pola `pickToolTraceForColumn`), dengan
  auto-scroll.

**Rejected options:**
- Option B (map `thinkingByColumn` via reducer di BoardContext): plumbing state ekstra
  untuk keuntungan perf yang belum dibutuhkan (premature). Konkatenasi atas array
  ter-batch sudah memadai.
- Option C (endpoint/poll DB untuk thinking in-progress): DB tidak menyimpan delta thinking;
  menambah latensi dan tidak benar-benar live. Ditolak.

**Key tradeoffs accepted:**
- Derivasi konkatenasi atas `agentEvents` O(n) per render; n moderat karena batching 200ms.
- Semua kolom kini membayar thinking secara eksplisit (sebelumnya sudah ON via default MiMo,
  jadi bukan kenaikan biaya nyata — hanya kini terkontrol & terlihat).

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| MiMo stream thinking_delta live? | Terverifikasi YA via probe (TEST A=23 delta) | — (resolved) |
| budget_tokens wajib? | Opsional di MiMo; tetap disertakan utk native | Native 400 bila dihilangkan; mitigasi: selalu sertakan |
| Output jalur tool live? | Saat ini tidak; spec mewajibkan streaming live | Bila tak diubah, output kolom tool tetap "muncul sekaligus" |
| Konsistensi live vs DB final | Pakai live saat running, DB saat done (mirror toolTrace) | Sedikit beda teks live vs final — dapat diterima |
| Truncation saat thinking enabled? | Naikkan max_tokens=OUTPUT_BUDGET+THINKING_BUDGET (24576) agar output ≥16384 | Bila max_tokens dibiarkan 16384, thinking memakan output → regresi truncation f24f292 |
| MiMo terima max_tokens 24576? | Diasumsikan ya (probe pakai 2048; mimo-v2.5-pro context besar) | Bila MiMo menolak/ceiling lebih rendah → clamp THINKING_BUDGET; verifikasi via probe ulang sebelum merge |

---

## Implementation Notes
- `budget_tokens`(8192) harus `< max_tokens`(24576) ✓. Native Anthropic menghitung
  thinking di dalam `max_tokens`, jadi `max_tokens` dinaikkan ke 24576 agar output tetap
  punya ~16384 (mencegah regresi truncation commit f24f292). Saat thinking enabled di
  **native** Anthropic, JANGAN set `temperature` (kode saat ini tak set ✓).
- Jadikan `OUTPUT_BUDGET`/`THINKING_BUDGET`/`MAX_TOKENS` konstanta bernama di llm.ts agar
  mudah di-tune & diuji; tambah unit test regresi truncation (mirror test di llm.test.ts).
- `executeCardWithTools` saat ini `messages.push({role:"assistant", content: finalMessage.content})`
  mentah — pertahankan agar blok thinking bertanda-tangan ikut (syarat passback MiMo).
  Tambahkan unit test regresi yang memastikan blok thinking tidak di-strip.
- Tambah cabang stream: `event.type==="content_block_delta" && event.delta.type==="thinking_delta"`
  → `onThinking(event.delta.thinking)` pada kedua fungsi execute.
- Batch `agent.card.thinking` di `runPipeline` dengan buffer terpisah dari token output,
  dan flush keduanya sebelum memancarkan event tool (sama pola seperti token sekarang).
- UI panel: konsultasi `docs/pocket/rule/creative-brief.md` untuk warna/spacing bagian
  "Thinking (live)" dan indikator streaming.
- `probe-mimo-thinking.mjs` adalah artefak verifikasi throwaway — boleh dihapus setelah merge.

## Edge Case Resolutions (post edge-case-hunter)

Hasil review edge-case hunter (subagent read-only) + keputusan user:

- **EC1 — Sumber konten: "live jika ada, DB jika live kosong" (keputusan user):** Tetap
  pakai panel `AgentCardDetail` yang ada (tanpa UI baru, tanpa swap saat done). Aturan
  pemilihan sumber **mirror `pickToolTraceForColumn`**: jika client punya data live
  (event thinking/output untuk `boardId`+`columnSlug` itu di `agentEvents`) → render live;
  jika **tidak ada** data live → fetch & render dari DB. Konsekuensinya: dalam satu sesi,
  kolom aktif maupun yang baru selesai tetap pakai live (identik isinya untuk kolom non-tool;
  untuk kolom tool, live menampilkan versi berproses yang sedikit lebih kaya — diterima).
  **Tidak ada re-fetch/penggantian saat done** → tanpa kedip. AgentCardDetail fetch DB
  HANYA saat data live kolom itu kosong (mis. reload halaman, buka board lagi nanti, pindah
  workspace, atau tak ada delta live sama sekali).
- **EC2 — SSE drop/reconnect:** Terima akumulasi *lossy* selama fase running (tanpa
  membangun replay server). Jika sebagian live hilang, panel tetap menampilkan live yang ada
  sampai user **reload/tutup-buka** → saat itu live kosong sehingga jatuh ke DB final yang
  utuh (EC1). Tidak menampilkan error mentah saat reconnect singkat.
- **EC3 — Polusi lintas-board:** Clear `agentEvents` saat **switch workspace** dan saat
  **board load**, DAN sertakan `boardId` pada event agent + **scope derivasi per boardId**
  (bukan hanya `columnSlug`) untuk mencegah tabrakan slug template antar-board.
- **EC4 — Kolom gagal vs pending:** Bedakan state di panel — kolom **gagal** → state "gagal";
  kolom **belum jalan** → "belum diproses". Jangan paksa semua kolom `isDone` saat
  `executionStatus==="done"` bila kolom itu gagal/tidak jalan. **Perbaiki badge
  "Extended Thinking: ON/OFF"** yang kini menyesatkan (semua kolom enabled) — tampilkan
  status sebenarnya atau hapus badge bergantung `column.reasoning`.

### Recommended scenarios (diadopsi sebagai acceptance tambahan)
```gherkin
Scenario: Thinking nol (disabled/rollback)
  Given kolom tanpa thinking_delta
  Then bagian Thinking kosong tanpa indikator "streaming…" yang macet

Scenario: Event thinking tanpa columnSlug di-drop
  Given agent.card.thinking tanpa columnSlug
  Then event diabaikan dari akumulasi (tidak nyasar ke kolom lain)

Scenario: Ordering done vs flush
  Given buffer thinking/token masih ada saat done dipublish
  Then buffer di-flush dulu sebelum done; delta yang telat setelah done tidak diappend

Scenario: Retry tidak bocor
  Given run gagal di-retry (clearAgentEvents dipanggil)
  Then thinking run sebelumnya tidak muncul di run baru

Scenario: MiMo tolak max_tokens=24576
  Given panggilan pertama mengirim max_tokens 24576
  Then 4xx muncul rapi sebagai agent.card.failed; mitigasi: re-probe / clamp THINKING_BUDGET sebelum merge

Scenario: Passback thinking multi-turn (regresi)
  Given thinking enabled + ≥2 turn tool
  Then blok thinking bertanda-tangan ikut terkirim; tanpa error 400 reasoning_content
```

---

## UX Naturalness Requirements

User meminta pengalaman terasa natural/mulus (semua aspek, "no preference" = berlaku semua):

- **Streaming halus:** thinking/output mengalir seperti diketik, tidak meloncat tiap 200ms.
  Pertahankan batching server 200ms (efisiensi SSE) tapi render sisi-klien boleh
  menghaluskan kemunculan (mis. animasi/append bertahap).
- **Transisi done mulus:** tidak ada swap saat done dalam sesi (konten tetap live) → tanpa
  flash/reload; posisi scroll terjaga (lihat EC1).
- **Reconnect anggun:** tidak ada error/teks-hilang yang mencolok; menyatu ke final saat
  done (lihat EC2).
- **Auto-scroll sopan:** auto-follow ke konten terbaru, tapi **berhenti** mengikuti bila
  user sedang scroll ke atas membaca; lanjut lagi bila user kembali ke bawah.

---

## Rollback Plan
- Fitur additive & tanpa migrasi DB. Rollback = revert commit. Untuk mematikan cepat tanpa
  deploy ulang client: kirim `thinking:{type:"disabled"}` di server (mengembalikan ke
  perilaku tanpa thinking) — kolom tetap clickable tapi tanpa aliran thinking.
```
