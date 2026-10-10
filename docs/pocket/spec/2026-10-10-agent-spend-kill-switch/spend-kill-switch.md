# Global Agent Spend Kill Switch

**Date:** 2026-10-10
**Status:** approved
**Author:** Pocket Grinding
**Issue:** [#208](https://github.com/rfxlamia/camel/issues/208)
**Status note:** Spec/discovery only. Guard and tests below are proposed; no product code or implementation tests have run.
**Spec path:** `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`

---

## Ringkasan

Tambahkan satu env flag global, `AGENT_SPEND_KILL_SWITCH`, untuk menghentikan permintaan agent/LLM baru saat biaya perlu dihentikan cepat. Default `false` mempertahankan perilaku sekarang; saat `true`, permintaan valid yang akan memulai LLM ditolak dengan HTTP 503 dan body error yang stabil. Pesan atau perubahan status tidak boleh tersimpan akibat permintaan yang ditolak. Pekerjaan yang sudah mulai berjalan tidak dibatalkan oleh guard ini.

Flag dibaca saat proses server dimulai. Mengubah env memerlukan container server dibuat ulang; perubahan ini sendiri tidak menjamin run yang sedang berlangsung selamat dari gangguan restart/deploy.

## Konteks

### Kondisi sekarang

- `server/src/config.ts` memvalidasi env dengan Zod; flag boolean yang ada memakai `z.enum(["true", "false"]).default(...)`.
- Agent board service melakukan klasifikasi, deteksi periode, klarifikasi, dan follow-up melalui dependency LLM. Route approval dan konfirmasi regenerate memulai `runPipeline` secara fire-and-forget setelah update status.
- Agent `sendMessage` menyimpan pesan di beberapa jalur sebelum memanggil LLM. Konfirmasi regenerate menghapus entry pending sebelum mutasi database dan memulai pipeline.
- Chat message handler menyiapkan akses dan riwayat, lalu mengirim header NDJSON dan menyimpan/menghapus pesan sebelum memanggil `runChatTurn`. Error stream normal bukan respons JSON 503.
- Ticket intake mempunyai jalur pertanyaan classifier pertama yang tidak memanggil LLM; giliran lain mengekstrak field tiket melalui LLM.
- Compose produksi menyuntikkan env secara eksplisit ke container server. Menambah variable di `.env.production` saja tidak membuatnya tersedia di container.

### Masalah / Nilai

Camel mengeluarkan biaya LLM saat pengguna membuat, menyetujui, meregenerasi, atau mengirim pesan untuk agent. Bug atau loop dapat menimbulkan biaya tanpa batas. Operator memerlukan satu kontrol darurat global yang mudah diaktifkan tanpa membuat operasi database-only berhenti.

### Area terkait

- `server/src/config.ts`, `server/.env.example`
- `server/src/modules/agent/{service.ts,board-conversation.ts,routes.ts,pipeline.ts,index.ts}`
- `server/src/modules/agent/ticket-intake/routes.ts`
- `server/src/modules/chat/message-stream.ts` dan public API agent
- `deploy/docker-compose.prod.yml`, `deploy/.env.production.template`, `deploy/README.md`

## Cakupan

### Termasuk

- Menambahkan `AGENT_SPEND_KILL_SWITCH`, nilai sah `"true"`/`"false"`, default `"false"`.
- Menyediakan satu assertion/error bertipe untuk semua penolakan spend baru.
- Menolak semua jalur LLM agent (termasuk `triggerExecution`), chat, dan ticket-intake sebelum pemanggilan LLM dan sebelum perubahan state/pesan dari permintaan yang ditolak. “Tanpa write” berarti tanpa pesan, run/domain state, claim pending-regenerate, atau event akibat permintaan yang ditolak; rate-limit accounting existing tetap berlaku.
- Mengembalikan tepat `503` dengan JSON:
  ```json
  { "error": "Agent spend is disabled by kill switch", "code": "AGENT_SPEND_KILL_SWITCH" }
  ```
- Mempertahankan prioritas autentikasi, membership/authorization, validasi, dan rate limit yang sudah ada. Hanya permintaan yang lolos pemeriksaan tersebut dan akan memakai LLM yang menerima error kill switch.
- Membiarkan operasi tanpa LLM tetap bekerja, termasuk pembacaan/CRUD thread chat, aksi board database-only, pembatalan regenerate, dan pertanyaan classifier pertama ticket-intake.
- Meneruskan env melalui Compose produksi dan mendokumentasikan aktivasi/nonaktifasi dengan container recreation.

### Tidak termasuk

- Kuota spend per pengguna.
- Meter pemakaian, event, dashboard, atau laporan biaya.
- Toggle UI atau endpoint administrasi.
- Membatalkan run LLM yang sudah berjalan.
- Menjamin run tetap hidup saat server/container direstart atau deploy.
- Guard opsional CI/grep untuk call site LLM baru; dapat menjadi tindak lanjut terpisah.
- Mengubah semantik rate limiter yang sudah ada.

## Batasan arsitektur

- **Boleh disentuh:** config server, feature modules `agent`/`chat` (termasuk guard di awal `pipeline.ts` entry methods), ticket-intake yang berada dalam modul agent, tests terkait, contoh env dan dokumentasi/deployment Compose.
- **Jangan disentuh:** client/UI, schema/migrasi database, kontrak domain lain, logika di tengah pipeline/kartu yang sudah berjalan, atau helper `runChatTurn`/SDK sebagai lokasi kill switch.
- Guard bersama berada di `server/src/modules/agent/` dan diakses lintas fitur melalui `server/src/modules/agent/index.ts` saja.
- Assertion dilakukan pada pintu masuk spend-bearing sebelum menulis pesan/status atau memulai pipeline. Jangan taruh di tengah `runPipeline`, `executeCard`, atau `runChatTurn`.
- Error bertipe harus ditangani di masing-masing HTTP boundary sehingga broad catch/global sanitizer tidak mengubah status, pesan, atau code.
- Ikuti NodeNext ESM (`.js` pada import server) dan aturan 300-on-touch. File sumber yang akan diedit saat ini di bawah 300 baris; tests dikecualikan.

### Bukti validasi arsitektur

| Klaim / batasan | Bukti codebase | Sumber eksternal | Hasil |
|---|---|---|---|
| Pola config sudah tersedia dan bersifat startup-only | `server/src/config.ts`: `envSchema`, `resolveConfig`, `config = Object.freeze(...)`; existing `OAUTH_ENABLED`, `EMAIL_GATE_ENABLED`, `FOCUS_MODE_ENABLED` memakai Zod enum. `server/src/__tests__/config.test.ts` mengimpor ulang config setelah set env. | Tidak diperlukan untuk perilaku internal | **PASS** — flag sesuai pola yang ada; perubahan env tidak hot-reload. |
| Service/route mempunyai pintu masuk yang bisa digate sebelum efek samping | `server/src/modules/agent/service.ts`: `createBoard` mengklasifikasi sebelum insert; `approveBoard` memeriksa ownership lalu dapat mendeteksi periode dan mengubah status. `board-conversation.ts`: jalur pending menulis pesan sebelum LLM, done-board mengklasifikasi sebelum pesan, regenerate menghapus entry pending sebelum mutasi. `routes.ts`: route approve memulai pipeline setelah service mengembalikan sukses. `pipeline.ts`: `runPipeline` dan `triggerExecution` dipublikasikan melalui service; pencarian seluruh `server/src` menemukan pemanggilan produksi `runPipeline` dari approve/regenerate, dan tidak ada caller produksi `triggerExecution`. | Tidak diperlukan untuk perilaku internal | **PASS** — gate pada service entrances dan di awal kedua method pipeline melindungi pemanggilan langsung; assertion satu kali di awal tidak menginterupsi eksekusi yang telah berjalan. |
| Chat perlu ditolak sebelum SSE dan persistence | `server/src/modules/chat/message-stream.ts`: access/history dipersiapkan sebelum `setStreamHeaders`; `streamMessage` baru memanggil `persistMessageStart` setelah header dikirim. `message-runtime.ts`: start menyisipkan pesan atau menghapus target retry. Generic outer catch menghasilkan 500; stream handler menghasilkan event error. | Tidak diperlukan untuk perilaku internal | **PASS** — gate dan pemetaan 503 berada sebelum header/persist; tidak cukup melempar ke generic handler. |
| Error generic saat ini tidak memenuhi kontrak | `server/src/middleware/error-handler.ts`: sanitasi mengubah pesan tak dikenal menjadi 500 dan hanya menyertakan `code` dalam development. Agent routes serta chat/ticket memiliki penanganan sendiri. | Tidak diperlukan | **PASS** — tiap route/handler spend-bearing harus mengubah error bertipe ke body kontrak secara eksplisit. |
| Ticket classifier awal tidak memakai LLM; ekstraksi memakai LLM | `server/src/modules/agent/ticket-intake/routes.ts`: `isFirstTurn && !autoError` mengembalikan pertanyaan sebelum `respondWithChatExtraction`; fungsi itu memanggil `extractTicketFields`. Rate-limit check berjalan sebelum extraction. | Tidak diperlukan | **PASS** — pertanyaan pertama tetap tersedia; gate diletakkan setelah auth/validasi/membership/first-turn/rate-limit. |
| Akses lintas feature mengikuti public API | `server/src/modules/agent/index.ts` adalah public API agent; `server/src/modules/chat/index.ts` hanya mengekspor router. ADR feature-module convention mengharuskan cross-feature import melalui index. | `docs/pocket/adr/2026-09-16-feature-module-convention.md` | **PASS** — chat mengimpor guard/error dari `../agent/index.js`, bukan deep import. |
| Deployment env diteruskan eksplisit | `deploy/docker-compose.prod.yml` memetakan tiap env pada `services.server.environment`; `.env.production.template` merupakan sumber host-local. | Docker Docs, “Set environment variables within your container's environment”, https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/ (diakses 2026-10-10) | **PASS** — Compose memerlukan entri env eksplisit; tambah mapping flag dengan default false. |
| Penerapan env baru perlu container recreation | `deploy/deploy.sh` menggunakan `docker compose ... up -d`; deployment berbasis Docker Compose. | Docker Docs, `docker compose up`, https://docs.docker.com/reference/cli/docker/compose/up/ (diakses 2026-10-10): config/image yang berubah membuat Compose recreate; `--force-recreate` memaksa recreation. Versi Docker Compose host tidak dipin di repo. | **PASS dengan asumsi operator menggunakan Compose v2 yang cocok dengan deployment saat ini.** Dokumentasi harus menyarankan `up -d --force-recreate server`, bukan hanya `restart`. Recreation bisa mengganggu run aktif; kontinuitas tidak dijanjikan. |
| Tidak ada dependency baru atau migration | `server/package.json` dan root `package-lock.json`: Zod 4.4.3 dan Anthropic SDK 0.104.2 terpasang; semua perilaku bisa memakai pola existing. Tidak ada data persist baru. | Tidak perlu docs library tambahan | **PASS** — tanpa dependency dan tanpa migrasi. |
| Batas line-budget | Hitungan saat scan: `config.ts` 183, `service.ts` 165, `board-conversation.ts` 253, `routes.ts` 202, `pipeline.ts` 219, `message-stream.ts` 101, `ticket-intake/routes.ts` 209; ADR menerapkan batas 300-on-touch. | `docs/pocket/adr/2026-09-16-feature-module-convention.md` | **PASS** — semua file yang dihitung di bawah 300; cek ulang jika file lain perlu disentuh saat implementasi. |

**Hasil validasi:** Arsitektur mendukung rancangan dengan asumsi operasional Compose di atas; guard belum diimplementasikan dan belum diuji. Temuan terhadap daftar file issue: `deploy/docker-compose.prod.yml` juga wajib diubah karena env host tidak diteruskan otomatis. `deploy/README.md` belum ada; spec mengusulkan membuatnya untuk instruksi operator singkat.

## Dependencies

### Existing
- `zod@4.4.3` — validasi env sesuai pola config.
- `@anthropic-ai/sdk@0.104.2` — tetap digunakan; tidak ada perubahan integrasi SDK.
- Express sudah menjadi transport HTTP; tidak ada middleware/library baru.

### Baru

Tidak ada.

## Cerita dan skenario

### Cerita: Operator menghentikan spend LLM baru secara global

> Sebagai operator Camel, saya ingin mematikan permintaan LLM baru dengan satu env flag, supaya bug/loop tidak terus menghabiskan biaya.

**Aturan 1: Default mati mempertahankan perilaku**
- Contoh: env tidak diset atau `false` → board creation tetap mengklasifikasi dan menyimpan board sesuai perilaku yang ada.
- Contoh: env tidak diset atau `false` → jalur approve, percakapan, chat, dan ticket-intake tidak diblokir oleh guard.

```gherkin
Scenario: Switch default off mempertahankan pembuatan board
  Given AGENT_SPEND_KILL_SWITCH tidak diset atau bernilai "false"
    And pengguna sudah login dan merupakan anggota workspace
  When pengguna mengirim intent board yang valid
  Then klasifikasi LLM berjalan dan respons/perubahan board mengikuti perilaku saat ini
```

**Aturan 2: Penolakan terjadi sebelum efek samping spend-bearing**
- Contoh: create board ditolak sebelum classifier dan insert board/conversation/columns/event.
- Contoh: approve ditolak sebelum deteksi periode, status `running`, event generating, atau pipeline.
- Contoh: pesan klarifikasi, deteksi periode, dan follow-up ditolak sebelum pesan percakapan atau state pending regenerate dibuat.
- Contoh: chat send/retry ditolak sebelum SSE, insert pesan, placeholder, atau delete retry target.
- Contoh: ekstraksi ticket ditolak sebelum panggilan Anthropic.

```gherkin
Scenario: Pembuatan board ditolak tanpa menulis data
  Given AGENT_SPEND_KILL_SWITCH bernilai "true"
    And pengguna terautentikasi, anggota workspace, dan intent lolos validasi
  When pengguna meminta board baru
  Then server mengembalikan HTTP 503 dengan body tepat
    "{\"error\":\"Agent spend is disabled by kill switch\",\"code\":\"AGENT_SPEND_KILL_SWITCH\"}"
    And classifier tidak dipanggil
    And board, conversation, columns, dan event tidak dibuat

Scenario: Approval ditolak sebelum board menjadi running
  Given switch bernilai "true" dan pengguna memiliki board berstatus pending
  When pengguna menyetujui board
  Then server mengembalikan body kill-switch HTTP 503 yang tepat
    And deteksi periode status-report (jika berlaku), transisi status, event generating, dan runPipeline tidak terjadi
    And board tetap pending

Scenario: Klarifikasi board ditolak sebelum pesan disimpan
  Given switch bernilai "true" dan pengguna memiliki board pending non-status-report
  When pengguna mengirim pesan yang memerlukan pertanyaan klarifikasi LLM
  Then server mengembalikan body kill-switch HTTP 503 yang tepat
    And tidak ada pesan user/assistant baru dan LLM tidak dipanggil

Scenario: Deteksi periode percakapan ditolak sebelum catch fallback
  Given switch bernilai "true" dan pengguna memiliki board pending status-report
  When pengguna mengirim pesan yang masuk ke detectReportPeriod
  Then server mengembalikan body kill-switch HTTP 503 yang tepat
    And tidak ada pesan atau perubahan intent board
    And error tidak ditelan menjadi pertanyaan assistant biasa

Scenario: Follow-up board selesai ditolak sebelum klasifikasi
  Given switch bernilai "true" dan pengguna memiliki board selesai
  When pengguna mengirim follow-up yang biasanya diklasifikasi oleh LLM
  Then server mengembalikan body kill-switch HTTP 503 yang tepat
    And tidak ada pesan percakapan atau pending-regenerate baru

Scenario: Pemanggilan langsung runPipeline ditolak sebelum memulai pipeline
  Given switch bernilai "true" dan pemanggil service memanggil runPipeline secara langsung
  When service memulai pipeline board
  Then assertion bertipe menolak di awal pemanggilan sebelum runPipelineCard atau state write
    And tidak ada LLM call atau mutasi dari permintaan tersebut

Scenario: Entry point single-card agent menolak spend langsung
  Given switch bernilai "true" dan pemanggil service memanggil triggerExecution secara langsung
  When service memulai eksekusi single-card
  Then assertion bertipe di awal triggerExecution, sebelum blok try yang menangani eksekusi, menolak pemanggilan
    And error bertipe keluar dari method tanpa ditelan
    And event generating, executeCard, output, dan state write tidak terjadi
    And jika kelak dipanggil oleh HTTP route, route tersebut memetakan error ke body 503 kill-switch yang tepat

Scenario: Konfirmasi tanpa pending regenerate tetap no-op
  Given switch bernilai "true" dan tidak ada pending regenerate untuk board
  When pengguna mengirim konfirmasi regenerate
  Then respons no-op sukses yang berlaku tetap dikembalikan
    And tidak ada LLM call atau perubahan state

Scenario: Konfirmasi regenerate menjaga entry pending jika ditolak
  Given test memakai assertion kill switch yang bisa dikendalikan
    And test membuat pending regenerate saat assertion mengizinkan
    And assertion diubah menjadi menolak hanya untuk konfirmasi berikutnya
  When pengguna mengonfirmasi regenerate
  Then server mengembalikan body kill-switch HTTP 503 yang tepat
    And entry pending tidak dikonsumsi
    And pesan, status, output, kartu, event, dan pipeline tidak berubah
```

**Aturan 3: Batas chat stream dan error HTTP stabil**

```gherkin
Scenario: Chat send ditolak sebelum streaming dimulai
  Given switch bernilai "true" dan request chat valid setelah auth, akses, context, dan rate-limit checks
  When pengguna mengirim pesan chat baru
  Then server mengembalikan HTTP 503 JSON kill-switch yang tepat
    And header SSE/NDJSON belum dikirim
    And pesan user/assistant tidak ditulis dan runChatTurn tidak dipanggil

Scenario: Chat retry ditolak sebelum target dihapus
  Given switch bernilai "true" dan retry target valid
  When pengguna meminta retry pesan chat
  Then server mengembalikan HTTP 503 JSON kill-switch yang tepat
    And header streaming belum dikirim
    And target retry tidak dihapus, placeholder tidak dibuat, dan runChatTurn tidak dipanggil
```

**Aturan 4: Semua spend baru diblokir; operasi tanpa spend tetap berjalan**

```gherkin
Scenario: Ekstraksi ticket ditolak tetapi classifier awal tetap tersedia
  Given switch bernilai "true" dan ticket intake dikonfigurasi
  When pengguna mengirim turn ticket yang akan memanggil extractTicketFields
  Then server mengembalikan HTTP 503 JSON kill-switch yang tepat
    And Anthropic tidak dipanggil

Scenario: Pertanyaan classifier ticket tidak diblokir
  Given switch bernilai "true" dan pengguna mengirim first turn dengan isFirstTurn=true dan autoError=false
  When ticket intake memproses pesan valid
  Then pertanyaan classifier awal tetap dikembalikan
    And tidak ada LLM call

Scenario: Operasi database-only tetap tersedia
  Given switch bernilai "true"
  When pengguna membuat/melihat daftar/membaca/mengubah/menghapus thread chat, membatalkan regenerate, atau memakai jalur agent yang hanya menyimpan pesan saat board running
  Then operasi mengikuti perilaku DB-only yang ada tanpa memulai LLM

Scenario: Run yang sudah mulai tidak diputus guard
  Given pipeline telah memulai eksekusi sebelum permintaan baru ditolak
  When pipeline menyelesaikan atau gagal sesuai perilaku yang ada
  Then assertion kill switch tidak membatalkan atau memotong run tersebut
```

**Aturan 5: Pemeriksaan akses dan validasi tetap didahulukan**

```gherkin
Scenario: Error akses/validasi yang ada tetap didahulukan
  Given switch bernilai "true" dan request tidak terautentikasi, tidak berhak, tidak valid, bukan anggota, atau terkena rate limit
  When endpoint spend-bearing dipanggil
  Then error 401/403/400/404/429 yang sudah berlaku tetap dikembalikan
    And hanya request valid yang akan memakai LLM menerima 503 kill switch
```

**Asumsi operasi:** flag diparse saat server start dan config dibekukan. Operator mengubah `.env.production`, lalu menjalankan Compose `up -d --force-recreate server` untuk menerapkannya. Ini mengganti container; tidak dijanjikan bahwa run dalam proses lama selamat dari restart. Setelah flag aktif, jalur baru diblokir pada proses baru.

## Kriteria penerimaan

**ACCEPTANCE CRITERIA — Global Agent Spend Kill Switch**
Date: 2026-10-10 | Scope confirmed: yes

Rule: Default off
  ✓ Given env tidak diset atau `false`, When jalur spend valid dipakai, Then perilaku sekarang tetap berjalan.

Rule: Deny new spend
  ✓ Given flag `true`, When board creation atau approval yang valid diminta, Then HTTP 503 dengan body `{ "error": "Agent spend is disabled by kill switch", "code": "AGENT_SPEND_KILL_SWITCH" }` dikembalikan sebelum LLM/pipeline atau state mutation.
  ✓ Given flag `true`, When pesan klarifikasi/status-period/follow-up, regenerate yang benar-benar pending, atau pemanggilan langsung `runPipeline`/`triggerExecution` memulai spend, Then guard bertipe menolak sebelum pesan/status/pending state berubah atau LLM dipanggil.
  ✓ Given flag `true` dan tidak ada pending regenerate, When konfirmasi no-op dikirim, Then respons no-op existing tetap dikembalikan tanpa LLM.
  ✓ Given flag `true`, When chat send/retry diminta, Then 503 JSON dikirim sebelum header stream, insert, delete, placeholder, atau LLM.
  ✓ Given flag `true`, When ticket extraction akan memanggil LLM, Then 503 JSON dikirim sebelum Anthropic.

Rule: No denied-request writes
  ✓ Given request spend ditolak, When guard menolaknya, Then tidak ada pesan user/assistant, perubahan run/domain state, konsumsi pending regenerate, atau event yang berasal dari request itu; rate-limit accounting existing tetap dipertahankan.

Rule: Preserve non-spend behavior and in-flight work
  ✓ Given flag `true`, When permintaan pertama ticket classifier atau operasi DB-only dilakukan, Then perilaku existing tetap tersedia tanpa LLM.
  ✓ Given pipeline sudah berjalan, When switch memblokir request baru, Then pipeline yang berjalan tidak dibatalkan oleh guard.
  ✓ Given request gagal auth/validasi/access/rate-limit, When flag aktif, Then error lama tetap didahulukan.

Rule: Operational setup
  ✓ Given instalasi produksi memakai Compose, When flag diatur `true`/`false` dan service dibuat ulang, Then nilai diteruskan ke container server; `.env.example`, `.env.production.template`, Compose, dan instruksi operator konsisten.

Rule: Verification saat implementasi
  ✓ Given implementasi selesai, When `make check`, `npm run typecheck`, dan test server terkait dijalankan dengan perintah workspace-scoped, Then semua guard, typecheck, dan test lulus.
  ✓ Given config test, When flag tidak ada/false/true atau memiliki nilai invalid, Then default allow, deny behavior, dan validasi enum diuji.
  ✓ Given endpoint berjalan dalam production mode, When kill switch menolak request spend, Then response tepat HTTP 503 dengan kedua field body stabil diuji.
  ✓ Given direct service entrypoints, When runPipeline/triggerExecution ditolak, Then typed error keluar sebelum write/event/try-catch menelan rejection.

## Keputusan desain

**Dipilih: Opsi B — assertion bersama di pintu masuk spend-bearing**

Satu `assertAgentSpendAllowed()` dan error bertipe tinggal di `modules/agent/spend-kill-switch.ts`; diekspor lewat `modules/agent/index.ts`. Service/handler memanggil assertion setelah access/validation checks yang relevan, tetapi sebelum mutation atau LLM. Agent routes, chat message handler, dan ticket-intake menangani error tersebut secara eksplisit agar exact 503 JSON tetap konsisten. Gate tidak ditempatkan di tengah pipeline atau SDK.

### Opsi yang dibandingkan

**Opsi A — Gate coarse di middleware/router**
- Memerlukan pengecualian berlapis untuk read/CRUD/cancel/first-turn no-LLM, atau akan memblokir operasi yang harus tetap tersedia (skenario “Pertanyaan classifier ticket tidak diblokir” dan “Operasi database-only tetap tersedia”).
- Gate route-only juga mudah terlewati bila service spend dipanggil dari call site lain.
- Tidak dipilih: terlalu mudah salah memblokir atau meloloskan cabang.

**Opsi B — Assertion bersama di pintu masuk spend-bearing (dipilih)**
- Memenuhi semua skenario spend dan no-spend.
- Dapat ditempatkan sebelum write, sebelum pending-regenerate claim, serta sebelum SSE; satu error type menjaga respons lintas route.
- Tradeoff: perlu pemetaan error sempit di tiga HTTP surfaces dan gate perlu dirawat jika ada call site spend baru.

**Opsi C — Gate di `runChatTurn`/SDK atau di tengah pipeline**
- Gagal memenuhi no-write: chat sudah memulai stream/persist, agent bisa mengubah status atau percakapan sebelum pemanggilan helper.
- Berisiko memotong in-flight run, yang dikecualikan oleh issue.
- Tidak dipilih karena bertentangan dengan skenario “Pembuatan board ditolak tanpa menulis data”, “Chat send ditolak sebelum streaming dimulai”, “Chat retry ditolak sebelum target dihapus”, serta “Run yang sudah mulai tidak diputus guard”.

### Tradeoff diterima

- Kill switch memerlukan restart/recreate server, bukan hot reload.
- Permintaan valid yang ditolak mungkin tetap mengonsumsi satu percobaan rate-limit karena pemeriksaan rate-limit existing didahulukan; limit tetap sesuai kontrak lama.
- Perubahan env dan container recreation dapat menginterupsi run aktif; issue ini tidak menambahkan mekanisme penyelamatan.

## Pertanyaan terbuka / asumsi

| Pertanyaan | Jawaban | Risiko jika salah |
|---|---|---|
| Apakah flag bisa berubah tanpa restart? | Tidak; diasumsikan flag startup-only sesuai `config` yang dibekukan. Operator harus recreate container. | Mengubah file env saja tanpa recreation tidak mengubah proses yang sedang hidup. |
| Apa yang terjadi pada run ketika env diterapkan? | Tidak ada jaminan run selamat dari restart; hanya assertion aplikasi yang tidak abort run in-process. | Recreate/deploy dapat menghentikan run yang sedang berjalan. |
| Apakah request yang ditolak dihitung oleh rate limiter? | Ya, perilaku existing dipertahankan karena rate-limit checks mendahului guard. | Percobaan yang diblokir dapat memakai budget rate-limit singkat; tidak menambah spend LLM. |
| Apakah ticket intake yang tidak dikonfigurasi mengembalikan error kill switch? | Tidak; respons “not configured” existing tetap didahulukan. | Saat dua kondisi berlaku, error ketersediaan ticket intake terlihat lebih dulu. |
| Apakah confirmation regenerate saat switch aktif reachable setelah startup? | Tidak melalui perubahan env live; skenario guard ini defensif/test-only dengan config terisolasi, karena pending intent berada di memory. | Jangan menjanjikan operator bisa mengubah env live atau mempertahankan pending intent saat restart. |

Tidak ada pertanyaan blocking yang tersisa setelah review independen.

## Catatan implementasi

- Peta call site spend yang harus dicakup implementasi: `createBoard` → classifier; `approveBoard` → optional status-period detector + route pipeline; `sendMessage` → pending clarification/status period atau done-board follow-up; `confirmRegenerateBoard` → pipeline; `runPipeline` → card pipeline (dipanggil produksi dari approve/regenerate dan tersedia pada service); `triggerExecution` → single-card `executeCard` (tidak ada caller produksi saat ini, tetapi method tersedia pada service); chat message send/retry → `runChatTurn`; ticket-intake extraction → `extractTicketFields`.
- Untuk `approveBoard`, periksa board existence/workspace/owner lebih dulu agar 404/403 tetap menang; assertion harus terjadi sebelum status-period LLM dan atomic update.
- Untuk `sendMessage`, pilih cabang dan periksa akses/state terlebih dahulu, lalu assertion sebelum insert. Jangan memblokir jalur `executionStatus === "running"` yang hanya menyimpan pesan atau aksi cancel/read.
- Untuk regenerate, jika tidak ada pending intent, pertahankan no-op sukses existing tanpa menjalankan assertion spend. Jika intent ada, assertion sinkron dilakukan sebelum `pendingRegenerate.delete`; jangan sisipkan `await` antara pemeriksaan/claim supaya perilaku concurrency tetap terjaga. Test membuat pending intent dengan assertion mock yang mengizinkan lalu menolaknya sebelum confirm; ini tidak menyatakan env production bisa hot-toggle.
- Chat harus memeriksa switch setelah access/history/context/rate-limit checks dan sebelum `setStreamHeaders` serta `persistMessageStart`.
- Ticket harus menjaga urutan konfigurasi/auth/validasi/membership/first-turn/rate-limit; assertion tepat sebelum extraction. Jangan memasang gate pada submit/resubmit Linear yang tidak memanggil LLM.
- Catch status-period tidak boleh menelan error kill-switch. Jangan mengandalkan global `sanitizeError()` untuk body ini.
- Tambahkan mapping Compose `AGENT_SPEND_KILL_SWITCH: ${AGENT_SPEND_KILL_SWITCH:-false}`; dokumentasikan contoh aktivasi dan nonaktifasi menggunakan `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate server` dari direktori deploy.
- `runPipeline` dan `triggerExecution` adalah pintu masuk langsung yang bisa memulai spend; assertion masing-masing ditempatkan pada awal pemanggilan (bukan di tengah iterasi). `triggerExecution` harus diperiksa sebelum blok `try`-nya agar error tidak ditelan dan board tidak ditandai failed. Pencarian `server/src` menemukan caller produksi `runPipeline` hanya melalui approve/regenerate dan tidak menemukan caller produksi `triggerExecution`.
- Tidak perlu mengubah `executeCard` atau `runChatTurn` di tengah eksekusi; audit semua production call site sebelum handoff implementasi.
- File implementation yang diperkirakan: `config.ts`, `.env.example`, guard + unit test baru, agent `service.ts`/`board-conversation.ts`/`routes.ts`/`pipeline.ts`/`index.ts` dan tests, chat `message-stream.ts` dan tests, ticket-intake routes dan tests, `deploy/docker-compose.prod.yml`, `.env.production.template`, serta `deploy/README.md` (baru; belum ada saat scan).
- Test minimum mencakup assertion off/on + message/code stabil; config absent/false default dan nilai enum invalid; default-off regression pada create/approve/agent conversation/chat/ticket; service/routes untuk side-effect nol; mapping body 503 di production mode; chat send dan retry sebelum header; ticket first-turn versus extraction; error precedence; thread CRUD/DB-only; regenerate tanpa pending dan concurrency; direct `runPipeline`/`triggerExecution`; serta config/Compose default.
- Acceptance verification implementasi (belum dijalankan pada tahap spec): jalankan `make check` (lint + architecture guards; tidak menjalankan test/typecheck menurut `Makefile`), `npm run typecheck` secara terpisah, dan test server workspace-scoped, misalnya `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.test.ts` serta filter workspace-relative untuk service/routes/chat/ticket-intake. Jalankan command dari repo root; jangan memakai `npx vitest run` langsung.

## Rollback

- Atur `AGENT_SPEND_KILL_SWITCH=false` di `.env.production` dan jalankan kembali Compose `up -d --force-recreate server`.
- Untuk membatalkan kode, revert perubahan deploy/env dan guard pada PR. Tidak ada migrasi atau data transform yang perlu dibalik.
- Restart/recreate saat rollback juga dapat menghentikan run aktif; operator harus memperlakukan perubahan ini sebagai restart service biasa.

## Review independen Phase 4

**Status: Clear.** Edge-case-hunter meninjau GWT lengkap setelah revisi thread CRUD dan startup-only semantics (Explore `d16c48ac-700d-4a5`, 2026-10-10). Review awal mengarahkan posisi assertion sebelum write/SSE dan typed error mapping. Audit spend tambahan menemukan dua direct service entrypoints; review lanjutan mengonfirmasi guard di awal `runPipeline` dan sebelum `triggerExecution` try/catch, caller-level guard sebelum mutation/no-op behavior, serta caveat active-run/restart (general-purpose `4da34119-7a5d-4a6`, 2026-10-10).
