# Pitch Exploration: connector-system
Date: 2026-06-22 | Project: Camel | Status: pitch-only

---

## Problem Statement
User Camel harus bolak-balik antara Camel dan tools lain (GitHub, Google Drive, Calendar, Teams) untuk mendapatkan konteks penuh tentang pekerjaan mereka. Tidak ada cara unified untuk melihat data dari tools lain di satu tempat — yang membuat manusia (dan ke depannya agent) kehilangan konteks.

## Root Tension
Kebutuhan unified context vs kompleksitas integrasi dengan banyak tools berbeda (credential, API, schema, sync).

## Key Constraints
- Schema-driven design agar agent-ready tanpa rewrite
- On-demand fetch, bukan persistent sync (v1)
- Read-only dulu, write capability nanti
- Credential management harus aman dan trustworthy
- UI: Integrations page (setup) + card-attached blocks (inline data)

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Connector vs plugin boundary: connector = external data source, plugin = extended Camel behavior
- 1-way read sufficient for v1, 2-way write is separate feature
- Credential storage is the biggest trust/adoption blocker
- On-demand fetch avoids polling/webhook/sync complexity
- Schema definition benefits both human UI and agent

### First Principles Thinking — creative
Key insights:
- Core purpose: surface relevant external data in context — everything else is implementation detail
- "Connector" is a "data lens" not an "integration platform"
- Asumsi di-challenge: connector butuh integrasi penuh? No, read-only snapshot cukup
- Asumsi di-challenge: data harus di-sync ke DB? No, fetch on-demand cukup

### Six Thinking Hats — structured
Key insights:
- White: No connector system exists yet, auth system exists (Better Auth + OAuth)
- Red: User frustration if setup too complex, trust issues with credential storage
- Yellow: Unified context = less context switching, agent becomes smarter
- Black: Maintenance burden per connector, security risk, scope creep risk
- Green: Connector as "data lens" attached to cards, auto-discovery concept
- Blue: Start with 1-2 POC connectors, schema-first, read-only first

### Analogical Thinking — creative
Key insights:
- Zapier/IFTTT: API abstraction layer pattern, trigger → action model
- MCP: Schema-driven, declarative, agent-friendly tool definitions
- Notion: Data tampil inline sebagai block, bukan redirect
- Slack Apps: 2-way butuh webhook, 1-way cukup polling — start with polling/on-demand

---

## Advisor Synthesis
All methods converged on: start small, read-only, 1-2 connectors as POC, schema-first design. On-demand fetch is preferred over persistent sync. Card-embedded data (like Notion blocks) aligns with "unified context" goal. Credential management is the biggest unsolved risk. MCP compatibility is a hidden constraint — schema-driven design now means agent-ready later without rewrite.

---

## Approach Directions

### Direction A: Schema-Driven Connector Framework
Build connector system dengan interface/schema yang ter-definisi. Setiap connector = TypeScript module yang implement interface dengan input/output schema.
+ Agent-ready dari awal, type-safe, auto-generatable UI
− Butuh investasi di framework layer sebelum connector pertama jalan

### Direction B: Embed-First (Notion-style)
Setiap connector = embeddable block yang bisa di-attach ke card. Block punya renderer dan fetcher sendiri.
+ User-facing cepat, fleksibel, familiar pattern
− Schema tidak ter-definisi = harder untuk agent nanti

### Direction C: Hybrid — Schema Core + Embed UI
Schema-driven core (connector interface) tapi UI-nya embeddable blocks. Best of both worlds.
+ Agent-ready + user-friendly
− Slightly more complex di awal

---

## Open Questions for pocket-grinding
- [ ] Bagaimana exact shape dari connector schema? (input/output, authentication, lifecycle)
- [ ] Bagaimana card-attached block dirender di UI? (React component per connector type?)
- [ ] Credential storage: di database, encrypted, atau external vault?
- [ ] Apakah connector perlu registration system (manifest) atau auto-discover dari directory?

---

## Recommended Direction
Direction C — Schema core memberi fondasi yang solid untuk agent, embed UI memberi experience yang fleksibel untuk user. Investasi di core framework akan terbayar saat agent system mulai pakai connector.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction C as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
