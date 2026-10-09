# Research Report — React Router Approach Validation for Multi-Page Layout

- **Date:** 2026-06-11
- **Verdict:** Confirmed
- **Confidence:** Medium

---

## Assumption tested

**Operationalized question:**
> "React Router (react-router-dom) adalah routing solution yang **paling cocok** untuk 3-page SPA (Board, Dashboard, Activity) dengan sidebar navigation di stack React 18 + Vite + Tailwind v4, dibandingkan Tab-Based SPA (tanpa router) dan File-Based Routing (vite plugin), dengan mempertimbangkan constraint: mobile responsive (hamburger menu), SSE real-time connection lifecycle, dan professional feel dengan deep linking."

**Disconfirming observation:**
- Tab-Based SPA memberikan UX yang **equivalen atau lebih baik** untuk 3 pages tanpa dependency cost
- SSE connection lifecycle **significantly lebih sulit** dikelola dengan React Router dibanding tanpa router
- React Router menambah **unacceptable bundle size atau complexity** untuk hanya 3 pages
- File-Based Routing memberikan **meaningful advantage** yang outweigh plugin dependency
- Mobile responsive sidebar pattern **tidak work well** dengan React Router's routing model

---

## Methods used

| # | Method | Category | Digunakan untuk |
|---|--------|----------|-----------------|
| 1 | Documentation vs Reality Check | Triangulation | Cross-check React Router docs vs actual behavior, bandingkan claim Tab-Based dan File-Based approaches |
| 2 | Counterexample Hunt | Adversarial ← *required* | Cari concrete case di mana React Router **gagal** atau alternatif lebih cocok untuk 3-page SPA dengan SSE + mobile constraint |
| 3 | Differential Comparison | Empirical | Bandingkan trade-off ketiga approach secara langsung |

---

## Evidence

### A. Documentation vs Reality Check — React Router

| Aspect | What Docs Claim | What Reality Shows | Supports/Refutes |
|--------|-----------------|-------------------|------------------|
| **Sidebar Layout Pattern** | Official tutorial shows `<Outlet />` + sidebar with nested routes | Pattern matches Camel's layout requirement exactly — sidebar + content area | **Supports** |
| **SPA Mode** | `ssr: false` in config enables pure client-side SPA | Works as documented — no server rendering required | **Supports** |
| **Code Splitting** | `React.lazy` + Suspense at route level | Standard React pattern, works natively with React Router | **Supports** |
| **Vite Integration** | React Router v7 uses Vite as build system | Native integration, no compatibility friction | **Supports** |
| **Bundle Size** | Claims "less than 4KB" in v6 marketing | Reality: ~40KB gzipped for react-router-dom (Bundlephobia, ShouldIUseThisFramework.com) | **Refutes** (marketing vs reality) |

**Sources:**
- React Router Official Tutorial: Address Book (reactrouter.com/tutorials/address-book)
- React Router SPA Mode Docs (reactrouter.com/how-to/spa)
- TanStack Router Comparison (tanstack.com/router/v1/docs/comparison)
- ShouldIUseThisFramework.com: "React's Bundle Size Problem in 2026"
- Bundlephobia: react-router-dom

---

### B. Documentation vs Reality Check — Tab-Based SPA

| Aspect | What Docs Claim | What Reality Shows | Supports/Refutes |
|--------|-----------------|-------------------|------------------|
| **Zero Dependency** | No routing library needed | True — just useState for view switching | **Supports** |
| **Deep Linking** | Not available | URL doesn't change, can't bookmark/share specific views | **Refutes** |
| **Browser Navigation** | Back/forward buttons don't work | Confirmed — no history API integration | **Refutes** |
| **State Persistence** | Board state must persist across "tabs" | Without routing, state lives in component tree — unmounting loses state unless lifted to global store | **Refutes** |

**Sources:**
- Stack Overflow: "Single Page Application in React without React-Router" (SO #73715191)
- Medium: "Routing in React without React-Router" (Frontend Weekly)
- Pitch Exploration: Reverse Brainstorming failure modes

---

### C. Documentation vs Reality Check — File-Based Routing

| Aspect | What Docs Claim | What Reality Shows | Supports/Refutes |
|--------|-----------------|-------------------|------------------|
| **Convention over Configuration** | Files in `pages/` directory auto-map to routes | Works with vite-plugin-pages, generouted, @tanstack/router-plugin | **Supports** |
| **Automatic Code Splitting** | Each page becomes its own chunk | Depends on plugin — some require manual lazy() | **Neutral** |
| **Learning Curve** | Familiar if coming from Next.js | Convention differs between plugins (Next-style vs Remix-style) | **Refutes** (for 3 pages) |
| **Over-engineering** | Minimal setup | For 3 pages, the plugin adds complexity without proportional benefit | **Refutes** |

**Sources:**
- GitHub: hannoeru/vite-plugin-pages
- GitHub: oedotme/generouted
- TanStack Router: Installation with Vite
- Omar Elhawary: "File-based routing with React Router + Vite"
- Reddit r/reactjs: "Which file based router can I use in SPA with vite?"

---

### D. Counterexample Hunt — Failure Cases

| Counterexample | Source | Severity |
|----------------|--------|----------|
| **SSE connections don't close on page change** — EventSource stays open when navigating between routes | Stack Overflow #76165438 | **Medium** (fixable with architecture) |
| **React Router v6.12.1 navigation bug** — Links stopped working after upgrade | GitHub Issue #10579 | **Low** (fixed in v6.30+/v7.x) |
| **Tree shaking not implemented in v6** — Bundle much larger than claimed | GitHub Issue #10354 | **Low** (improved in v7) |
| **Bundle size ~40KB gzipped** — Significant for simple 3-page app | Bundlephobia, ShouldIUseThisFramework.com | **Medium** (acceptable for team tool) |
| **Backend tasks continue after EventSource close** — Server-side cleanup needed | Stack Overflow #76165438 | **Medium** (backend concern, not router) |

**Key Finding:** The SSE lifecycle issue is a **React lifecycle** problem, not a React Router deficiency. The fix is architectural: put SSE in the layout/root component, not in page components. Camel's existing `App.tsx` already does this correctly (SSE is in root `useEffect`).

---

### E. Differential Comparison

| Dimension | React Router | Tab-Based SPA | File-Based Routing |
|-----------|--------------|---------------|-------------------|
| **Deep Linking** | ✅ Yes | ❌ No | ✅ Yes |
| **Browser Back/Forward** | ✅ Yes | ❌ No | ✅ Yes |
| **Bundle Size** | ~40KB gzipped | 0KB extra | ~40KB + plugin |
| **Complexity** | Medium | Low | Medium-High |
| **SSE Lifecycle** | ⚠️ Needs careful handling | ✅ Simpler (one root) | ⚠️ Needs careful handling |
| **Mobile UX** | ✅ Well-supported | ✅ Simple | ✅ Well-supported |
| **Code Splitting** | ✅ Built-in | ❌ Manual | ✅ Automatic |
| **Learning Curve** | Low-Medium | Low | Medium |
| **Professional Feel** | ✅ URL changes | ❌ No URL changes | ✅ URL changes |
| **State Persistence** | ✅ Via route state/context | ⚠️ Manual lifting | ✅ Via route state/context |
| **Scalability** | ✅ Easy to add pages | ❌ Becomes messy | ✅ Easy to add pages |

---

## Curation notes

### Strongest Support
1. **Official sidebar layout pattern matches Camel exactly** — React Router docs show `<Outlet />` + sidebar with nested routes. No custom abstraction required.
2. **Deep linking is non-negotiable for a team tool** — A kanban board where you can't bookmark or share a URL (`/board`, `/dashboard`) is a degraded experience.
3. **Code splitting is free** — Dashboard (with charts) doesn't load until navigated to. Meaningful for metrics-heavy page.
4. **Vite integration is native** — React Router v7 uses Vite as its build system.

### Strongest Counter-Evidence
1. **SSE lifecycle is the real risk** — But this is a React lifecycle issue, not React Router. Fix: keep SSE in layout component, not page components. Camel's `App.tsx` already does this correctly.
2. **Bundle size ~40KB gzipped** — For 3 pages, this is real overhead. But Camel is a team productivity tool, not a landing page. Median React SPA is 215KB.
3. **Historical bugs (v6.12.1, tree shaking)** — Resolved in v6.30+ and v7.x.

### Key Contradiction
The pitch doc says "SSE harus global di app root" — this is **compatible** with React Router if the SSE lives in the layout component (the parent route), not in child routes. The contradiction only appears if the executor accidentally nests SSE inside a page component during migration. This is a **migration discipline** concern, not an architectural one.

### Gaps Identified
| Gap | Impact |
|-----|--------|
| No Technical Spike testing SSE behavior with React Router navigation | Medium — fixable with a 10-line test |
| No benchmark of actual bundle impact in this Vite setup | Low — Vite tree-shakes well |
| Tab-based approach only briefly evaluated | Medium — state persistence across "tabs" is harder without routing |
| No evaluation of `App.tsx` migration complexity (300+ lines) | High — this is the real implementation risk |

---

## Verdict & Reasoning

**Verdict: Confirmed**

**Confidence: Medium**

Evidence menunjukkan **React Router adalah pilihan terbaik** untuk multi-page layout di Camel:

1. **Tab-Based SPA gagal** pada deep linking dan browser navigation — keduanya essential untuk team tool. Tanpa URL yang berubah, user tidak bisa bookmark board view atau share link ke dashboard metrics.

2. **File-Based Routing over-engineered** untuk hanya 3 pages — plugin tambahan dengan convention yang berbeda-beda, tanpa proportional benefit dibandingkan manual route config.

3. **React Router's SSE concern adalah architectural, bukan library-specific** — Camel sudah handle SSE di root component. Yang dibutuhkan adalah migration discipline, bukan library change.

4. **Bundle size ~40KB acceptable** untuk team productivity tool yang membutuhkan professional feel.

**Sisa ketidakpastian:** Migration complexity dari `App.tsx` 300+ lines ke layout + page components. Ini implementation risk, bukan research question.

---

## Recommendation (Non-Binding)

### Terima Direction A: React Router + Layout Shell

Dengan catatan architectural:

```
┌─────────────────────────────────────────────────────────────┐
│                    Layout Component (root route)             │
│  - SSE connection (global EventSource)                      │
│  - Sidebar navigation (collapsible, hamburger on mobile)    │
│  - Presence bar                                             │
│  - Quick metrics indicator (optional)                       │
│  - <Outlet /> for page content                              │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  Board    │   │Dashboard │   │ Activity │
        │  Page     │   │  Page    │   │  Page    │
        │           │   │          │   │          │
        │ - Columns │   │ - Charts │   │ - Feed   │
        │ - DnD     │   │ - Metrics│   │ - Filter │
        │ - Cards   │   │ - Trends │   │          │
        └──────────┘   └──────────┘   └──────────┘
```

**Implementation guardrails:**
1. SSE `EventSource` HARUS di layout component, BUKAN di page component
2. Board state (columns, cards) harus di-cache di global context/store agar persist across navigation
3. Gunakan `React.lazy` + `Suspense` untuk code splitting per page
4. Mobile: hamburger menu di layout component, bukan per-page

### What would change this verdict

| Jika ditemukan... | Verdict berubah ke... |
|-------------------|----------------------|
| Tab-Based approach bisa provide deep linking tanpa routing library | **Refuted** (simpler approach exists) |
| SSE lifecycle terbukti significantly lebih sulit dengan React Router dalam Technical Spike | **Inconclusive** (need architecture redesign) |
| Bundle size >100KB untuk React Router di Vite setup ini | **Inconclusive** (cost too high for 3 pages) |
| `App.tsx` migration terbukti terlalu complex (>2 days effort) | **Inconclusive** (implementation risk too high) |

---

## Appendix: React Router Version Recommendation

| Version | Recommendation |
|---------|----------------|
| **React Router v7 (library mode)** | **Recommended** — latest stable, Vite native, SPA mode available |
| React Router v6 | Acceptable — battle-tested, but v7 is the future |
| React Router v7 (framework mode) | Overkill — requires SSR infrastructure, not needed for SPA |

**Install:** `npm install react-router` (v7 uses `react-router` package, not `react-router-dom`)

---

*Research conducted: 2026-06-11*
*Sources: React Router Docs, TanStack Router Comparison, Stack Overflow, GitHub Issues, Bundlephobia, ShouldIUseThisFramework.com, Medium, Reddit r/reactjs*
*Methods: Documentation vs Reality Check, Counterexample Hunt, Differential Comparison*
*Curation: Advisor review completed*
