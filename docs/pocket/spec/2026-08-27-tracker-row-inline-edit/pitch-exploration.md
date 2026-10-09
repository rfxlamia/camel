# Pitch Exploration: tracker-row-inline-edit
Date: 2026-08-27 | Project: Camel | Status: pitch-only

---

## Problem Statement

Tracker rows (`TrackerRow.tsx`) only let the user act from the list — status is inline-editable via `TrackerPropertyPicker`, but project, phase, priority, assignee, label, and start/end date all require opening `TrackerDetailPage` to change, even though the display markup for most of these already exists in the row (avatars, label chips, project chip) and is simply not wired to a click handler.

## Root Tension

The row has enough visual space and enough proven, reusable picker components (`TrackerPropertyPicker`, `TrackerDateFields`) to make every property inline-editable — but the page was decluttered five days ago (`docs/pocket/spec/2026-08-26-tracker-page-declutter`) specifically to reduce visual noise, and turning every row into six always-visible edit triggers would reverse that decision. The tension is "give the row `TrackerDetailPage`'s editing power" vs. "keep the row scannable and calm."

## Key Constraints

- `TrackerPage.tsx` currently fetches only `statuses`, `priorities`, `projects` (with nested `phases`). It does **not** fetch `labels` or workspace `members` — those are only fetched in `TrackerDetailPage.tsx`. Making priority/assignee/label inline-editable requires adding those two fetches to `TrackerPage`, copying an existing API call pattern (`api.listTrackerVocabularies(id, "label")`, `api.getWorkspaceMembers(id)`) — not new plumbing, but a real addition to today's data flow.
- Assignee avatars and label chips already render in the row (`TrackerRow.tsx:96-118`) — the display exists, only the click-to-edit affordance is missing. Cost for these two is the fetches above plus wiring, not new UI.
- `TrackerProperties.tsx` already implements the exact multi-select pattern needed for assignee/label: `TrackerPropertyPicker` with `multiple` + toggle-style patches (`assigneeToggle`, `labelToggle`) resolved against a queue in the parent. This is directly reusable, not a new interaction to design.
- There is no `dueDate` field on `TrackerItem` — that field belongs to `Card`. Tracker items have `startDate`/`endDate` only. The row's current `<time>` shows `createdAt` with a standing `TODO: due date preference on date column`, meaning the date column's real content was already deferred once and needs a decision: show/edit `endDate` alone, or a mini range popover for both.
- All property mutation must go through `api.updateTrackerItem(workspaceId, key, { ...patch, version: item.version })` — the same path status-change and the detail page already use. Tracker items carry a real `version` field with server-side 409-on-stale-write handling (`server/src/routes/tracker-items.ts`) and this must not be bypassed by a new row-level mutation path, or activity logging and optimistic-lock protection are lost.
- Project→phase reset is a hard invariant: changing `projectId` from the row must also send `phaseId: null` in the same patch (mirrors `TrackerDetailPage.tsx`'s `changeProperty({ projectId, phaseId: null })`), or a stale phase can point at a phase that no longer belongs to the item's project.
- Breakpoint hiding already limits row real estate: labels are `hidden sm:flex` and assignees are `hidden ... md:flex` — on narrow viewports neither is visible today at all, inline or not. Any direction must decide how those two fields are reached below their current breakpoints.
- The row's navigation-vs-action conflict is already solved once, structurally: `TrackerRowShell` opens the detail page via an overlay button placed *behind* the row content specifically because a button cannot nest inside a button. Every new inline trigger must follow this same pattern (its own stopped-propagation control, not a second nested button).
- The declutter pitch's operating philosophy — reduce visual noise, don't restructure Tracker's surface again without evidence — is a soft constraint against any direction that makes the row permanently busier at rest.

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Fields split into two interaction shapes: pick-from-list (project, phase, priority, label, assignee) vs. calendar widget (date) — one inline pattern will not fit both.
- The status-picker's overlay-button-behind-content trick is the existing answer to "how do inline triggers coexist with row-click-to-navigate" — any new trigger must follow it, not invent a new nesting solution.
- Whether users need per-row edits or eventual bulk edits across many rows is unresolved and out of scope for this pitch.

### First Principles Thinking — creative
Key insights:
- The row's job is "summarize + allow fast action." Status proves the pattern works; extending it to other fields is generalization, not invention.
- `TrackerPropertyPicker` is already the shared primitive behind status (row), and project/phase/priority/assignee/label (detail) — one component, already reusable, not something to redesign.
- Date needs a genuinely different widget (`TrackerDateFields`), so the row needs at least two trigger *shapes*, not one universal inline pattern forced onto every field.

### Six Thinking Hats — structured
Key insights:
- **White (fact, corrected mid-session):** initial assumption that all vocab data (`labels`, `members`) was already available in `TrackerPage` was wrong — verified only `statuses`/`priorities`/`projects` are fetched there; the other two exist only in the detail page today.
- **Red (risk):** misclick on a densely-populated row could trigger navigation instead of a picker; each new trigger needs its own isolated hit area and `stopPropagation`, matching the status picker's existing isolation.
- **Black (risk):** a project change from the row that omits `phaseId: null` leaves the item pointing at a phase from the old project — a real data-integrity bug, not a cosmetic one.
- **Green (creative):** progressive disclosure (hover-reveal on desktop, tap-visible on touch) keeps the row calm at rest while still exposing every field — directly answers the declutter tension instead of ignoring it.
- **Blue (process):** rollout can be staged by data availability — fields whose vocab is already loaded in `TrackerPage` (date, project, phase, priority) ship first; fields needing new fetches (label, assignee) ship once those two calls are added, using the same multi-select pattern already proven in `TrackerProperties.tsx`.

### Reverse Brainstorming — creative
Key insights (failure modes if built naively):
- A per-field open boolean (six `useState<boolean>` per row) creates six independent popover-positioning problems per row instead of one; a single "which picker is open, if any" state per row avoids this, mirroring how `TrackerRow.tsx` already tracks one `menuOpen` for status.
- Hover-only triggers are invisible and unusable on touch devices — any direction relying on hover needs a tap-visible fallback below the hover breakpoint, not hover as the only path.
- A new mutation path that skips `version` in the patch reintroduces the exact stale-write class of bug optimistic locking exists to prevent — every new patch call must include `item.version`.

---

## Advisor Synthesis

The advisor's curation flagged one blocking gap and two direction-shaping ones. Blocking: the claim that project/label/assignee data was "already available to reuse" in `TrackerPage` was unverified and turned out to be half-true — project data is present, label/member data is not, which changes the real cost of including those two fields. Direction-shaping: the tracker-page-declutter pitch from five days ago is the strongest constraint on this problem and was initially absent from the brainstorm — a direction that adds six permanently-visible triggers per row directly reverses that decision. It also surfaced a genuinely distinct third direction the initial brainstorm missed — a single row-level menu — which costs zero row width, behaves identically on touch and desktop, and doesn't fight the declutter work, unlike per-field inline pickers. A follow-up check (prompted by the user, not the advisor) corrected the assignee/label cost further: their display markup already renders in the row, so the missing piece is a fetch + click wiring, not new UI or a new interaction pattern — `TrackerProperties.tsx` already has the exact multi-select toggle semantics needed.

---

## Approach Directions

### Direction A: Hover-reveal inline pickers, every field
Every property slot in the row (project, phase, date, priority, label, assignee) becomes its own `TrackerPropertyPicker`/`TrackerDateFields` trigger, shown on hover on desktop and tap-visible below the hover breakpoint.
+ Directly extends the proven status-picker pattern to every field; each field ships and is tested independently.
− Six independent open-states and popover-position problems per row; page just got decluttered five days ago and this makes the row permanently busier at rest without a staged rollout.

### Direction B: Single row-level menu
One trigger per row (kebab icon) opens a panel listing every editable property at once; status stays inline as-is since that pattern already works well.
+ Zero added row width, identical behavior on touch and desktop, doesn't fight the declutter work, one open-state per row instead of six.
− Adds a click-then-choose-field step instead of a direct one-click edit per property; a different interaction feel from the existing status-inline pattern.

### Direction C: Staged inline rollout, ordered by real cost
Ship inline triggers for the fields whose vocab is already loaded in `TrackerPage` first — date, project, phase, priority — since no new fetch is needed. Add label and assignee inline triggers in the same pass if the two extra fetches (`labels`, `members`, both existing API calls copied from the detail page) are accepted as in-scope; otherwise land them as a fast follow. Reuse the existing single-open-picker-per-row state shape and the `TrackerProperties.tsx` multi-select toggle pattern for label/assignee.
+ Matches the actual, verified cost structure instead of treating all six fields as equal effort; reuses every pattern already proven in the codebase; keeps the row calm by only adding triggers where display already existed or vocab is already loaded.
− Two fields shipping slightly behind the other four (if fetches are deferred) means the row is inconsistently editable for a short window.

---

## Open Questions for pocket-grinding

- [ ] Does the date column edit `endDate` alone, or open a range popover editing both `startDate` and `endDate` — and does the visible column stay labeled/formatted as a single date or a range?
- [ ] Should hover-reveal (Direction A/C) or the row-level menu (Direction B) be the mechanism for fields below their current breakpoint (labels `hidden sm:`, assignees `hidden md:`) on narrow viewports — hover doesn't exist on touch, so a fallback trigger is needed regardless of which direction wins?
- [ ] Should label/assignee inline triggers ship in the same PR as date/project/phase/priority (accepting the two new fetches now), or land as an explicit fast-follow once the first four are validated?
- [ ] Does adding a `labels` and `members` fetch to `TrackerPage` on every list load have a meaningful performance cost at realistic workspace sizes, or is it negligible given the detail page already pays this cost per item view?

---

## Recommended Direction

Direction C — it matches the constraints actually verified in this session (only status/priority/project data is preloaded in `TrackerPage`; label/assignee display already exists but their edit options don't), reuses the multi-select pattern already built in `TrackerProperties.tsx` instead of inventing one, and avoids Direction A's risk of making the row permanently noisier right after the page was decluttered — while still reaching every field the user asked for, just not necessarily in one PR.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use **Direction C** as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- Every new row-level mutation must call `api.updateTrackerItem` with `item.version` in the patch — no new mutation path
- Project-change patches must always include `phaseId: null` alongside the new `projectId`
- Row-level pickers should share one "which picker is open" state per row (mirroring `TrackerRow.tsx`'s existing `menuOpen`), not one boolean per field
- Description stays detail/create-only — explicitly out of scope per the user's own framing
- Related context: `docs/pocket/spec/2026-08-26-tracker-page-declutter/pitch-exploration.md` (the declutter philosophy this pitch must not reverse); `docs/pocket/spec/2026-08-05-tracker-project-phase-wbs/pitch-exploration.md` (project/phase data model this pitch builds on)
