# Pitch Exploration: tracker-entity
Date: 2026-08-03 | Project: Camel | Status: pitch-only

---

## Problem Statement

Camel only models fast-moving daily operational work (kanban cards). Product/backlog work with a weeks-long horizon has no home: no durable record, no stable reference to cite in a commit or conversation, and no way to classify or prioritise. Tracker introduces a separate per-workspace entity for that population, with its own page.

## Root Tension

The entity itself is cheap — a new table, a per-workspace counter, and a shared vocabulary mechanism, none of which touch existing production data. **The page is where the cost and the risk live**, and the risk is specific: the immediately preceding cycle (`2026-08-01-workspace-pivot-scope`) shipped a List/Calendar view switcher that was rejected on sight, and its browsing UI is precisely the part being reached for again.

## Key Constraints

- **Two distinct populations, evidenced.** The user's Board holds `fuel daily desc`, `push PR deviano`, `Weekly Meeting` — daily ops. Their reference tracker holds `Workspace Rename`, `[Tech Debt] Refactor realtime.ts` — weeks-horizon product work. The failed cycle rendered the *wrong dataset*, not merely the wrong layout.
- **Granularity is 1:N, not 1:1.** One Tracker item (`Workspace Rename`) spawns several Board cards over weeks (design modal, PATCH endpoint, push PR). Any write-back rule ("item is done when its card is done") is unspecifiable today.
- **`cards.id` is a global SERIAL** (`server/src/db/schema.sql:12-20`); `workspaces` has no key/prefix column. Because Tracker gets its own table, this stops mattering — no ordinal retrofit, no backfill of production cards.
- **Card keys may have gaps** (user decision). Allocation is a counter column plus `UPDATE … RETURNING` — atomic, no lock.
- **Scale is dozens, not hundreds.** 29 cards in one Done column already makes it unreadable. At that size no new index and no new read endpoint is justified — `idx_cards_workspace` already exists (`schema.sql:119`) and a few hundred rows seq-scan in under a millisecond.
- **The failure is card height, not row count.** Board cards render title + description preview + due + avatars at roughly 110px; 29 of them is ~3,200px of scroll. A 40px dense row is the actual win.
- **Board must not be touched.** Kanban is the mature, loved core; the user reaffirmed this after seeing view-preferences layered on it.
- **Must honour existing conventions:** `recordActivity()` on every mutation, the `card_events.event_type` + `payload JSONB` pattern (extensible without migration, `schema.sql:59-61`), optimistic locking via `version`, soft delete via `deleted_at`.
- **Reusable today:** `client/src/lib/columnColorUtils.ts` (OKLCH swatch generation, already powering column colours), `client/src/lib/boardViewUtils.ts` and `client/src/components/ListView.tsx` as dense-row primitives, `camel:workspace:{id}:events` realtime channel (`server/src/realtime.ts:13`) — per-workspace already, so no new channel.

---

## Brainstorming Methods Used

Five methods — problem type is a technically-loaded new feature, high stakes, and a **previous attempt failed**, which the selection guide treats as the trigger for a five-method run.

### Question Storming — deep
Key insights:
- Does the card key come from the global `cards.id` or a per-workspace counter? (Answered by the reframe: neither — a new table's own counter.)
- Are labels a workspace-owned vocabulary or free text per item? Who may create one?
- If the Board ignores labels/priority, will users trust the data at all? (Answered by the reframe: Board never sees them.)
- Where does filter state persist — URL, localStorage, or nowhere? The previous cycle partly died on localStorage-only state.
- **At what card count does the Board actually break — is "hundreds" data or assumption?** This became the spike.

### First Principles Thinking — creative
Key insights:
- Camel already stores every axis Tracker needs except three: label, priority, key.
- "A tracker is a table" is not fundamental. What is fundamental: a **stable address** per unit of work, and the ability to **ask questions across the set**.
- Labels and priority are not the same kind of thing — one is a many-to-many workspace vocabulary, the other a single ordered scalar. Calling both "metadata" hides that.
- The Board's scale failure is not rendering; it is that **column is the only grouping**.

### Six Thinking Hats — structured
Key insights:
- **White:** `event_type` + `payload JSONB` already absorbs new activity types without migration; the realtime channel is already per-workspace.
- **Red:** the previous cycle shipped something nobody wanted; that fear should push toward shipping data with standalone value before a new surface.
- **Yellow:** each piece has independent worth — keys make Camel citable in commits and PRs, matching the workflow this repo already runs.
- **Black:** three new data entities in one cycle is exactly the bundling that produced the failed pivot; a taxonomy-management UI (rename/delete/merge) is its own feature.
- **Green:** ship card keys alone, or validate the page over axes that already exist.
- **Blue:** this pitch should probably recommend a **sequence**, not a single direction.

### Constraint Mapping — deep
Key insights:
- Real: per-workspace ordinal allocation must be concurrency-safe; `deleted_at` and `version` must be honoured on every query and write.
- **Mis-bucketed as real, corrected:** "no index supports the filter axes" and "the board payload is the wrong shape". Both are only true at tens of thousands of rows per workspace, not dozens. Left uncorrected, these two would have inflated the cycle into new indexes plus a new endpoint.
- Imagined: "labels need a colour picker" — `columnColorUtils.ts` already generates OKLCH swatches.

### Assumption Reversal — deep
Key insights:
- **Assumed** all three additions are needed for Tracker to be worth building. **Reversed:** if only one shipped, card keys alone raise the value of every existing surface.
- **Assumed** users want to filter. **Reversed:** they may want to **search** — one input and an `ILIKE`, with none of the persistence questions that killed the last cycle.
- **Assumed** Board stays untouched. **Reversed:** under the original framing, labels on `cards` would have *forced* Board changes. This is what later collapsed the whole framing.
- **Assumed** the failed cycle's code is waste. **Reversed:** `boardViewUtils.ts` and `ListView.tsx` are exactly Tracker's row primitives.

---

## Advisor Synthesis

The advisor confirmed a genuine four-of-five convergence — the data additions are separable, each has standalone value, and the page is the least valuable part — and flagged that this **contradicted the intake framing** ("list view akan jadi tracker", i.e. a page first). It corrected the index and payload constraints from real to imagined at the stated scale, which is what kept new indexes and a new read endpoint out of the cycle. It also rescued search-instead-of-filter from the discard pile. After the user reframed Tracker as its own entity, the advisor identified the single question that decides the architecture (the Tracker-item ↔ Board-card relationship) and confirmed that moving keys, labels, and priority onto the new table dissolves the "Board must display them or users won't trust them" risk entirely.

---

## Spike Results

**Unknown resolved:** At what task volume does the Board actually become unusable — is "hundreds" evidence or assumption?

**Finding:** The local database holds 1 card across 1 workspace — development seed, not beta data, so it answered nothing. The user supplied the real evidence directly: **29 cards in a single Done column** already makes it an unreadable tower. Diagnosis from the screenshot: the failure is **card height** (~110px each: title, description preview, due date, avatars), not row count. 29 × 110px ≈ 3,200px of scroll in one column; the same 29 items as 40px dense rows is ≈ 1,160px.

**Implication:** Two things dropped out of scope on this evidence — index work and a new read endpoint are both definitively premature at dozens of rows. One thing came *in*: the swollen column is **Done**, and completed work accumulating forever has a far cheaper fix than a new page (archive, collapse, or filter Done on the Board). That fix is now fully independent of Tracker and is listed as a separate candidate below, deliberately passed over rather than silently ignored.

---

## Approach Directions

All three share the same foundation, settled during pitching: a `tracker_items` table **independent** of `cards` (no FK), per-workspace card keys with gaps permitted, and a single vocabulary mechanism serving three configurations — **status** (single-select, ordered, e.g. Backlog/Todo/In Progress/Done/Canceled), **priority** (single-select, ordered, e.g. High/Medium/Low), and **labels** (multi-select, unordered, e.g. Feature/Bug/Maintain) — each with built-in defaults, user-customisable, with custom colours. They differ only in how much browsing power the page ships with.

### Direction A: Records first, browsing minimal
Entity, keys, and vocabulary, with the thinnest possible page: a flat dense list, create/edit, and search. No grouping, no filter UI.
+ Cannot repeat the previous failure by construction — the data is new, so it cannot be redundant with the Board. Which grouping axes earn their keep becomes answerable only once real items exist.
− A flat list of 30 backlog items does not resemble the reference screenshot that motivated the feature.

### Direction B: Grouped by status, no axis switcher *(recommended)*
Everything in A, plus the list is **always** grouped by status with collapsible section headers — matching the reference exactly. No "group by…" control, no filter UI, no URL state. Search only.
+ Looks like the reference while avoiding nearly all of C's cost; single-axis grouping is straight-line code with no persistence questions.
− If slicing by label or priority turns out to be a frequent need, this ceiling is hit quickly.

### Direction C: Full Tracker in one cycle
Everything in B, plus grouping by any axis, a filter UI, and browsing state persisted in the URL.
+ Delivers all three of the jobs selected at intake at once.
− The largest surface, and grouping plus filtering is exactly where the previous cycle's traps live: state persistence, and axes that cannot be validated as worth building before real items exist.

---

## Open Questions for pocket-grinding

- [ ] Where does the per-workspace key counter live — a column on `workspaces`, or on the vocabulary/settings table — and what is the prefix derived from (workspace name, or a user-set field)?
- [ ] Is one vocabulary table with a `kind` discriminator genuinely simpler than three, given status and priority are single-select-ordered while labels are multi-select-unordered? Grinding should validate this through scenarios, not assume it.
- [ ] Priority ordering becomes data once levels are customisable — does the vocabulary table need a `position` field, and does it reuse `core/position.ts` fractional positioning or a plain integer?
- [ ] What happens when a label still in use is deleted — cascade off its items, or block? Can v1 simply omit delete?
- [ ] Does the Tracker page belong in the sidebar `NAV_ITEMS` as a top-level entry alongside Board, and what is its route?
- [ ] Do Tracker items participate in the existing realtime SSE fan-out, and does that need new event types or just new `event_type` values in the existing `payload JSONB` envelope?
- [ ] Do Tracker items need assignees, and if so do they reuse `workspace_members` exactly as cards do?
- [ ] Does search cover title only, or title + description?

---

## Recommended Direction

**Direction B** — the vocabulary work is cheap enough to include (new table, no migration, `columnColorUtils.ts` already provides colour generation), and fixed status grouping delivers the reference's look for a fraction of C's cost, while deferring the axis-switching and filter-persistence decisions that cannot be answered honestly until real Tracker items have existed for a couple of weeks.

---

## Separate Candidate (deliberately not in scope)

The Done-column tower is the one pain with hard evidence behind it, and it has a much cheaper fix than any new page: archive, collapse, or filter Done on the Board itself. This is independent of Tracker and should not ride in this cycle — but if it removes most of the pain on its own, Tracker's scale justification weakens accordingly. Worth its own small cycle.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use **Direction B** as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- **Settled during pitching, do not reopen without new evidence:** Tracker items are independent of Board cards (no FK); the upgrade path to linkage is a later additive nullable `card_id`, and a write-back rule is unspecifiable while granularity is 1:N. Card keys may have gaps. The Board is not touched.
- **Superseded context:** `docs/pocket/spec/2026-08-01-workspace-pivot-scope/list-calendar-views-spec.md` — the List/Calendar-as-view-preference cycle, rejected after shipping. Its `ListView.tsx` and `boardViewUtils.ts` are harvestable as dense-row primitives; its framing is not.
- Roadmap (event scheduling — meetings, requirement gathering, sosialisasi) is a **separate future pitch cycle**, not part of this one.
