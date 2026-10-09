# Pitch Exploration: commit-focus

Date: 2026-09-04 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement

Camel users cannot deliberately narrow their work to one task while retaining a trustworthy focus duration. They need a personal, workspace-scoped focus mode that selects one task, hides competing tasks, and exposes an explicit Start / Pause / Resume / Finish lifecycle.

## Root Tension

The experience must remove competing work strongly enough to protect attention while retaining the task context needed to complete the work; a page-first surface improves calm focus, while a board-first surface improves discovery and context.

## Key Constraints

- Focus is personal and scoped to one user within one workspace.
- The lifecycle must distinguish selecting a task (Commit) from controlling the work session (Start, Pause/Resume, Finish).
- The focus experience must not implicitly change a task's shared completion status.
- Existing client routing supports both board context (`/board/card/:cardId`) and tracker detail (`/tracker/:key`) surfaces.
- `server/src/db/schema.sql` has workspace-scoped settings and workspace membership, but no persisted user/workspace focus-session primitive.
- The existing settings API is workspace-wide and restricts writes to workspace admins/owners; it is not suitable for personal focus state (`server/src/routes/settings.ts`).
- Camel has distinct board and tracker work-item surfaces; the eventual direction must preserve the existing work-item identity and source boundaries.
- If focus must survive refresh or device changes, the feature will need a new server-side persistence capability rather than browser-local state alone.

---

## Brainstorming Methods Used

### Question Storming — deep

Key insights:

- Commit may select the focus task while Start begins the timed work session.
- The product must define whether duration means wall-clock time or active time after subtracting pauses.
- Finish needs an explicit meaning: end the focus session, complete the task, or two separate actions.
- The behavior of refresh, workspace switching, multiple tabs/devices, task deletion, and focus replacement remains unresolved.
- “Only one task” needs a boundary between removing competing work and retaining essential task context.

### First Principles Thinking — creative

Key insights:

- The core value is attention commitment, not a new task status or a timer-only feature.
- The page-versus-board choice is a surface decision; success is fast entry, sustained focus, and safe re-entry.
- A focus mode should remove choices and distractions without removing information required to work.
- The timer should communicate time spent, not silently become a productivity score or surveillance mechanism.
- Commitment should be deliberate but reversible.

### Six Thinking Hats — structured

Key insights:

- Known facts are one personal focus per workspace and an explicit Commit → Start → Pause/Resume → Finish lifecycle; persistence, history, and minimum context are unknowns.
- Benefits include lower decision fatigue, easier resumption, and a concrete work intention.
- Risks include lost context, untrusted timers, cross-tab/device disagreement, accidental task completion, and inability to exit.
- The emotional target is calm control rather than pressure or surveillance.
- The process should settle vocabulary, lifecycle invariants, minimum context, placement, and persistence before detailed architecture.

### Reverse Brainstorming — creative

Key insights:

- A context-free focus screen forces users to leave focus repeatedly for comments, checklists, or attachments.
- Starting the timer on an accidental Commit makes duration data untrustworthy.
- A timer that continues while the user is away misrepresents work.
- Coupling Finish to Done creates a destructive semantic surprise.
- Browser-only state loses continuity after refresh or on another device.
- A shared workspace focus would allow members to overwrite each other's personal intent.

### Solution Matrix — structured

Key insights:

- A dedicated page favors calm focus; a board-native mode favors continuity and discoverability.
- Persisted state favors continuity; browser-local state favors lower implementation cost but weakens trust.
- Active duration favors semantic accuracy with Pause; wall-clock duration favors simpler display but conflicts with Pause.
- Ending a session separately from completing a task avoids destructive coupling.
- The comparison should prioritize entry friction, context preservation, lifecycle clarity, timer trust, and safe exit.

---

## Advisor Synthesis

The advisor identified attention commitment—not timing—as the central product value, and recommended keeping Commit separate from Start/Pause/Finish. The strongest pattern is a board entry/resume point paired with a dedicated, distraction-reduced focus surface; a board-only mode remains a lower-complexity alternative. The curation discarded shared focus, browser-only state, immediate timer start, automatic task completion, and full session analytics from the initial scope. Terminology and the exact meaning of Finish remain important validation points.

---

## Spike Results

**Unknown resolved:** Does Camel already have a reusable persisted state mechanism scoped to `(user_id, workspace_id)` for a personal focus session?

**Finding:** No direct primitive was found. The `settings` table is keyed by `(workspace_id, key)` and contains no `user_id` (`server/src/db/schema.sql:76-121`); `workspace_settings` currently stores only workspace timezone (`server/src/db/schema.sql:327-330`). The settings service authorizes workspace-level admin/owner writes (`server/src/routes/settings.ts:179-215`). `BoardContext` already manages the active workspace and workspace reload/realtime behavior, but has no focus/timer state. The app already exposes board context and tracker detail routes (`client/src/App.tsx:43-109`).

**Implication:** Both a dedicated focus surface and board-integrated mode are routing-feasible and can reuse existing task surfaces. Persisted personal focus continuity would require a new server-side capability; the existing workspace settings mechanism should not be repurposed.

---

## Approach Directions

### Direction A: Board Entry + Dedicated Focus Surface

Users choose or resume focus from the board/task surface, then work in a dedicated view that shows only the committed task and essential context.

- Best balance of focus protection, discoverability, and existing Camel navigation.
- Preserves a clear distinction between choosing work and doing work.
− Requires a new focus surface and persisted personal session capability if continuity is required.

### Direction B: Board-Native Focus Mode

The board remains the primary surface, but switches into a reduced mode around the selected task with the focus controls visible in place.

- Lowest context-switching cost and a natural board entry point.
- Could be smaller in product surface area.
− Harder to eliminate board distractions while preserving the existing board layout and panels.

### Direction C: Focus-First Page

A top-level focus page becomes the primary entry point for selecting or resuming the user's committed task, independently of the board.

- Strongest isolation and a fast return path for an existing focus session.
- Leaves room for a future personal work-session experience.
− Adds a new mental model and may make initial task selection/context access feel disconnected from the board.

---

## Open Questions for pocket-grinding

- [ ] Should the displayed duration be active time excluding pauses, wall-clock time, or both?
- [ ] Does focus state need to survive refresh, logout/login, workspace switching, multiple tabs, and another device?
- [ ] What is the exact semantic difference between Finish Focus and completing the task?
- [ ] What minimum task context must remain visible in the reduced focus surface?
- [ ] Should focus support board cards, tracker items, or both in the first release?
- [ ] Is “Commit” the right user-facing term, given its possible Git/completion ambiguity?
- [ ] Should replacing an existing focus require finishing it first, or allow an explicit switch?
- [ ] Is session history intentionally out of scope for the first release?

---

## Recommended Direction

Direction A — it protects attention without making the feature hard to discover, matches Camel's existing route/task surfaces, and keeps the board as the natural place to choose or resume work.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:

- Start with this problem statement as the Phase 1 context.
- Use Direction A as the working hypothesis for Phase 5 Design Proposals.
- Use the Open Questions above as Phase 3 Discovery targets.
- Treat the Approach Directions as product directions, not final architecture; validate them through GWT scenarios first.
