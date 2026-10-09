# Linear Ticket-Intake Chat

**Date:** 2026-07-01
**Status:** draft
**Author:** brainstorm session (pocket-pitching → pocket-grinding)
**Spec path:** docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md

---

## Summary

An in-app AI chat lets Camel users file Linear tickets (Bug / Feature / Improvement) without leaving the app. Three entry points feed the same chat: a global floating button, a "Report issue" action in the card `ContextPanel`, and an auto-opened draft when a user-initiated action returns HTTP 500+. The AI always confirms report type on turn 1 (except the auto-error path, which is pre-classified), adaptively skips further clarifying questions when the input is already detailed, and requires an explicit preview + confirm step before anything is written to Linear.

---

## Context

### Current State

No in-app path exists to file a Linear ticket. Users must leave Camel and write a structured issue by hand in Linear. Camel's agent pipeline (`server/src/agent/`) exists but is board-context specific — it classifies intent into board templates and calls board/card tools, not general-purpose freeform chat.

### Problem / Motivation

Feedback gets lost or requires context-switching out of the app. See `pitch-exploration.md` in this same spec directory for full brainstorming history (Question Storming, First Principles, Six Thinking Hats, Constraint Mapping, Reverse Brainstorming) and the resolved Linear API spike.

### Related Areas

- `server/src/agent/llm.ts` — reusable: Anthropic client singleton, `prompt-sanitizer.ts` (sanitizeUserInput, detectPromptInjection, sanitizeLLMOutput), token budget constants
- `server/src/agent/templates.ts`, `server/src/agent/tools/registry.ts` — NOT reusable (board-specific); a new system prompt is required for ticket-intake
- `server/src/agent/llm.ts` `classifyIntent` / `CLASSIFY_SYSTEM_PROMPT` — precedent pattern for strict-JSON LLM responses, reused as the design basis for structured extraction (see Design Decision)
- `server/src/config.ts` — Zod env schema; `TAVILY_API_KEY` is the precedent for an optional, feature-gated integration key
- `server/src/db/schema.sql` — `card_events` table (`card_id` nullable, `event_type` TEXT, `payload` JSONB, `workspace_id` NOT NULL) — reused as-is for ticket history, no migration
- `server/src/routes/helpers.ts` — `recordActivity()` has a closed `eventType` TS union that must be extended to include `linear_ticket_created`
- `client/src/api.ts` — single typed fetch wrapper for all client API calls; the hook point for the user-initiated-500+ auto-error entry point
- `client/src/components/ContextPanel.tsx` — where the card-context "Report issue" entry point and per-card ticket history live
- `client/src/context/BoardContext.tsx` — `activeWorkspaceId: number | null` — can be `null`; gates availability of all three entry points
- `docs/pocket/rule/creative-brief.md` — Button Primary token (primary-600, OKLCH navy) reused as-is for the floating button; no new floating/z-index/overlay tokens added to the brief

---

## Scope

### In-Scope

- Global floating chat button (visible only when `activeWorkspaceId` is non-null)
- "Report issue" action in `ContextPanel`, prefilled with card title + description + link back to the card
- Auto-opened chat draft when a user-initiated (explicitly opt-in tagged) API call returns HTTP 500+, prefilled with endpoint + status code + error message + timestamp + user action description; type auto-set to "Bug"; classifier question skipped; preview + confirm still mandatory
- AI classifier question on turn 1 (bug / feature / improvement intent) for all entry points except auto-error
- Adaptive elaboration: AI skips further clarifying questions when input is already detailed (fast path), asks specific follow-ups when it is not (guided path) — mechanism specified in Design Decision
- Preview screen: title & description editable inline; type badge read-only (no manual override); confirm blocked while title is empty
- Submission: `issueCreate` (title, description, teamId=CAM, labelIds for Bug/Feature/Improvement) then a separate `commentCreate` (reporter name + email, source: global/card/error)
- Retry policy: automatic retry with exponential backoff (1s→1m, up to 10 attempts) for 500+/network failures only; 400+ failures show a clear human-readable error immediately, no retry
- Manual "resubmit" after a graceful failure — same logical submission, does not consume the rate-limit quota
- Rate limits, server-enforced: submit (`issueCreate`) max 1/5min/user (quota consumed only on success), chat message (LLM call trigger) max 1/user/10sec; UI disables the relevant control while limited
- `card_events` row on ticket creation: `event_type='linear_ticket_created'`, `card_id` = linked card or `NULL`, `workspace_id` = `activeWorkspaceId` at creation time, `payload = {issueUrl, issueIdentifier, title}`
- Per-card ticket history in `ContextPanel`: snapshot only (title, link, created_at) — no live Linear status fetch
- `LINEAR_API_KEY` / `LINEAR_TEAM_ID` as optional env vars (feature gated, not startup-required)

### Out-of-Scope

- Duplicate-ticket detection — deferred (flagged in pitch's Six Thinking Hats Green)
- Attachment/screenshot upload — deferred
- Per-user OAuth — v1 uses a single server-side shared API key
- Admin config UI for team/project selection — team is fixed to `CAM` for v1
- Manual override of AI-assigned type (Bug/Feature/Improvement) — full-AI classification only, by explicit user decision
- Global (cross-card) ticket history list view — `ContextPanel` (per-card) only
- Live Linear status sync in the history view — snapshot only, to protect the 5,000 req/hr Linear rate limit
- Auto-open trigger for background/passive calls (SSE reconnect, notification polling, presence heartbeat) — explicitly excluded to prevent repeated chat-opening during an outage

---

## Architecture Constraints

- Layers this work may touch: `server/src/agent/` (new ticket-intake module + system prompt), `server/src/config.ts` (new optional env vars), new router mounted under `requireAuth`, `client/src/layout` (floating button), new client components (chat panel, preview), `client/src/api.ts` (opt-in user-initiated tagging for the auto-error hook), `client/src/components/ContextPanel.tsx`, `server/src/routes/helpers.ts` (`eventType` union extension) — no schema migration
- Layers this work must NOT touch: `server/src/agent/templates.ts`, `server/src/agent/tools/registry.ts` (board-context specific), `server/src/core/position.ts`, `server/src/core/wip.ts`
- Patterns that must be followed: NodeNext ESM `.js` imports (server), Zod validation in `config.ts` (optional-key pattern per `TAVILY_API_KEY`), `requireAuth` gate on all routes, reuse `prompt-sanitizer.ts` for all freeform user input into the LLM, Biome lint, Vitest co-located tests, OKLCH tokens from `creative-brief.md` for all new UI, `recordActivity()` / `card_events` for all mutation logging
- Architecture validation result: **PASS** (see Phase 6 — all checklist items confirmed; `LINEAR_API_KEY` resolved to optional/feature-gated to avoid breaking existing deployments)

---

## Stories + Scenarios

### Story 1: Report via global chat — fast path
> As a Camel user, I want to describe a bug/feature in one message and get a ready ticket, so that I don't waste time on unnecessary back-and-forth.

**Rule 1: Turn 1 always asks a classifier-directing question**
- Example A: User types a detailed drag-drop bug report → AI turn 1 asks "This sounds like a bug — is that right, or is there a feature/improvement angle?"

**Rule 2: Sufficient input skips further clarifying turns**
- Example B: User confirms "bug"; message already has repro + expected/actual → AI goes straight to preview, no extra questions

```gherkin
Scenario: Fast path — input lengkap, langsung ke preview setelah classifier
  Given user klik floating chat button
  When  user kirim pesan lengkap (repro steps + expected vs actual)
  And   AI turn 1 nanya classifier, user jawab "bug"
  Then  AI langsung susun draft tanpa clarifying question tambahan
  And   preview muncul dengan badge type "Bug" read-only
```

### Story 2: Report via global chat — guided path
> As a Camel user, I want the AI to guide me when my report is still vague, so that the resulting ticket stays actionable.

**Rule 1: Vague input triggers a specific follow-up after the classifier**

```gherkin
Scenario: Guided path — input vague, AI nanya clarifying setelah classifier
  Given user klik floating chat button
  When  user kirim pesan vague ("kanban-nya aneh") dan jawab classifier "bug"
  Then  AI nanya clarifying question spesifik (repro steps / expected vs actual)
  And   preview TIDAK muncul sampai info cukup
```

### Story 3: Report from card context
> As a user viewing a specific card, I want to open the chat from ContextPanel with card context pre-filled, so that I don't have to retype card info.

**Rule 1: Prefill = card title + description + link back to card**
**Rule 2: Created issue links back to the card (comment metadata + `card_events`)**

```gherkin
Scenario: Entry dari card context — prefill dan link balik
  Given user buka ContextPanel card "Fix login redirect"
  When  user klik "Report issue"
  Then  chat kebuka dengan draft berisi judul + deskripsi card
  And   setelah confirm, Linear issue punya comment berisi link ke card
  And   card_events dapet row event_type='linear_ticket_created' dengan card_id card ini dan workspace_id dari activeWorkspaceId
```

### Story 4: Auto-report from user-initiated 500+ error
> As a user whose action (save/submit/drag) fails with 500+, I want the chat to auto-open with a ready draft, so that I don't have to re-explain the technical error.

**Rule 1: Trigger ONLY from explicitly-tagged user-initiated calls — never background/passive calls**
**Rule 2: Prefill = endpoint + status + error message + timestamp + user action description**
**Rule 3: Type auto-set "Bug", classifier skipped — preview + confirm remain mandatory**
**Rule 4: `card_events.card_id` is NULL when there is no card context**

```gherkin
Scenario: Auto-report dari error 500 user-initiated
  Given user klik "Save" pada card dan response API 500 (call ditandai user-initiated)
  When  error diterima
  Then  floating chat auto-terbuka dengan draft (endpoint, status, message, timestamp, aksi user)
  And   type otomatis "Bug", classifier turn 1 di-skip
  And   preview tetap tampil — user HARUS klik confirm, tidak auto-submit

Scenario: Error 500 dari background call TIDAK trigger auto-open
  Given SSE reconnect gagal dengan status 500 (call tidak ditandai user-initiated)
  When  error diterima dari proses background
  Then  floating chat TIDAK terbuka, tidak ada draft dibuat
```

### Story 5: Preview, edit, confirm
> As a user before submission, I want to see and edit the draft, so that I'm confident before the ticket reaches the team.

**Rule 1: Title & description editable inline; type badge read-only**
**Rule 2: Confirm blocked while title is empty**
**Rule 3: Confirm triggers `issueCreate` then `commentCreate` (metadata)**

```gherkin
Scenario: Edit draft di preview sebelum confirm
  Given preview muncul dengan title & description hasil AI
  When  user edit description langsung di field preview
  And   user klik confirm
  Then  issueCreate memakai teks yang sudah diedit, bukan draft asli AI

Scenario: Confirm diblokir kalau title kosong
  Given preview muncul dengan title kosong (user hapus semua teks)
  When  user coba klik confirm
  Then  tombol confirm disabled, tidak ada request terkirim

Scenario: issueCreate sukses, commentCreate gagal
  Given user klik confirm
  When  issueCreate berhasil tapi commentCreate (metadata reporter+source) gagal
  Then  user melihat status sukses (ticket ada di Linear)
  And   kegagalan comment dicatat di log server, tidak ada retry otomatis untuk comment
```

### Story 6: Submission failure & recovery
> As a user whose confirm fails against the Linear API, I want automatic retry then a clear message if it still fails, so that I never believe a ticket was sent when it wasn't.

**Rule 1: Retry only for 500+/network failures — exponential backoff 1s→1m, up to 10 attempts**
**Rule 2: 400+ failures show a clear human-readable error immediately, no retry**
**Rule 3: Retry / manual resubmit is the same logical submission — rate-limit quota is consumed only on `issueCreate` success**

```gherkin
Scenario: issueCreate gagal transient, retry berhasil
  Given user klik confirm dan issueCreate gagal karena network timeout (500-class)
  When  sistem retry otomatis dengan backoff 1s→1m
  And   retry ke-N berhasil
  Then  user melihat sukses, rate-limit quota baru terpakai di titik ini

Scenario: issueCreate gagal permanen (400+)
  Given user klik confirm dan issueCreate gagal karena request invalid (400-class)
  When  error diterima
  Then  user langsung melihat error message jelas, TIDAK ada retry
  And   rate-limit quota TIDAK terpakai (belum pernah sukses)

Scenario: issueCreate gagal total setelah retry 10x (500-class)
  Given user klik confirm dan semua 10x retry gagal (backoff 1s→1m)
  When  retry terakhir gagal
  Then  user melihat graceful error message, BUKAN pesan sukses
  And   tombol "resubmit" muncul
  And   rate-limit quota TIDAK terpakai (belum pernah sukses)
```

### Story 7: Spam/abuse rate limiting
> As the system, I want to limit submissions and chat messages per user, so that LLM and Linear credit isn't wasted.

**Rule 1: Submit (`issueCreate`) max 1/5min/user, server-enforced, quota consumed only on success**
**Rule 2: Chat message (LLM call trigger) max 1/user/10sec, server-enforced**

```gherkin
Scenario: Rate limit submit kena
  Given user sudah submit 1 ticket sukses 2 menit lalu
  When  user coba submit ticket lain
  Then  tombol submit disabled
  And   server menolak request kalau tetap terkirim (defense in depth)

Scenario: Rate limit chat message kena
  Given user kirim pesan chat
  When  user coba kirim pesan lagi dalam 10 detik
  Then  tombol kirim disabled sampai 10 detik terlewati
```

### Story 8: Ticket history in ContextPanel
> As a user viewing a card, I want to see Linear tickets already filed from this card, so that I know whether it's been reported.

**Rule 1: Query `card_events` filtered by `event_type='linear_ticket_created'` + matching `card_id`**
**Rule 2: Snapshot only — no live Linear status fetch**

```gherkin
Scenario: History ticket di ContextPanel — ada histori
  Given card punya 2 event card_events dengan event_type='linear_ticket_created'
  When  user buka ContextPanel card itu
  Then  2 entry history tampil: title, link, waktu dibuat (snapshot)

Scenario: History ticket di ContextPanel — kosong
  Given card belum pernah punya event 'linear_ticket_created'
  When  user buka ContextPanel card itu
  Then  section history tidak tampil / empty state ringan
```

### Story 9: Workspace-gated availability
> As the system, I want all entry points to require an active workspace, so that `card_events.workspace_id` (NOT NULL) is always satisfiable.

**Rule 1: All three entry points only active when `activeWorkspaceId` is non-null**

```gherkin
Scenario: Floating button tersembunyi tanpa active workspace
  Given activeWorkspaceId adalah null (belum ke-load / user belum punya workspace)
  When  user melihat layout app
  Then  floating chat button tidak muncul / disabled
  And   auto-error entry point juga tidak trigger dalam kondisi ini
```

---

## Acceptance Criteria

```
Rule: Entry points
  ✓ Given activeWorkspaceId non-null, When user klik floating button, Then chat terbuka
  ✓ Given activeWorkspaceId non-null, When user klik "Report issue" di ContextPanel, Then chat terbuka dengan prefill card
  ✓ Given user-initiated call return 500+, When error diterima, Then chat auto-terbuka dengan prefill error, type=Bug, classifier di-skip
  ✗ Given activeWorkspaceId null, When user coba akses entry point manapun, Then entry point tidak tersedia
  ✗ Given background/passive call return 500+ (tidak ditandai user-initiated), When error diterima, Then chat TIDAK terbuka

Rule: Classification & adaptive chat
  ✓ Given entry point bukan auto-error, When turn pertama AI, Then AI selalu nanya classifier bug/feature/improvement
  ✓ Given input awal lengkap, When classifier dijawab, Then AI skip clarifying, langsung preview
  ✓ Given input awal vague, When classifier dijawab, Then AI nanya clarifying spesifik sebelum preview
  ✓ Given auto-error entry point, When chat terbuka, Then classifier di-skip, type otomatis "Bug"

Rule: Preview & confirm
  ✓ Given preview tampil, When user edit title/description, Then edit terpakai saat submit
  ✓ Given preview tampil, Then type badge read-only, tidak ada override manual
  ✗ Given title kosong di preview, When user klik confirm, Then tombol disabled, tidak ada request terkirim
  ✓ Given semua entry point (termasuk auto-error), Then preview+confirm tetap wajib sebelum POST ke Linear

Rule: Submission & failure handling
  ✓ Given issueCreate sukses, When commentCreate gagal, Then overall tetap sukses, error di-log, no retry comment
  ✓ Given issueCreate gagal 500-class, When retry backoff 1s→1m sampai 10x, Then retry otomatis jalan
  ✗ Given issueCreate gagal 400-class, When error diterima, Then tidak ada retry, error message jelas langsung tampil
  ✗ Given semua retry gagal, When retry ke-10 selesai, Then graceful error + tombol resubmit, BUKAN pesan sukses
  ✓ Given retry/resubmit terjadi, Then rate-limit quota tidak terpakai sampai issueCreate sukses

Rule: Rate limiting
  ✗ Given user submit sukses <5menit lalu, When user coba submit lagi, Then tombol disabled + server tolak
  ✗ Given user kirim chat message <10detik lalu, When user coba kirim lagi, Then tombol disabled

Rule: Traceability & history
  ✓ Given ticket dibuat, Then card_events dapet row (event_type='linear_ticket_created', card_id sesuai konteks atau NULL, workspace_id = activeWorkspaceId)
  ✓ Given card punya riwayat ticket, When ContextPanel dibuka, Then history tampil (title+link+created_at, snapshot only)
  ✓ Given card belum punya riwayat, When ContextPanel dibuka, Then empty state ringan
```

---

## Design Decision

**Chosen option:** Option B — Structured extraction + rule-based completeness check

**Summary:** Every chat turn, the LLM returns a strict-JSON structured extraction (title candidate, description, expected, actual, repro steps) — the same strict-JSON pattern already proven by `classifyIntent`/`CLASSIFY_SYSTEM_PROMPT` in `llm.ts`. A pure TypeScript function (unit-testable, no DB dependency, per `testing-conventions.md`) checks whether required fields are present; if so, the extraction becomes the preview draft directly; if not, the AI's next turn asks for the specific missing field(s).

**Rejected options:**
- Option A (single-shot LLM judgment): rejected — non-deterministic branching fails the testability bar this project holds for pure-function logic, and gives no deterministic hook for the title-empty validation rule (Story 5, Rule 2).
- Option C (confidence-scored single call): rejected — introduces an arbitrary numeric threshold with no data to justify tuning, and inherits the same non-determinism risk as Option A behind a false sense of precision.

**Key tradeoffs accepted:**
- Slightly higher per-turn latency/token cost (extract-then-decide) versus a single free-form call
- Requires strict JSON parsing with a fallback path (precedent already exists in `classifyIntent`)

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Exact Linear label GraphQL IDs for Bug/Feature/Improvement (team CAM) | assumed: fetched at implementation time via Linear API query, not hardcoded | Low — mechanical lookup, easily corrected in code |
| Priority field (Int 0-4) on `issueCreate` | assumed: omitted for v1, Linear defaults to "No priority" | Low — cosmetic, can be added later without breaking anything |
| `recordActivity()` `eventType` union doesn't yet include `linear_ticket_created` | assumed: union type extended as part of this work (additive, non-breaking) | Low — compile-time catch if missed |
| Hard-delete of a card cascades `card_events.card_id` (loses ticket history) | assumed: acceptable — no hard-delete path exists in v1 (cards use soft delete) | Low — only matters if hard-delete is added later; revisit then |
| Soft-deleted card's `ContextPanel` (and "Report issue"/history) reachability | assumed: unreachable via normal flows, consistent with existing `deleted_at IS NULL` filtering | Low — no user-facing path currently surfaces soft-deleted cards |
| Multi-tab double-submit near the 5-min rate-limit boundary | assumed: mitigated by per-user (not per-tab) server-side rate-limit key | Low — residual race window is narrow and non-destructive (worst case: 2nd tab blocked, not a duplicate ticket) |

*(All questions above are NON-BLOCKING — documented as assumptions per Edge Case Hunter review, not left as open blockers.)*

---

## Implementation Notes

- `LINEAR_API_KEY` and `LINEAR_TEAM_ID` must be added to `config.ts` as **optional** Zod fields (pattern: `TAVILY_API_KEY`) — feature is gated off (entry points hidden) when either is unset, not a startup-crash dependency
- New external dependency required for Linear API access (official `@linear/sdk` or raw GraphQL fetch) — package choice deferred to pocket-planning/development
- `client/src/api.ts` needs an explicit opt-in mechanism (e.g., a per-call flag/label) so call sites representing direct user actions (Save, submit, drag-drop) can be tagged "user-initiated" for the auto-error entry point; untagged calls (SSE, polling, presence heartbeat) never trigger auto-open — default is no-trigger
- Reuse `prompt-sanitizer.ts` (`sanitizeUserInput`, `detectPromptInjection`, `sanitizeLLMOutput`) for all freeform text entering the ticket-intake LLM calls — same injection risk surface as the board agent
- Floating button: reuse Button Primary token (primary-600) from `creative-brief.md`; position/z-index (9999) is a one-off local value, not promoted to a new creative-brief token in v1

---

## Rollback Plan

- No DB migration to reverse (schema reuse only) — safe to revert the deploying commit directly
- If already deployed: unset `LINEAR_API_KEY` — feature gates off immediately (entry points disappear), no further action needed
- If partial rollback needed: entry points (floating button, ContextPanel action, auto-error hook) can each be independently removed from the client without touching server-side ticket-creation logic
