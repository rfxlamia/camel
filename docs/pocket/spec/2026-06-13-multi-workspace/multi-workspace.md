# Multi-Workspace MVP

**Date:** 2026-06-13
**Status:** draft
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-13-multi-workspace/multi-workspace.md

---

## Summary

Camel currently assumes one global board for all users. This feature introduces workspaces as the access and context boundary: users can belong to multiple workspaces, switch between them, create new ones, and manage members with a simple three-role model. All board data, settings, activity, presence, and real-time events are scoped per workspace.

---

## Context

### Current State

- `columns`, `cards`, `card_events` are global — no `workspace_id`
- `settings` is a global key-value table (`boardName`, `logoPath`)
- Auth is session-only; no roles
- Real-time uses single Redis channel `camel:events` and global presence keys
- API routes: `/api/board`, `/api/cards`, etc. — no tenant context
- `BoardContext` at app root holds all state; `Sidebar` shows global `boardName` + logo

### Problem / Motivation

Enterprise small teams need multiple isolated project contexts under one identity. Without workspace boundaries, data leaks across projects, real-time events mix, and teams cannot self-organize.

### Related Areas

| Area | Files |
|------|-------|
| Schema | `server/src/db/schema.sql` |
| API | `server/src/routes.ts`, `server/src/routes/settings.ts` |
| Real-time | `server/src/realtime.ts` |
| Client state | `client/src/context/BoardContext.tsx` |
| UI | `client/src/layout/Sidebar.tsx`, `client/src/api.ts`, `client/src/types.ts` |
| Design authority | `docs/pocket/rule/creative-brief.md` |

### Related Pitches

- `evolve-camel-workspace` — card enrichment within a workspace (complementary)
- `team-collaboration` — presence/SSE foundation (already landed)
- `multi-page-layout` — sidebar/router foundation (already landed)

---

## Scope

### In-Scope

- `workspaces`, `workspace_members`, `workspace_invites` (pending) tables
- Three roles: owner, admin, member
- `workspace_id` FK on `columns`, `cards`, `card_events`, `settings`
- Idempotent migration: one shared "Default Workspace" for legacy data + empty personal workspace per user
- Workspace CRUD; max 10 memberships per user (personal counts as 1)
- Membership: add by username, pending invites, accept/decline on first login
- API path prefix: `/api/workspaces/:workspaceId/...`
- Real-time: per-workspace Redis channels + SSE filter; `membership.removed` event
- Sidebar workspace switcher (desktop + mobile drawer); `activeWorkspaceId` in localStorage
- Workspace-scoped settings (boardName, logo); owner/admin edit only
- Ownership transfer before owner leave; sole-owner workspace delete (hard cascade)
- Remove `reset-app` — replaced by sole-owner delete workspace

### Out-of-Scope

- Organization layer above workspaces
- Cross-workspace dashboard or aggregated views
- Workspace templates, email/link invites, Cmd+K quick-switch
- Search/recent/pin in switcher
- Public/discoverable workspaces
- Granular roles (viewer, commenter, guest)
- `reset-app` endpoint (removed)
- Per-workspace scroll/card-panel UI state persistence
- Slug-based URL routing
- Multi-tab workspace sync via storage events

---

## Architecture Constraints

- **May touch:** `schema.sql`, `routes.ts`, `realtime.ts`, `auth.ts`, `routes/settings.ts`, `BoardContext.tsx`, `Sidebar.tsx`, `api.ts`, `types.ts`, router paths
- **Must NOT touch:** `server/src/core/*` pure modules — callers pass scoped data
- **Patterns:** `requireAuth`, optimistic locking, SSE Redis degradation, creative brief tokens
- **Architecture validation:** PASS

---

## UX Design (Creative Brief)

- **Tone:** Neutral-friendly — "Workspace created." / "You were removed from {name}."
- **Switcher:** Replaces sidebar header; active workspace always visible (`text-primary-900`, logo/initials `h-6 w-6`)
- **Dropdown:** `rounded-md`, active item `bg-primary-100 text-primary-800`; Ghost "Create workspace" at bottom
- **Picker modal:** Same shell as `SignOutPopover` (`rounded-lg`, `border-neutral-200`, `shadow-lg`)
- **Pending invites popover:** Appears on switcher open when "Remind me later" was chosen
- **Unsaved switch:** Confirm dialog (Cancel / Switch) — same confirm pattern as sign-out

---

## Stories + Scenarios

### Story: Post-login workspace selection

> As a returning user, I want to land in my last-active workspace, so that I resume work without extra clicks.

**Rule 1: Restore last-active**
```gherkin
Scenario: Restore last-active workspace
  Given user "alice" is member of WS-A and WS-B
  And localStorage activeWorkspaceId = WS-A
  When alice logs in
  Then board loads WS-A data
  And sidebar shows WS-A as active

Scenario: Single workspace auto-land
  Given user "bob" is member of only WS-P
  And localStorage has no activeWorkspaceId
  When bob logs in
  Then bob lands on WS-P without picker

Scenario: Invalid saved workspace
  Given user "carol" was removed from WS-X
  And localStorage activeWorkspaceId = WS-X
  When carol logs in
  Then workspace picker is shown
  And invalid localStorage value is cleared
```

### Story: Signup and personal workspace

> As a new user, I want a personal workspace on signup, so I can start immediately.

**Rule 1: Auto-create personal workspace**
```gherkin
Scenario: Signup creates personal workspace
  Given no user "dave" exists
  When dave signs up with display_name "Dave"
  Then workspace "Dave's Workspace" is created with dave as owner
  And dave is the sole member
  And personal workspace is marked is_personal = true
```

**Rule 2: Pending invites require acceptance**
```gherkin
Scenario: Signup stores but does not auto-join invites
  Given pending invite for username "eve" to WS-T
  When eve signs up
  Then personal workspace is created
  And eve is NOT yet a member of WS-T
  And blocking invite modal is shown on first login

Scenario: Accept invite
  Given eve has pending invite to WS-T
  When eve clicks Accept on invite modal
  Then eve becomes member of WS-T
  And invite is consumed

Scenario: Remind me later
  Given eve clicks Remind me later
  When eve opens workspace switcher
  Then invite popover appears (SignOutPopover pattern)

Scenario: Membership cap on accept
  Given frank has 10 workspace memberships
  When frank attempts to Accept invite to WS-11
  Then Accept is disabled with cap message
```

**Rule 3: Create workspace cap**
```gherkin
Scenario: Cannot create 11th workspace
  Given frank belongs to 10 workspaces
  When frank attempts to create a new workspace
  Then 409 with "You've reached the workspace limit (10)."
```

### Story: Workspace switcher

> As a user in multiple workspaces, I want to switch context from the sidebar, so I always know where I am.

```gherkin
Scenario: Switch reloads all context
  Given user "grace" is active in WS-1
  When grace selects WS-2 from switcher
  Then board, metrics, activity, presence, settings reload for WS-2
  And localStorage activeWorkspaceId = WS-2
  And SSE reconnects to WS-2 channel only

Scenario: Unsaved edits confirmation
  Given grace has unsaved card edits in context panel
  When grace attempts to switch workspace
  Then confirm dialog appears
  When grace confirms Switch
  Then workspace switches and edits are discarded

Scenario: Create workspace from switcher
  Given grace opens workspace switcher dropdown
  When grace clicks "Create workspace"
  Then create workspace flow opens
  And on success toast shows "Workspace created."
```

### Story: Membership management

> As admin/owner, I want to manage members, so teams can collaborate safely.

```gherkin
Scenario: Add existing user as member
  Given admin "henry" in WS-M, user "iris" exists and has < 10 memberships
  When henry adds "iris" by username
  Then iris becomes member (default role: member)

Scenario: Pending invite for unknown user
  Given admin adds username "jack" who does not exist
  Then pending invite is stored
  When jack signs up and accepts
  Then jack joins WS-M as member

Scenario: Invitee at cap
  Given iris belongs to 10 workspaces
  When henry adds iris to WS-M
  Then 409 with cap message

Scenario: Member cannot manage
  Given member "kate" in WS-M
  When kate attempts to add a user
  Then 404 (uniform error policy)

Scenario: Cannot remove owner
  Given owner "leo" in WS-L
  When admin attempts to remove leo
  Then 403
```

### Story: Ownership transfer and deletion

```gherkin
Scenario: Transfer ownership
  Given owner "leo" and member "mia" in WS-L
  When leo transfers ownership to mia and chooses role admin
  Then mia is owner and leo is admin

Scenario: Block delete with multiple members
  Given owner leo and member mia in WS-L
  When leo attempts to delete WS-L
  Then request fails — must transfer or wait until sole member

Scenario: Sole owner deletes workspace
  Given leo is sole member/owner of WS-L
  When leo deletes WS-L
  Then workspace and all scoped data are permanently removed

Scenario: Personal workspace non-deletable
  Given user "nina" with personal workspace WS-N
  When nina attempts to delete WS-N
  Then 403 — personal workspaces cannot be deleted in MVP
```

### Story: Removal while active

```gherkin
Scenario: SSE removal redirect
  Given user "nina" is viewing WS-R
  And nina has personal workspace WS-N
  When admin removes nina from WS-R
  Then SSE event membership.removed is delivered
  And nina is immediately redirected to WS-N
  And toast shows "You were removed from WS-R."

Scenario: Removal from non-active workspace
  Given nina is viewing WS-S
  When nina is removed from WS-R
  Then no redirect occurs
```

### Story: Data isolation and real-time

```gherkin
Scenario: Cross-workspace API returns 404
  Given user "oscar" member of WS-A only
  When oscar requests card in WS-B by ID
  Then 404

Scenario: Real-time isolation
  Given oscar SSE connected to WS-A
  When card created in WS-B
  Then oscar does not receive that event

Scenario: Redis degradation still filters
  Given Redis is down (local fan-out)
  When event fires in WS-B
  Then WS-A clients do not refresh
```

### Story: Migration

```gherkin
Scenario: Idempotent migration of shared board
  Given DB with global columns/cards and 3 users, no workspaces
  When migration runs
  Then one "Default Workspace" is created with all legacy data
  And all 3 users are members (first user = owner, others = member)
  And each user gets empty personal workspace (is_personal = true)
  And workspace_id is NOT NULL on scoped tables

Scenario: Migration idempotency
  When migration runs a second time
  Then no duplicate workspaces or data assignments
```

### Story: Deep links

```gherkin
Scenario: Card not in active workspace
  Given user on WS-A, URL is /board/card/42
  And card 42 belongs to WS-B
  When page loads
  Then redirect to /board (cardId cleared)
  And no toast shown
```

### Story: Workspace settings

```gherkin
Scenario: Settings scoped per workspace
  Given WS-A boardName="Alpha", WS-B boardName="Beta"
  When user switches from WS-A to WS-B
  Then sidebar shows "Beta"

Scenario: Member cannot edit settings
  Given member "kate" in WS-M
  When kate PATCHes settings
  Then 403
```

---

## Acceptance Criteria

```
Rule: Post-login workspace selection
  ✓ Given last-active workspace valid, When login, Then restore that workspace
  ✓ Given single workspace only, When login, Then auto-land without picker
  ✓ Given invalid saved workspace, When login, Then show picker and clear localStorage

Rule: Signup and invites
  ✓ Given new signup, When complete, Then personal workspace created as owner
  ✓ Given pending invites, When first login, Then blocking modal with Accept/Decline/Remind me later
  ✓ Given Remind me later, When switcher opens, Then invite popover appears
  ✓ Given 10 memberships, When Accept or create, Then 409 cap error
  ✗ Given non-member, When access workspace API, Then 404

Rule: Workspace switcher
  ✓ Given switch workspace, When selected, Then all context reloads and SSE reconnects
  ✓ Given unsaved edits, When switch attempted, Then confirm dialog required
  ✓ Given switcher or picker, When create clicked, Then workspace created (Ghost button)

Rule: Membership and roles
  ✓ Given admin adds existing user, When username valid, Then member role assigned
  ✓ Given admin adds unknown username, When saved, Then pending invite stored
  ✓ Given owner with members, When delete attempted, Then blocked until sole member
  ✓ Given sole owner, When delete, Then hard cascade all scoped data

Rule: Removal and real-time
  ✓ Given removed from active workspace, When SSE membership.removed, Then redirect to personal workspace
  ✓ Given cross-workspace event, When SSE active, Then event not delivered

Rule: Migration
  ✓ Given legacy global board, When migrate, Then one Default Workspace + personal per user
  ✓ Given migration re-run, When execute, Then idempotent no-op

Rule: Deep links
  ✓ Given card not in active workspace, When load, Then redirect /board silently

Rule: Settings
  ✓ Given owner/admin, When PATCH settings, Then saved per workspace
  ✗ Given member, When PATCH settings, Then 403
```

---

## Design Decision

**Chosen option:** Option A — Full Multi-Workspace MVP with URL path prefix

**Summary:** Implement complete workspace boundary (data model, API, real-time, UI switcher, membership, migration) using `/api/workspaces/:id/...` routes. Aligns with enterprise requirement and avoids partial isolation risks.

**Rejected options:**
- Option B (minimal, no access control): rejected — data isolation is security requirement
- Option C (personal + shared split): rejected — two code paths without clear user value
- Header-based API context: rejected — path prefix is more explicit and debuggable

**Key tradeoffs accepted:**
- Large MVP scope vs. clean architecture from day one
- Deep link redirects to `/board` instead of auto-switch (simpler, no surprise context change)
- Multi-tab last-write-wins for `activeWorkspaceId` (no sync in MVP)

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Multi-tab workspace sync | assumed: independent tabs, localStorage last-write-wins | Minor UX confusion |
| Add user at invitee cap | assumed: 409 | Low — standard REST |
| Admin remove owner | assumed: 403, must transfer first | Low — matches role model |
| Personal workspace identity | assumed: `is_personal` boolean on workspaces | Redirect on removal fails if ambiguous |
| Personal workspace delete/leave | assumed: blocked in MVP | User clutter if wrong |
| Migration first user as owner | assumed: lowest user id or seed user | Wrong owner assignment |

---

## Implementation Notes

- Add `is_personal BOOLEAN NOT NULL DEFAULT false` on `workspaces`
- Add `workspace_invites` table: `(workspace_id, username, role, invited_by, created_at)` UNIQUE on `(workspace_id, username)`
- Scope `settings` with `workspace_id` FK; migrate global rows to Default Workspace
- Redis channels: `camel:workspace:{id}:events`; presence: `camel:workspace:{id}:presence:{userId}`
- Client routes evolve to include workspace: consider `/workspaces/:id/board` or keep `/board` with context from BoardContext
- Remove `POST /settings/reset-app` and Settings danger-zone UI in same pass
- Migration guard: `IF EXISTS (SELECT 1 FROM workspaces LIMIT 1) THEN skip`

### API shape (representative)

```
GET    /api/workspaces
POST   /api/workspaces
GET    /api/workspaces/:id/board
POST   /api/workspaces/:id/cards
GET    /api/workspaces/:id/members
POST   /api/workspaces/:id/members
POST   /api/workspaces/:id/invites/:inviteId/accept
DELETE /api/workspaces/:id/invites/:inviteId
POST   /api/workspaces/:id/transfer-ownership
DELETE /api/workspaces/:id
GET    /api/workspaces/:id/events  (SSE)
```

---

## Rollback Plan

- Feature is structural — rollback requires DB restore from pre-migration backup
- Pre-migration: snapshot DB before running workspace migration
- If partial deploy: disable new routes, restore monolithic `/api/board` from previous release tag
