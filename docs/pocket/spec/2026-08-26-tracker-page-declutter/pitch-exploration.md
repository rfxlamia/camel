# Pitch Exploration: tracker-page-declutter
Date: 2026-08-26 | Project: Camel | Status: pitch-only

---

## Problem Statement

The Tracker page (Items/Projects tabs) reads as "ugly" and "fused" to the user, but the fusion is mostly presentational, not structural: `TrackerPage.tsx` already branches the group-by picker, search label/placeholder, create button, and count label per tab. The dominant cause is an almost-empty page — 5 items (2 junk test rows), three status groups announcing zero count (Backlog 0, Todo 0, In Progress 0), and no per-tab toolbar row — that reads as generic and hollow rather than as two things sharing one shell.

## Root Tension

The natural response to "this feels bad" is to redesign navigation/IA. But this is the third consecutive Tracker cycle proposing a navigation change (project-location A/B/C → Items/Projects tabs → now a proposed split), and the two that shipped were each disliked afterward (`docs/pocket/spec/2026-08-01-workspace-pivot-scope` List/Calendar switcher rejected on sight; the tabs cycle is what's being complained about now). Content presentation — density, empty-state noise, real data — has never actually been touched. Restructuring nav a fourth time risks repeating the pattern instead of testing the actual hypothesis.

## Key Constraints

- Empty-group suppression already exists in `TrackerPage.tsx` but is gated to `searchActive` only (`if (searchActive && group.items.length === 0) return null`) — it does nothing on the default unfiltered view, which is what the screenshot shows.
- The toolbar already branches per tab (`TrackerPage.tsx`): group-by picker `{!projectsTab && …}`, search `aria-label`/placeholder ternary, create button swap ("New item" / "New project" with independent cap logic), count label swap. What's genuinely shared is one flex row and one search input — not two data models forced into one shell.
- `groupBy: "project"` already exists as an Items-tab grouping option — this *is* the existing cross-project "all my work" view. Any direction that removes project-owned items from an "Items" destination breaks this without replacement.
- Workspace `tes2` (the evidence source): 3 projects, 5 items, 2 of which are junk (`asda`, `iasdaisd`). The population is too small to confirm "two populations need separate nav" as a real problem yet — it's currently an assumption.
- Precedent on file: `docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/pitch-exploration.md` already evaluated Direction C (project index page, reached at `/tracker`) and recorded its cost: "adds a click for users with a single project — a regression against today's behaviour." The user's hub pitch in this session is that same direction with the index promoted to root.
- Project must not touch Board (`docs/pocket/spec/2026-08-03-tracker-entity`, reaffirmed constraint).

---

## Brainstorming Methods Used

Four methods — problem blends UX-facing complaint with an architecture-shaped decision (nav IA) that already has prior art on file.

### Question Storming — deep
Key insights:
- Is the population of project-less items majority or minority? Unresolved with current data (workspace has only 5 items total).
- If Items and Projects get separate routes, does an item that belongs to a project still appear in the "Items" destination?
- Does a hub screen add a click for every user, including the majority who have zero or one project — repeating the flagged Direction C regression?
- Is the empty-status-group noise a fully independent bug regardless of IA direction, or does it disappear once real data volume exists?

### First Principles Thinking — creative
Key insights:
- Tracker is not one page; it is two primitives — a stable address per unit of work (item key) and a rollup over a grouping (project/phase). Nav does not have to map 1:1 to a single page for these to coexist.
- A shared toolbar row is not a structural requirement — create-item vs create-project differ in meaning entirely and already have independent code paths (cap logic, modal). This is a ~10-line spacing/layout concern, not an architecture concern.
- **This bullet was corrected in advisor curation:** the initial claim that Items/Projects were "forced" onto one shared toolbar did not hold up against `TrackerPage.tsx`, which already branches nearly every toolbar element per tab.

### Solution Matrix — structured
Two axes: entry depth (direct vs. +1-click hub) × visual separation (shared shell/tab vs. separate route).

| | Shared shell (tab) | Separate route |
|---|---|---|
| **Direct** | Current state — one click, but toolbar/shell reads as undifferentiated (the actual complaint) | Sidebar-level split, own toolbar per destination — one click, structurally clean |
| **Hub (+1 click)** | Rarely worth it without a route change | User's original pitch — most explicit separation, but costs a click for every entry |

### Role Playing — collaborative
Key insights (grounded in the actual workspace, not invented personas):
- New user with zero projects: a hub forcing a Project/Item choice up front is friction when "Project" is empty — direct-default-to-Items serves this case better.
- User with 3 active projects and 5 items (the actual `tes2` state): switches between "everything I'm working on" and "progress on Project X" — two real destinations, not one page toggling between them.
- Solo quick-capture flow (mirrors Board's card quick-add): burying "New item" behind a hub or a Project-first tab adds friction to the most frequent action.

---

## Advisor Synthesis

The advisor's curation reversed the session's initial framing: the "forced shared toolbar" argument for a structural IA problem does not survive a re-read of `TrackerPage.tsx`, which already differentiates nearly every toolbar element per tab. The actual, evidenced cause of "ugly" is an almost-empty page whose empty-state suppression only activates during search. It also corrected an overstated claim that the shipped tabs were an unevaluated fourth direction — they're close to the already-evaluated Direction C, reached via tab instead of root, and the user's hub pitch is that same direction with its recorded regression (extra click for single-project users) intact. It flagged an unresolved contradiction inside the "separate routes" direction: whether an Items destination still shows project-owned items, given `groupBy: project` already serves as the cross-project view. Discarded: a PM/lead persona not grounded in the actual (solo, 5-item) workspace state, and "hub as summary dashboard" as a justification for the extra click, since Dashboard already exists as a separate sidebar entry.

---

## Approach Directions

Sequenced, not chosen — matching the pattern of the two prior Tracker pitch docs (settle the cheap layer, gate the expensive one on evidence).

### Direction A: Fix presentation, no nav change *(recommended — run first)*
Ungate empty-group suppression outside of search, give the Projects tab its own toolbar row instead of a branched shared one, clear junk data from the demo workspace.
+ Reversible, additive, no route changes — and it doubles as the test: if "ugly" disappears after this, IA does not need touching.
− If item/project volume grows large and genuinely mixed, the "two data models sharing a page" tension may resurface — just not visible at current data volume.

### Direction B: Sidebar-level split *(contingent on A)*
Items and Projects become two first-class sidebar entries with independent routes and fully independent toolbars. The cross-project view is preserved via the existing `groupBy: project` option surfaced in the Items destination.
+ Structurally clean, no added click, both populations genuinely first-class.
− Only justified if Direction A fails to resolve the complaint — otherwise this is a fourth navigation restructure in a project where the last one was already disliked.

### Direction C: Hub / index-at-root
Clicking "Tracker" lands on a chooser (Project vs. Item) before entering either destination — the user's original pitch.
+ Most explicit separation; would earn its place if Tracker ever grows a third destination (e.g. Roadmap) needing a shared landing.
− This is the already-evaluated Direction C from `2026-08-05-tracker-project-phase-wbs`, whose recorded cost stands: "adds a click for users with a single project — a regression against today's behaviour." Dominated by B unless it serves a purpose beyond visual separation.

---

## Open Questions for pocket-grinding

- [ ] Does clearing the empty-status-group noise and giving Projects its own toolbar row (Direction A) actually resolve the user's "ugly" impression, or does the complaint persist once measured against real (non-junk) data?
- [ ] If Direction B is triggered: does the "Items" destination still list project-owned items, or only project-less ones — and if the latter, how does the existing `groupBy: project` cross-project view get preserved?
- [ ] Is there a project cap or item-volume threshold at which Direction B's justification (two data models forced into one page) becomes evidenced rather than assumed?
- [ ] Should junk data cleanup in Direction A be a one-off manual fix for this workspace, or does it reveal a missing "delete workspace test data" affordance worth its own small fix?

---

## Recommended Direction

Direction A — it is the cheapest, most reversible change, and it directly tests the hypothesis that presentation (not navigation) is the actual cause, before committing to a fourth Tracker nav restructure in a project where the last two were each disliked after shipping.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use **Direction A** as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- **Sequencing is load-bearing, not optional:** B and C are gated on A being tried and measured first. Do not skip straight to a nav restructure without that evidence.
- **Superseded/related context:** `docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/pitch-exploration.md` (Direction A/B/C for project location — this pitch's Direction C is that doc's Direction C, not a new idea); `docs/pocket/spec/2026-08-03-tracker-entity/pitch-exploration.md` (original tracker-entity framing, Board must not be touched).
- Pattern to keep in view: three consecutive Tracker cycles have proposed navigation changes; two shipped and were disliked. Grinding should treat another nav change as a high-bar decision, not a default.
