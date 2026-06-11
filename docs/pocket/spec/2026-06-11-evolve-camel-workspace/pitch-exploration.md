# Pitch Exploration: evolve-camel-workspace
Date: 2026-06-11 | Project: Camel | Status: pitch-only

---

## Problem Statement
Camel saat ini adalah kanban board yang solid — punya auth, presence, real-time updates, activity feed, dan flow metrics. Tapi scope-nya terbatas pada visualisasi workflow dan monitoring flow. Sebuah team workspace membutuhkan lebih dari itu: komunikasi tentang pekerjaan, perencanaan di luar board, dokumentasi bersama, dan integrasi dengan tools yang sudah dipakai team.

## Root Tension
Menambah konteks tanpa menambah complexity. Setiap enrichment harus mengurangi context switching, bukan menambah surface area.

## Key Constraints
- Small team 5-6 orang — toleransi complexity rendah, async-first
- Existing stack: React + Express + PostgreSQL + Redis — semua enrichment harus viable di stack ini
- Card sebagai atom — semua fitur baru harus orbit di sekitar card, bukan jadi halaman terpisah
- Tidak compete dengan Notion/Slack/Linear — fokus pada flow layer yang diperkaya
- Existing pitches: team collaboration (presence, real-time) dan multi-page layout (router, dashboard) — workspace enrichment harus complement, bukan conflict

## Success Looks Like
Developer bisa buka satu card dan langsung paham: apa yang harus dikerjakan, kenapa, apa yang sudah dicoba, PR mana yang terkait, apa yang diputuskan sebelumnya — tanpa buka tab lain.

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Pertanyaan #6 paling revealing: team pakai Camel untuk board, tapi masih pakai Slack untuk diskusi, Notion untuk docs, GitHub untuk code — gap ada di context switching
- Pertanyaan #7: "all-in-one" vs "integrator hub" — arah sangat berbeda
- Workspace bisa berarti tempat kerja bersama (async-first) atau sistem manajemen proyek (heavy)
- Yang dibutuhkan team kecil: konteks pada pekerjaan, bukan fitur lebih banyak

### First Principles Thinking — creative
Key insights:
- "Workspace harus punya chat" → Tidak. Chat itu ephemeral. Workspace bisa async-first
- "Workspace harus punya docs/wiki" → Docs bisa di repo. Yang dibutuhkan adalah konteks
- "Workspace harus all-in-one" → Slack + Trello + Google Docs works. Yang dibutuhkan reduced context switching
- Fundamental truth: team butuh konteks yang lebih kaya pada pekerjaan yang sudah ada — mengapa card ini di sini, apa yang sudah dicoba, apa yang blocking

### Six Thinking Hats — structured
Key insights:
- White Hat: Camel sudah punya board, columns, cards, WIP limits, flow metrics, activity feed, presence, real-time SSE, auth
- Yellow Hat: Workspace → single source of truth untuk semua pekerjaan
- Black Hat: Feature creep → bisa jadi "do everything" tool yang tidak excel di apapun
- Green Hat: Card as conversation, context panel, workspace pulse, integration cards, decision records
- Red Hat: Developer tidak mau switch tab, PM mau tahu progress tanpa tanya orang, new member mau onboarding cepat
- Blue Hat: Prioritas: 1) Context enrichment 2) Card-level communication 3) Integration 4) Docs

### Analogical Thinking — creative
Key insights:
- Linear: issue-centric, semua komunikasi di issue level. Tidak ada chat umum. → Camel bisa jadi card-centric workspace
- Notion: blocks terlalu flexible, bisa overwhelming → Jangan bikin flexible blocks. Enrich structure
- Slack: channel-based, ephemeral, hard to find decisions → Jangan bikin chat. Buat threaded discussion attached ke card
- GitHub: issues linked ke PRs, context kaya → Integration bikin card jadi hub yang link ke PR, branch, deploy status
- Pattern: tools terbaik punya center of gravity. Linear: issue. Notion: block. Slack: message. Camel: card

---

## Advisor Synthesis

### Key Insights (ranked by signal strength)
1. **"Card as center of gravity" is the unifying thread.** All 4 methods converge. Linear proves this works. Card should be the atom everything orbits.
2. **The real gap is *context on work*, not *more features*.** Team doesn't need another chat or wiki. They need: why is this card here, what was tried, what's blocking it, what PR touches it.
3. **"Workspace" ≠ "all-in-one."** Camel should not compete with Notion or Slack. Be the operational layer enriched by integrations.
4. **Communication should be work-bound, not channel-bound.** Threads attached to cards with decision markers are higher signal, lower noise, and persist as institutional memory.

### Patterns
- Async > sync — every method favored persistent, structured communication
- Enrich structure, don't replace it — columns + cards is a strength
- Integration is the multiplier — GitHub PR status on cards, auto-created cards from issues

### Ideas Worth Pursuing
| Idea | Why |
|------|-----|
| Card-level threaded discussion | Context lives where the work is |
| Context panel (sidebar on card click) | Single view: details + linked PRs + thread + activity |
| Integration cards | Auto-synced from GitHub issues, PR status visible |
| Decision records linked to cards | Context → Decision → Consequences. Onboarding gold |
| Workspace pulse (daily digest) | Morning summary: what changed, what's blocked |

### Discarded
| Idea | Why discard |
|------|-------------|
| Full chat system | Ephemeral, high noise. Competes with Slack and loses |
| Flexible block editor (Notion-style) | Too open. Loses structural advantage |
| Calendar / sprint planning | Different domain. Scope creep |
| Standalone docs/wiki section | Should be card attachments, not separate page |

---

## Spike Results
No spike triggered — no blocking technical unknowns identified.

---

## Approach Directions

### Direction A: Card-Centric Context Panel (Recommended)
Enrich card dengan context panel (sidebar) yang muncul saat card diklik. Panel berisi: card details, threaded discussion, linked PRs, activity history. Semua konteks di satu tempat.

+ Mengikuti prinsip "card as center of gravity" — semua enrichment di card level
+ UX familiar (Linear, Notion, GitHub issues pakai pattern ini)
+ Incremental — bisa build satu section pada satu time (details dulu, lalu threads, lalu integrations)
− Sidebar bisa jadi crowded kalau terlalu banyak konteks
− Perlu redesign card click behavior (dari modal/pop-up ke sidebar)

### Direction B: Integration-First Workspace
Fokus pada integrasi dengan tools yang sudah dipakai team (GitHub terlebih dahulu). Card auto-synced dari GitHub issues, PR status visible di card, deploy state terlihat. Workspace jadi hub yang connect ke ecosystem.

+ Langsung solve pain point terbesar: context switching antara Camel dan GitHub
+ Tidak perlu build fitur baru dari nol — leverage existing tools
+ Competitive advantage: "kanban + GitHub context" yang tidak ada di Trello/Notion
− Bergantung pada GitHub API — maintenance risk
− Hanya berguna untuk team yang pakai GitHub

### Direction C: Async Communication Layer
Tambahkan structured communication di card level: threaded discussion dengan decision markers, @mentions, dan workspace pulse (daily digest). Fokus pada async-first, work-bound communication.

+ Solve gap terbesar: komunikasi tentang pekerjaan yang tidak ter-record
+ Decision records jadi institutional memory
+ Async-first cocok untuk remote team
− Perlu build notification system
− Risk: jadi "another messaging tool" kalau tidak hati-hati

---

## Open Questions for pocket-grinding
- [ ] Bagaimana data model untuk threaded discussion? (comments table? replies? threading depth?)
- [ ] Apakah context panel replace existing card modal, atau coexist?
- [ ] GitHub integration: webhooks vs polling? Rate limits? OAuth flow?
- [ ] Decision records: format markdown biasa atau structured data?
- [ ] Workspace pulse: compute dari data yang sudah ada (activity feed + metrics) atau perlu aggregation baru?
- [ ] Bagaimana handle context panel di mobile? (sidebar pattern tidak ideal untuk small screen)
- [ ] Apakah perlu "card templates" untuk different types of work (bug, feature, chore)?

---

## Recommended Direction
**Direction A: Card-Centric Context Panel** — Paling aligned dengan insight "card as center of gravity." Mengikuti proven pattern (Linear, Notion). Incremental — bisa mulai dari enrichment sederhana (details + activity) dan grow ke threads + integrations. Direction B dan C bisa di-add nanti sebagai sections di dalam context panel.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction A (Card-Centric Context Panel) sebagai working hypothesis untuk Phase 5 Design Proposals
- Treat Open Questions di atas sebagai Phase 3 Discovery targets
- Do NOT treat Approach Directions sebagai final architecture — validate through GWT first
- Existing pitches (team-collaboration, multi-page-layout) harus complement, bukan conflict — check for overlaps
- Research references: docs/pocket/research/2026-06-11-pg-collaboration-capability/research-report.md untuk evidence backing team collaboration decisions

## Related Pitches
- **team-collaboration** (2026-06-10): Presence, real-time updates, activity feed — foundation untuk workspace
- **multi-page-layout** (2026-06-11): Router, dashboard, sidebar — structural foundation untuk multi-feature workspace
