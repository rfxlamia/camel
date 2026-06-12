# Pitch Exploration: camel-settings
Date: 2026-06-12 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement
Camel has zero configuration surface — board name ("Camel"), logo (`/logo.png`), and feature states (AI) are all hardcoded. Users/admins cannot customize their board identity or toggle features on/off. For an open-source kanban board targeting plug-and-play configurability, this is a blocking gap.

## Root Tension
Adding a settings UI that feels complete without overwhelming users who expect a kanban board, not a control panel. Progressive disclosure vs discoverability.

## Key Constraints
- Client architecture uses React context + `useState` — supports transient state for live preview (confirmed via spike)
- No settings table exists in DB — schema only has `columns`, `cards`, `card_events`, `users`, `sessions`
- Sidebar renders hardcoded board name and logo — needs refactor to read from dynamic config
- Settings must support two scopes from day one: `user` and `board` (Notion/Trello lesson)
- Feature toggles (e.g., AI on/off) are boolean settings with sane defaults — board must work with zero configuration
- Destructive settings (reset, delete) need visual + behavioral isolation (GitHub pattern)

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Need to clarify target user: admin-only or per-member? → MVP: admin/board-level settings
- Settings must be grouped by scope first, then category to avoid future migration pain
- Destructive actions need double-confirm; non-destructive need toast feedback

### First Principles Thinking — creative
Key insights:
- Settings = interface for changing system behavior without changing code
- Every setting has `state` (current value) + `constraint` (valid values) — data model must reflect both
- Frequently-changed settings must be easy to access; rarely-changed can be deeper
- Defaults must be sane — board works out-of-box with zero settings touched

### Six Thinking Hats — structured
Key insights:
- ⚪ White: Camel currently has no settings infrastructure at all — starting from zero
- 🔴 Red: Personalization creates ownership feeling — users feel "this is MY board"
- 🟡 Yellow: Settings unlock white-labeling and feature control — selling point for open-source
- ⚫ Black: Too many settings = overwhelm. Proper grouping and progressive disclosure required
- 🟢 Green: Live preview for logo/nama reduces anxiety before committing changes
- 🔵 Blue: Group settings by: Identity, Features, Integrations, Danger Zone

### Reverse Brainstorming — creative
Key insights:
- All settings on one ungrouped long page = user lost → grouping is mandatory
- No feedback after save = user unsure if change persisted → toast/inline confirmation required
- No confirmation for destructive actions = disaster → double-confirm + visual isolation
- Bad defaults = broken first experience → sane defaults are non-negotiable

### Analogical Thinking — creative
Key insights:
- Notion: settings grouped by Account vs Workspace — clean separation
- Linear: opinionated, few choices — not overwhelming but less flexible
- Trello: Board settings vs Account settings — clear scope separation
- GitHub: "Danger Zone" with red visual cue at bottom — pattern for destructive actions

---

## Advisor Synthesis
The advisor converged on five key patterns across all methods: (1) progressive disclosure is the architectural spine — group by frequency-of-use, not just category; (2) "plug-and-play" resolves to two data-model primitives: feature flags + entity config, both storable in a single `settings` table with `key`, `value`, `scope`, `type`; (3) personal vs board scope separation is mandatory from day zero to avoid painful migration later; (4) toast feedback after every mutation is the cheapest win with highest impact; (5) danger zone with visual isolation is not optional. Discarded ideas: search/filter (premature for <30 settings), audit trail (out of scope, addable later via trigger), per-member personal settings (defer to post-MVP).

---

## Spike Results

**Unknown resolved:** Does client architecture support live preview for logo/board name without persisting?
**Finding:** Yes. Sidebar renders hardcoded `<img src="/logo.png">` and `<span>Camel</span>` in JSX. BoardContext uses `useState` for all data — same pattern works for transient settings state. Controlled input → state update → preview re-render is trivial. DB has no settings table yet (clean slate).
**Implication:** Live preview is low-risk, high-delight. Sidebar needs small refactor to read from dynamic config instead of hardcoded values.

---

## Approach Directions

### Direction A: Centralized Single Page
One Settings page with collapsible sections (Identity → Features → Integrations → Danger Zone). Single `/api/settings` endpoint for CRUD. Progressive disclosure via collapse/expand.
+ Simple, fast to build, familiar UX pattern for users
− Can feel long if settings grow significantly in the future

### Direction B: Tabbed Settings
Settings split into tabs (General · Features · Integrations · Danger Zone). Each tab loads independently. Pattern like Notion / GitHub Settings.
+ Clean separation, easy to scale per-tab
− Over-engineered for <20 settings at MVP. Extra routing and navigation overhead.

### Direction C: Board-native Settings Card
Settings groups displayed as "cards" on a mini-board — following the kanban metaphor already present in Camel.
+ On-brand, unique, memorable
− Unfamiliar UX for settings. Users expect forms, not boards. Accessibility concerns.

---

## Open Questions for pocket-grinding
- [ ] What specific settings should exist in MVP? (Identity: name, logo. Features: AI toggle. Others?)
- [ ] Should settings API use RESTful per-key endpoints or a bulk GET/PATCH pattern?
- [ ] How should settings propagate to the app — fetch-on-load in BoardContext, or separate SettingsContext?
- [ ] Should the settings page have a dedicated route (`/settings`) or live inside a modal/drawer?
- [ ] Image upload for logo — local file storage or external URL input?

---

## Recommended Direction
Direction A (Centralized Single Page) — for MVP with <20 settings, single page with collapsible sections is the sweet spot. Fast to build, easy to navigate, and can evolve to tabbed layout later if settings grow. Direction C is too risky for UX familiarity. Direction B is premature optimization.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction A as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
