# UI/UX Research References: Multi-Page Layout for Camel

**Date:** 2026-06-11  
**Status:** Supporting Research  
**Related:** [Pitch Exploration: multi-page-layout](../../spec/2026-06-11-multi-page-layout/pitch-exploration.md)

---

## Executive Summary

Research ini mengumpulkan UI/UX references dan best practices untuk mendukung implementasi multi-page layout pada Camel. Fokus pada: (1) sidebar navigation patterns, (2) dashboard metrics visualization, (3) mobile responsive navigation, dan (4) inspirasi dari tools populer (Linear, Notion, Trello, Jira).

---

## 1. Sidebar Navigation Patterns

### 1.1 Collapsible Sidebar Pattern

**Pattern:** Sidebar yang bisa di-expand (full width dengan labels) atau di-collapse (icon-only).

**Key Characteristics:**
- **Full width:** 224-300px (Notion menggunakan 224px, optimal untuk label text)
- **Collapsed width:** 48-64px (icon-only mode)
- **Animation:** Smooth CSS transition (0.2-0.3s)
- **State persistence:** Simpan collapsed/expanded state di localStorage

**Implementasi Populer:**
- **Notion:** Sidebar 224px dengan workspace name, search, navigation hierarchy
- **Linear:** Clean sidebar dengan sections (Teams, Favorites, My Issues)
- **Shadcn Dashboard:** Config-driven sidebar dengan composable navigation elements

**Source References:**
- [Notion Sidebar UI Breakdown](https://medium.com/@quickmasum/ui-breakdown-of-notions-sidebar-2121364ec78d)
- [Shadcn Sidebar Components](https://wrappixel.com/blog/shadcn-sidebar)
- [React Sidebar Examples](https://themeselection.com/blog/react-sidebar-examples-templates)

### 1.2 Sidebar Hierarchy Structure

**Best Practice:** Top-to-bottom flow yang mirror cara user scan layout.

**Recommended Structure (dari Notion pattern):**
```
┌─────────────────────┐
│ Workspace Name      │ ← Anchor point
├─────────────────────┤
│ 🔍 Search           │ ← Essential tools first
├─────────────────────┤
│ 📋 Board        [>] │ ← Primary navigation
│ 📊 Dashboard    [>] │
│ 📝 Activity     [>] │
├─────────────────────┤
│ ⭐ Favorites        │ ← Quick access
│ 📁 Projects         │ ← User content
└─────────────────────┘
```

**Key Insights:**
- Workspace/app name sebagai anchor di top
- Essential tools (search) muncul pertama
- Primary navigation items dengan icon + label
- Visual separation antar sections (spacing, dividers)
- Active state yang jelas (highlight, bold, atau color accent)

**Source:** [Notion Help Center - Sidebar Navigation](https://www.notion.com/help/navigate-with-the-sidebar)

### 1.3 Icon Consistency

**Best Practice:**
- Gunakan icon set yang konsisten (Lucide, Heroicons, atau Phosphor)
- Icon harus universally understood
- Label tetap penting untuk clarity (terutama untuk less-experienced users)
- Active icon bisa lebih prominent (filled vs outline)

---

## 2. Dashboard & Metrics Visualization

### 2.1 Flow Metrics Visualization Patterns

**Untuk Camel's 4 metrics (throughput, lead time, cycle time, WIP):**

| Metric | Recommended Chart | Rationale |
|--------|------------------|-----------|
| **Throughput** | Bar chart (weekly/monthly) | Mudah compare antar period |
| **Lead Time** | Line chart (trend) + Scatter plot | Show trend + distribution |
| **Cycle Time** | Line chart + Histogram | Trend + distribution pattern |
| **WIP** | Line chart (real-time) + Area chart | Show current state + history |

**Source:** [ProKanban - Visualizing Flow Metrics](https://www.prokanban.org/blog/visualizing-flow-metrics---where-to-begin)

### 2.2 Dashboard Layout Patterns

**Pattern 1: Inverted Pyramid (Recommended for Camel)**
```
┌─────────────────────────────────────────┐
│  KPI Summary Cards (4 metrics)          │ ← At-a-glance
├──────────────────┬──────────────────────┤
│  Throughput      │  Lead Time           │ ← Primary charts
│  (Bar Chart)     │  (Line Chart)        │
├──────────────────┼──────────────────────┤
│  Cycle Time      │  WIP                 │ ← Secondary charts
│  (Line + Scatter) │  (Area Chart)        │
├──────────────────┴──────────────────────┤
│  Detailed Table / Recent Activity       │ ← Drill-down
└─────────────────────────────────────────┘
```

**Pattern 2: Dashboard Quartet (2x2 Grid)**
- 4 charts dalam grid yang balanced
- Cocok untuk compare metrics side-by-side
- Visual weight yang seimbang

**Pattern 3: Executive Summary**
- 1 large primary visualization + supporting panels
- Cocok jika ada 1 metric yang paling penting

**Source:** [Dashboard Design Principles - Excelsior](https://express.excelsior.edu/datascience/chapter/5-6-dashboard-design-and-layout-principles)

### 2.3 Chart Design Best Practices

**Visual Hierarchy:**
- KPI cards di atas (paling prominent)
- Primary charts di tengah
- Supporting data di bawah
- Top-left corner = most important real estate (natural reading pattern)

**Color Strategy:**
- Gunakan warna konsisten untuk setiap metric
- Accent color untuk highlights/alerts
- Neutral colors untuk background/secondary elements
- Accessibility: pastikan sufficient contrast ratio

**Data Context:**
- Selalu show comparison (vs previous period, vs target)
- Sparklines next to KPI numbers untuk show trend
- Tooltip untuk detail on hover

**Source:** [Geckoboard - Effective Dashboard Design](https://www.geckoboard.com/resources/dashboard-design)

### 2.4 Recommended Chart Library

**Recharts** (Recommended)
- 15k+ stars, most mature React charting library
- Composable API cocok dengan React patterns
- Built on D3, works well dengan Tailwind
- Good documentation dan community

**Alternatives:**
- **Tremor:** Specifically built untuk Tailwind dashboards
- **Nivo:** Rich visualization, SSR support

**Source:** [Spike Result - Pitch Exploration](../../spec/2026-06-11-multi-page-layout/pitch-exploration.md)

---

## 3. Mobile Responsive Navigation

### 3.1 Hamburger Menu Pattern

**Best Practice untuk Camel:**
- Gunakan standard 3-line icon (☰)
- Place di top-left corner (users consistently look there)
- Avoid extra styling/borders pada icon
- Label "Menu" helpful untuk less-experienced users

**Implementation Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **Drawer/Overlay** | Familiar, full-width menu | Covers content |
| **Slide-in Sidebar** | Smooth animation | Can feel janky |
| **Bottom Sheet** | Modern, thumb-friendly | Less familiar |

**Recommended untuk Camel:** Drawer/Overlay pattern (paling familiar)

**Source:** [NNGroup - Hamburger Menu Icon Recognizability](https://www.nngroup.com/articles/hamburger-menu-icon-recognizability)

### 3.2 Responsive Breakpoints

**Standard Breakpoints:**
```css
/* Mobile First Approach */
/* Base: < 640px (mobile) */
/* sm: ≥ 640px (large mobile) */
/* md: ≥ 768px (tablet) */
/* lg: ≥ 1024px (desktop) */
/* xl: ≥ 1280px (large desktop) */
```

**Sidebar Behavior:**
- **Mobile (< 768px):** Hidden sidebar, hamburger menu
- **Tablet (768-1024px):** Collapsed sidebar (icon-only)
- **Desktop (> 1024px):** Full sidebar (icon + labels)

**Source:** [Figma - Guide to Hamburger Menu Design](https://www.figma.com/resource-library/hamburger-menu)

### 3.3 Mobile Navigation Alternatives

**Bottom Tab Bar (Alternative to Hamburger):**
- 3-5 core actions
- ~70% of iOS/Android apps use this
- Better thumb reach on mobile

**Untuk Camel:** Hamburger lebih cocok karena:
- 3 pages (Board, Dashboard, Activity) terlalu sedikit untuk bottom tab
- Sidebar pattern konsisten dengan desktop
- Familiar pattern untuk web apps

**Source:** [Smashing Magazine - Navigation Design for Mobile](https://www.smashingmagazine.com/2022/11/navigation-design-mobile-ux)

---

## 4. Inspirasi dari Tools Populer

### 4.1 Linear

**Sidebar Design:**
- Clean, minimal sidebar dengan sections
- Teams, Favorites, My Issues navigation
- Collapsed sidebar dengan icon-only mode
- Command palette (⌘K) untuk quick navigation

**Dashboard/Insights:**
- Timing charts dengan logarithmic scale
- Percentile metrics per slice
- Cycle velocity, issue completion rates
- Scope changes dan carryover work tracking

**Key Takeaway:** Progressive disclosure — show less by default, reveal on demand

**Source:** [Linear Redesign Blog](https://linear.app/now/how-we-redesigned-the-linear-ui), [Linear Docs - Dashboards](https://linear.app/docs/dashboards)

### 4.2 Notion

**Sidebar Design:**
- 224px width (optimal untuk text labels)
- Workspace name sebagai anchor
- Search di top
- Hierarchical navigation (Teamspaces, Shared, Private)
- Favorites section untuk quick access

**Spacing Strategy:**
- Consistent padding di semua sides
- Visual separation antar sections
- Active state dengan highlight

**Key Takeaway:** Sidebar width matters — 224px sweet spot antara terlalu sempit (text chopped) dan terlalu lebar (wasted space)

**Source:** [Notion Sidebar UI Breakdown](https://medium.com/@quickmasum/ui-breakdown-of-notions-sidebar-2121364ec78d)

### 4.3 Trello

**Dashboard View:**
- Cards per list, per due date, per member, per label
- Bar graph atau pie chart options
- Customizable tiles
- Premium feature (not on free plan)

**Key Takeaway:** Dashboard sebagai separate view, bukan embedded di board

**Source:** [Trello Dashboard View](https://support.atlassian.com/trello/docs/dashboard-view)

### 4.4 Jira

**Kanban Board + Dashboard:**
- Board view dengan columns (To Do, In Progress, Done)
- Dashboard view dengan metrics dan charts
- Burndown charts, velocity charts, sprint reports
- Cumulative flow diagrams, control charts

**Key Takeaway:** Separate board dan dashboard views, each optimized for different use cases

**Source:** [Jira Dashboard Examples](https://www.geckoboard.com/dashboard-examples/support/jira-dashboard)

### 4.5 Dribbble/Design Inspiration

**Kanban Board Designs:**
- [Dribbble - Kanban Board Tags](https://dribbble.com/tags/kanban-board)
- [Dribbble - Collapsible Sidebar Navigation](https://dribbble.com/search/collapsible-sidebar-navigation)
- [NicelyDone - Sidebar Navigation Examples](https://nicelydone.club/tags/sidebar-navigation)
- [Navbar Gallery - Sidebar Menu Examples](https://www.navbar.gallery/type/side-bar)

**Dashboard Designs:**
- [Muzli - 50 Best Dashboard Design Examples](https://muz.li/blog/best-dashboard-design-examples-inspirations-for-2026)
- [Layers - Kanban Board Designs](https://layers.to/search/kanban-board)

---

## 5. Best Practices Summary

### 5.1 Sidebar Navigation

| Practice | Rationale |
|----------|-----------|
| **224px width (expanded)** | Optimal untuk label text tanpa truncation |
| **48-64px width (collapsed)** | Icon-only, space efficient |
| **Smooth transition (0.2-0.3s)** | Professional feel, not jarring |
| **Active state highlight** | Clear indication of current page |
| **Persistent state** | Remember collapsed/expanded preference |
| **Keyboard navigation** | Accessibility requirement |

### 5.2 Dashboard Metrics

| Practice | Rationale |
|----------|-----------|
| **KPI cards di atas** | At-a-glance visibility |
| **5-7 primary KPIs max** | Avoid information overload |
| **Comparison context** | vs previous period, vs target |
| **Consistent chart types** | Familiar patterns, easier to scan |
| **Drill-down capability** | Progressive disclosure |
| **Responsive charts** | Work on all screen sizes |

### 5.3 Mobile Navigation

| Practice | Rationale |
|----------|-----------|
| **Hamburger di top-left** | Users expect it there |
| **Full-width overlay menu** | Maximize touch targets |
| **Clear active state** | User knows where they are |
| **Smooth animation** | Professional feel |
| **Touch-friendly targets** | Min 44x44px tap area |

---

## 6. Implementation Recommendations for Camel

### 6.1 Sidebar Implementation

**Recommended Stack:**
- React Router untuk client-side routing
- Tailwind CSS untuk styling
- Lucide icons untuk consistency
- `useState` + `localStorage` untuk collapsed state

**Sidebar Structure:**
```
┌─────────────────────────┐
│ 🐪 Camel               │ ← App name/logo
├─────────────────────────┤
│ 🔍 Search               │ ← Quick access
├─────────────────────────┤
│ 📋 Board            [>] │ ← Primary nav (active)
│ 📊 Dashboard        [>] │
│ 📝 Activity         [>] │
├─────────────────────────┤
│ ⚙️ Settings             │ ← Utility
└─────────────────────────┘
```

### 6.2 Dashboard Implementation

**Layout:** Inverted Pyramid pattern
1. **Top:** 4 KPI cards (throughput, lead time, cycle time, WIP)
2. **Middle:** 2x2 chart grid (primary visualizations)
3. **Bottom:** Recent activity / detailed table

**Chart Recommendations:**
- **Throughput:** Bar chart (weekly comparison)
- **Lead Time:** Line chart (trend over time)
- **Cycle Time:** Line chart + scatter plot (trend + distribution)
- **WIP:** Area chart (current state + history)

### 6.3 Mobile Strategy

**Breakpoints:**
- **< 768px:** Hamburger menu, full-width overlay
- **768-1024px:** Collapsed sidebar (icon-only)
- **> 1024px:** Full sidebar (icon + labels)

**Touch Targets:**
- Minimum 44x44px untuk semua interactive elements
- Generous padding pada menu items
- Clear visual feedback pada tap

---

## 7. Further Research Needed

- [ ] Test sidebar width pada actual screen sizes (responsiveness)
- [ ] Validate chart types dengan actual data dari `card_events` table
- [ ] User testing: hamburger vs bottom tab pada mobile
- [ ] Performance testing: Recharts dengan large datasets
- [ ] Accessibility audit: keyboard navigation, screen reader support

---

## Sources

### Primary Sources
1. [Notion Sidebar UI Breakdown](https://medium.com/@quickmasum/ui-breakdown-of-notions-sidebar-2121364ec78d)
2. [Linear Redesign Blog](https://linear.app/now/how-we-redesigned-the-linear-ui)
3. [Linear Docs - Dashboards](https://linear.app/docs/dashboards)
4. [ProKanban - Visualizing Flow Metrics](https://www.prokanban.org/blog/visualizing-flow-metrics---where-to-begin)
5. [NNGroup - Hamburger Menu Icon Recognizability](https://www.nngroup.com/articles/hamburger-menu-icon-recognizability)

### Design Inspiration
6. [Dribbble - Kanban Board Tags](https://dribbble.com/tags/kanban-board)
7. [Dribbble - Collapsible Sidebar Navigation](https://dribbble.com/search/collapsible-sidebar-navigation)
8. [NicelyDone - Sidebar Navigation Examples](https://nicelydone.club/tags/sidebar-navigation)
9. [Navbar Gallery - Sidebar Menu Examples](https://www.navbar.gallery/type/side-bar)
10. [Muzli - 50 Best Dashboard Design Examples](https://muz.li/blog/best-dashboard-design-examples-inspirations-for-2026)

### Technical References
11. [Shadcn Sidebar Components](https://wrappixel.com/blog/shadcn-sidebar)
12. [React Sidebar Examples](https://themeselection.com/blog/react-sidebar-examples-templates)
13. [Figma - Guide to Hamburger Menu Design](https://www.figma.com/resource-library/hamburger-menu)
14. [Smashing Magazine - Navigation Design for Mobile](https://www.smashingmagazine.com/2022/11/navigation-design-mobile-ux)
15. [Geckoboard - Effective Dashboard Design](https://www.geckoboard.com/resources/dashboard-design)

### Tools References
16. [Trello Dashboard View](https://support.atlassian.com/trello/docs/dashboard-view)
17. [Jira Dashboard Examples](https://www.geckoboard.com/dashboard-examples/support/jira-dashboard)
18. [Notion Help Center - Sidebar Navigation](https://www.notion.com/help/navigate-with-the-sidebar)
19. [Dashboard Design Principles - Excelsior](https://express.excelsior.edu/datascience/chapter/5-6-dashboard-design-and-layout-principles)
20. [Recharts Documentation](https://recharts.org/)

---

## Research Methodology

**Methods Used:**
1. **Web Search** (Tavily) — untuk mencari UI/UX patterns dan best practices
2. **Documentation Review** — Linear, Notion, Trello official docs
3. **Design Inspiration** — Dribbble, NicelyDone, Navbar Gallery
4. **Technical References** — React component libraries, CSS patterns

**Limitations:**
- Tidak ada user testing atau A/B testing data
- References berdasarkan public documentation, bukan internal analytics
- Mobile patterns berdasarkan industry standards, bukan Camel-specific research

---

*Research ini bersifat advisory. Gunakan sebagai input untuk design decisions, bukan mandate.*
