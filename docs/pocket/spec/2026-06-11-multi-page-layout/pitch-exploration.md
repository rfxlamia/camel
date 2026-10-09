# Pitch Exploration: multi-page-layout
Date: 2026-06-11 | Project: Camel | Status: pitch-only

---

## Problem Statement
Camel saat ini adalah single-page kanban board dengan semua fitur (board, metrics, activity) dalam satu view, memberikan "prototype feel"而不是 "product feel". User tidak bisa fokus pada board karena metrics chips dan activity panel bersaing untuk perhatian di layar yang sama.

## Root Tension
**Maximizing board focus vs maintaining team awareness** — board perlu full-width untuk produktivitas, tapi team awareness (metrics, activity) harus tetap accessible tanpa mengganggu primary workflow.

## Key Constraints
- React + Vite + Tailwind CSS stack (existing)
- 4 flow metrics (throughput, lead time, cycle time, WIP) — perlu charts & historical data visualization
- Real-time updates via SSE — harus global connection, bukan per-page
- Mobile responsive — hamburger menu untuk sidebar collapse
- Start dengan 3 pages: Board, Dashboard, Activity (jangan over-engineer)
- Server belum ada historical metrics API — perlu endpoint baru dari card_events table

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Apakah sidebar persistent atau collapsible? → Collapsible lebih flexible
- Routing strategy: client-side (React Router) vs server-side → Client-side lebih cocok untuk SPA
- State management: perlu global state manager atau cukup Context? → Tergantung complexity
- Data loading: per page atau shared cache? → Shared cache dengan global SSE connection
- Metrics scope: existing 4 metrics atau dashboard lengkap? → User pilih charts & historical
- Mobile strategy: hamburger menu vs bottom nav → Hamburger (familiar pattern)

### First Principles Thinking — creative
Key insights:
- User goal: manage kanban board dan monitor team activity secara efisien
- Information hierarchy: board adalah primary action, metrics dan activity adalah secondary/tertiary
- Current assumption "semua harus visible sekaligus" salah — professional users lebih value focus daripada omnipresence
- Better principle: "primary action gets full attention, secondary actions accessible tapi tidak mengganggu"

### Six Thinking Hats — structured
Key insights:
- **White (Facts):** Components sudah terpisah (MetricsBar, ActivityFlow, ColumnView), tidak ada routing library
- **Yellow (Benefits):** Board dapat full-width, metrics bisa jadi dashboard lengkap, sidebar = natural expansion point
- **Black (Risks):** Extra navigation friction, state management complexity, real-time updates per page
- **Green (Creativity):** Quick metrics indicator tetap visible di semua pages, progressive disclosure
- **Blue (Process):** Prioritas: Install React Router → Create layout shell → Migrate pages satu per satu

### Reverse Brainstorming — creative
Key insights:
- **Failure mode:** User click 3x untuk lihat metrics yang dulu 0 click → **Insight:** Perlu quick metrics summary yang tetap visible
- **Failure mode:** SSE connection terputus setiap navigation → **Insight:** SSE harus global di app root
- **Failure mode:** User tidak tahu dia di page mana → **Insight:** Sidebar harus show active state clearly
- **Failure mode:** Over-engineer dengan 10 halaman → **Insight:** Start dengan 3 pages saja
- **Failure mode:** Mobile sidebar menghabiskan 50% layar → **Insight:** Hamburger menu
- **Failure mode:** Board state hilang saat navigation → **Insight:** Board state harus persist di global cache

---

## Advisor Synthesis
Semua metode converge ke **progressive disclosure** — show less by default, reveal on demand. Mobile responsiveness adalah constraint nyata, bukan hipotetis. State persistence across navigation harus di-solve secara arsitektural. Hybrid sidebar + contextual panel over-engineered; pilih satu approach. Breadcrumbs premature untuk 3 pages. Jangan design expandable nav trees sebelum ada fiturnya.

---

## Spike Results

**Unknown 1: Server Historical Metrics API**
**Finding:** Tidak ada historical metrics API. Current `/api/metrics` compute real-time dari card timestamps. `card_events` table dengan timestamps tersedia untuk derive historical trends.
**Implication:** Perlu buat endpoint baru yang query `card_events` untuk compute trends over time (throughput per week, lead time trend, dll). Atau store periodic metrics snapshots di `metrics_history` table.

**Unknown 2: Charting Library untuk React + Tailwind**
**Finding:** Recharts (15k+ stars) — standard React charting, composable, built on D3, works well dengan Tailwind. Tremor — specifically built untuk Tailwind dashboards. Nivo — rich visualization, SSR support.
**Implication:** Recharts adalah pilihan terbaik — paling mature, dokumentasi bagus, composable API cocok dengan React pattern yang sudah ada.

---

## Approach Directions

### Direction A: React Router + Layout Shell
Bangun layout shell dengan sidebar + content area, install React Router untuk client-side routing. Setiap page (Board, Dashboard, Activity) adalah route terpisah dengan shared layout.

+ Familiar pattern, well-documented, banyak contoh
+ Clean separation: layout terpisah dari page content
+ Support deep linking, browser back/forward
− Extra dependency (react-router-dom)
− Perlu restructure App.tsx yang sudah besar

### Direction B: Tab-Based SPA (No Router)
Tetap single-page, tapi gunakan tab navigation di sidebar untuk switch antar views. State management via React Context tanpa routing library.

+ Zero dependency tambahan
+ Simpler implementation
+ SSE connection tetap mudah (satu root component)
− Tidak ada deep linking (URL tidak berubah)
− Browser back/forward tidak work
− Less "professional" feel (no URL changes)

### Direction C: File-Based Routing (Vite Plugin)
Gunakan vite-plugin-react-routes atau similar untuk file-based routing (seperti Next.js tapi di Vite).

+ Convention over configuration
+ Automatic code splitting per page
+ Familiar jika pernah pakai Next.js
− Extra plugin dependency
− Learning curve untuk convention
− Over-engineered untuk 3 pages

---

## Open Questions untuk pocket-grinding
- [ ] Bagaimana struktur folder yang optimal untuk multi-page layout? (pages/ vs routes/ vs app/)
- [ ] Apakah perlu state manager global (Zustand) atau cukup React Context untuk board state?
- [ ] Bagaimana handle SSE connection lifecycle di multi-page context? (connect di root, distribute via context)
- [ ] Chart types apa yang cocok untuk visualisasi flow metrics? (line chart untuk trends, bar chart untuk throughput)
- [ ] Apakah perlu lazy loading untuk page components atau load semua sekaligus?

---

## Recommended Direction
**Direction A: React Router + Layout Shell** — React Router adalah standard untuk React SPA multi-page. Well-documented, predictable, dan memberikan professional feel dengan deep linking. Dependency cost kecil dibanding benefit. Cocok dengan constraint: React + Vite stack, 3 pages, mobile responsive (hamburger menu).

---

## Handoff Context (untuk pocket-grinding)
Ketika pocket-grinding membaca doc ini:
- Start dengan problem statement di atas (Phase 1 context)
- Gunakan Direction A sebagai working hypothesis untuk Phase 5 Design Proposals
- Treat Open Questions di atas sebagai Phase 3 Discovery targets
- JANGAN treat Approach Directions sebagai final architecture — validasi melalui GWT dulu
- Server perlu endpoint baru untuk historical metrics (spike result)
- Charting library: Recharts (spike result)
