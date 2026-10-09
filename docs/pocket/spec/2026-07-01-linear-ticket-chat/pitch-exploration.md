# Pitch Exploration: linear-ticket-chat
Date: 2026-07-01 | Project: Camel Kanban | Status: pitch-only

---

## Problem Statement
Camel users cannot report bugs or request features without leaving the app — there's no in-app path to file a ticket, so feedback either gets lost or requires manually opening Linear and writing a structured issue by hand.

## Root Tension
Guided AI chat is valuable for a user who can't yet articulate the problem clearly (needs prompting for expected vs. actual, repro steps), but the same chat flow adds friction for a user who already knows exactly what they want to report — and both cases must stay safe from "AI generates junk → auto-writes to an external system."

## Key Constraints
- Linear `issueCreate` mutation requires `title` + `teamId`; `priority` (Int 0-4) and `labelIds` are optional but needed for bug/feature mapping
- Server-side API key auth (5,000 req/hour — no real rate-limit risk at expected volume)
- Single shared API key means all issues are authored by one bot account — reporter identity must be embedded in the issue body/comment
- Preview+confirm gate required before POST (mitigates AI-summary-quality risk)
- Fixed one Linear team/project for v1 (no admin config UI)
- Reusable: Anthropic client plumbing in `server/src/agent/llm.ts` (client singleton, prompt sanitizer, token budgets)
- NOT reusable as-is: `templates.ts` (board-context system prompts) and `tools/registry.ts` (board/card tool calls) — ticket-intake chat needs its own system prompt, not the board tool registry
- v1 explicitly excludes: duplicate-ticket detection, attachment/screenshot upload, per-user OAuth

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Who owns the Linear API key — user, workspace admin, or shared env-level key?
- What happens when AI chat misreads user intent (ambiguous bug report)?
- Does the created ticket link back to a Camel card, or is it fire-and-forget?
- Who can see history of tickets already filed from this chat?

### First Principles Thinking — creative
Key insights:
- Core function is capturing intent + translating to an actionable ticket — chat is one channel, not the only possible one
- "Must be AI chat" assumption challenged: chat's value is guiding a user who needs help articulating the problem, not a universal default
- "Must auto-post to Linear" softened by the already-decided preview+confirm step (draft-then-send, not pure fire-and-forget)
- Root value: reduce friction of "leaving the app to file a report" — context-preserving reporting

### Six Thinking Hats — structured
Key insights:
- White: no Linear integration exists yet; agent pipeline exists and is partially reusable
- Red: user fear of AI misinterpreting and spamming the team with a bad ticket
- Yellow: less context-switching, structured tickets instead of raw chat logs
- Black: API key leak/misuse, AI hallucination risk, LLM cost per session
- Green: chat could suggest similar existing tickets before creating a new one (deferred)
- Blue: start fixed team/project, expand to configurable later

### Constraint Mapping — deep
Key insights:
- API key must stay server-side, never exposed to client
- `issueCreate` needs `teamId` minimum; label mapping needed for bug vs. feature
- Existing agent pipeline designed for board-context tool use, not freeform ticket-intake chat — needs a new template, can reuse low-level LLM client code

### Reverse Brainstorming — creative
Key insights:
- Generic AI summary ("user reported an issue") → junk ticket with no actionable detail
- Button-spam without dedup → duplicate tickets
- Confirm step silently skipped (race/bug) → wrong ticket sent without user awareness
- Expired/invalid API key with unclear error → user believes report was sent when it wasn't

---

## Advisor Synthesis
Advisor confirmed the chat-vs-form fork is the primary decision axis, not a minor detail — First Principles' insight about chat's real value (guiding unclear users) should drive Phase 5 directions. It flagged that Black Hat, Reverse Brainstorming, and First Principles all converge on the same single risk (AI-generated content auto-written externally), already mitigated by the preview+confirm gate decided in Phase 1. It also surfaced an unstated fork — credential model (shared server-side key vs. per-user OAuth) — as a decision that needed to be made explicit rather than left implicit, and flagged dedup/attachments as recurring-but-deferred scope creep. Finally, it required a spike before convergence since Constraint Mapping had only guessed at Linear's API requirements.

---

## Spike Results

**Unknown resolved:** Linear issue-creation API — required fields, auth model, rate limits.

**Finding:**
- Auth: API key (`new LinearClient({ apiKey })`) or OAuth2 (`accessToken`); server-side API key chosen for v1.
- `issueCreate` mutation requires `title` + `teamId`; optional `description` (markdown), `priority` (Int 0-4), `labelIds` ([String!]).
- Rate limit: 5,000 authenticated requests/hour per API key — not a practical constraint for this feature's expected volume.
- Code-scan companion finding: `server/src/agent/llm.ts` client/sanitizer/token-budget code is reusable; `templates.ts` and `tools/registry.ts` are board-specific and not directly reusable — new chat flow needs its own system prompt.

**Implication:** No blocking technical unknowns remain. Approach directions below can assume server-side API key auth, fixed team/project, and a new (not reused) chat system prompt built on existing LLM client plumbing.

---

## Approach Directions

### Direction A: Pure Guided Chat
Floating button opens a chat window; AI always walks the user through clarifying questions (expected vs. actual, repro steps) before producing a summary.
+ Matches the original brief exactly; single UI surface
− Forces multi-turn chat even on users who already know exactly what they want to report — added friction for the clear case

### Direction B: Hybrid Form+Chat
Floating button opens a quick-pick (Bug/Feature) plus a lightweight form (title, description); an optional "help me phrase this" expands into chat mode only when the user is stuck.
+ Fastest default path for users who already know what they want
− Two UI surfaces to build and maintain (form validation + chat flow) — more v1 scope

### Direction C: Adaptive Chat (single chat, smart-skip)
Floating button opens one chat window; the AI detects when the user's first message already contains enough detail (title + description + repro) and skips straight to summary, only asking clarifying questions when the input is vague.
+ Single UI surface (no separate form to maintain) while still staying fast for clear-cut reports
− "Is this complete enough?" detection adds prompt-engineering complexity versus a fixed-flow chat

---

## Open Questions for pocket-grinding
- [ ] What labelIds/priority values exist in the target Linear team, and how should bug/feature type map to them?
- [ ] How should Camel reporter identity be embedded in the Linear issue (body text, comment, custom field)?
- [ ] Does the created Linear issue need a link back to a Camel card/context, or is it standalone?
- [ ] What's the exact system prompt structure for "detect if input is already complete" in Direction C — confidence threshold, fallback behavior if misjudged?
- [ ] Where does the floating button live in the layout tree, and does it need to respect `docs/pocket/rule/creative-brief.md` z-index/spacing tokens?

---

## Recommended Direction
Direction C — reuses the chat plumbing already planned, avoids the double-UI-surface maintenance cost of Direction B, and directly resolves the chat-speed tension found in brainstorming without dropping the original "chat to AI" intent from the brief.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction C as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
