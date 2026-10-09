# Pitch Exploration: profile-account-settings
Date: 2026-07-26 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement
Camel's settings surface is a single flat page (`/settings`) mixing workspace-scoped controls (Identity, Invite Member, Danger Zone) with the one account-scoped control that exists (recovery password). There is no way for a user to change their username, display name, or avatar — neither the backend endpoints nor the UI exist. A real inbound issue already reports this: a user forgot their username and separately wants to change username + profile picture. The current page also has a structural defect: it early-returns "Select a workspace to view settings" when `activeWorkspaceId === null`, which blocks account-scoped actions (like setting a recovery password) for a user who has no active workspace — an ownership-scope bug, not a UX preference.

## Root Tension
Scope separation (account vs workspace) is a *requirement*, not a preference — a single flat page structurally cannot express two different ownership scopes. Once that's accepted, a nav-rail with categories becomes necessary; whether that rail renders as a full page or as an overlay is a secondary, comparatively cheap rendering decision.

## Key Constraints
- `username` is a UNIQUE DB column, used as the login identifier and rate-limit key (`auth.ts`), and matched by string in `workspace_invites.username` (unique per workspace+username) — renaming it is a credential mutation with real blast radius, not a cosmetic edit.
- `display_name` (`schema.sql:39`) is NOT NULL but has no uniqueness constraint and is not used for login, rate-limiting, or invite targeting — safe to make editable independently and first.
- Neither `username` nor `display_name` has any update endpoint today (confirmed via spike) — this is greenfield backend work, not a UI-only change.
- `set-username` (`server/src/routes/oauth.ts:15`) is a one-time claim endpoint: it explicitly 409s when `req.user.username !== null`. It cannot be repurposed for rename without changing its contract.
- Pending workspace invites are consumed by matching `username` as a string at claim time (`oauth.ts:52-56`). If a username is freed by a rename, whoever claims that string next could inherit any *new* invites addressed to it — a policy decision is required (resolve invites by `user_id` at accept time, or lock released usernames from reuse).
- No `avatar_url` column exists yet. The existing upload pattern (`LogoCropper` → `client/public/uploads/`) is one-file-per-workspace and lives inside the client build output directory; whether the Docker deploy volume-mounts that path for a growing, one-per-user avatar set is unverified.
- Reusable modal/dialog patterns already exist in the codebase (`WorkspaceModals.tsx`, `ContextPanel.tsx`) — an overlay-based settings surface would not be a new UI paradigm for this app.
- Multi-workspace exists (cap of 10 workspaces per user) — account-scope UI must not depend on `activeWorkspaceId`.

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Is username identity-primary (login credential) or just a display label? Changing it is a different risk class than changing a board name.
- Is "forgot username" solved by prevention (always-visible surface) or by recovery (lookup-by-email)? Different features, different scope.
- Does a nested-nav settings surface stay bookmarkable/deep-linkable, or does restructuring lose that?
- Does Danger Zone (workspace reset/delete) move under a "Workspace" category once scopes split?

### First Principles Thinking — creative
Key insights:
- Username is a UNIQUE credential dependency (login + invite matching), not a preference — fundamentally different from board name/logo.
- A user is not a workspace; a user can hold up to 10 workspaces. Account-scope settings placed inside a workspace-scoped page inherit the wrong context every time the active workspace changes.
- The `activeWorkspaceId === null` early return is a first-principles violation: account-scope rendering has no logical dependency on workspace state at all.
- Security-sensitive actions (username/password change) should not be gated by workspace role permissions (`canEdit` / owner-admin check) — that gate belongs to workspace-scope actions only.

### Six Thinking Hats — structured
Key insights:
- **White (facts):** Username is currently immutable post-creation. No `avatar_url` column exists. A real user issue is already open.
- **Red (emotion):** Users locked out by a forgotten username lose trust in a young product that can't do basic self-service identity management.
- **Yellow (benefit):** Splitting Account/Workspace matches the mental model of comparable tools (Slack, Notion, claude.ai) — faster orientation for new users.
- **Black (risk):** `Invite Member` targets users by username string; renaming after a pending invite exists creates a hijack/misdirection surface.
- **Green (creativity):** An overlay-based settings pattern is reusable for any future account-level surface (notifications, billing) without adding new routes each time.
- **Blue (process):** Backend (rename endpoint + invite policy + avatar migration) must land before UI restructuring — not the reverse.

### Reverse Brainstorming — creative
Key insights:
- Shipping username rename without an atomic uniqueness check reintroduces the exact TOCTOU bug class recently fixed elsewhere in this codebase (`f39fccf`, `25278b3`).
- Building a Profile surface that's still gated behind `activeWorkspaceId !== null` makes the single most basic self-service action (edit your own identity) still unreachable for the affected users.
- Reusing `LogoCropper` for avatars without separating the concern mixes workspace-branding upload logic with personal-identity upload logic.
- An overlay without URL-addressable state loses shareability/bookmarkability compared to the current `/settings` route.
→ Inverted insight: whichever direction ships must guarantee (a) atomic uniqueness checks from day one, (b) account-scope UI with zero dependency on `activeWorkspaceId`, (c) an avatar upload flow that is logically separate from logo upload even if UI components are shared, (d) URL-addressable sub-state for any overlay/modal approach.

---

## Advisor Synthesis
The advisor flagged two blocking unknowns before convergence: whether `set-username` already permits rename (it doesn't — verified via spike, it's a one-time claim endpoint), and whether `username` and `display_name` are being treated as one feature when they're two different risk profiles (confirmed: `display_name` is cheap and independently shippable, `username` needs an explicit rename policy). The advisor also reframed the two directional axes as dependent rather than parallel: scope separation is the actual requirement, and it mechanically forces a nav-rail UI; modal-vs-page is a secondary, cheaper decision layered on top — not a separate fork in the decision tree.

---

## Spike Results

**Unknown resolved:** Does `set-username` already support renaming an existing username?
**Finding:** No. `server/src/routes/oauth.ts:15-118` explicitly returns `409 "Username already set."` when `req.user.username !== null`. It is a pending-user-only, one-time claim endpoint tied to workspace-provisioning-on-first-login, not a general rename path.
**Implication:** A rename feature requires a new backend endpoint and an explicit policy for the invite-string blast radius described in Key Constraints — this is not a thin UI addition over existing infrastructure.

**Unknown resolved:** Is `display_name` already editable anywhere, making it a cheaper first slice than `username`?
**Finding:** Confirmed cheap and currently unimplemented — no PATCH/PUT route touches `display_name` post-registration anywhere in `server/src/routes/`. It carries no uniqueness constraint and isn't used for login, rate-limiting, or invite matching.
**Implication:** `display_name` editing can ship independently of the riskier `username` rename policy, and can gate the whole feature's timeline less than username does.

---

## Approach Directions

### Direction A: Ship-fast — hoist an Account block, no nav restructure
Add an "Account" section (display_name, username with policy, avatar) above the existing workspace early-return, inside the current flat `/settings` page. No routing or nav changes.
+ Fastest path to closing the real ticket and fixing the `activeWorkspaceId` defect
− Doesn't resolve the structural problem — the next 2-3 account features re-create the same flat-page mixing

### Direction B: Scope-separated left-rail, rendered as a full page
`/settings` gains a left-rail with two categories — **Account** (username/display_name/avatar/password) and **Workspace** (Identity/Invite/Danger Zone) — still a dedicated route, no overlay infrastructure.
+ Delivers the required scope separation with no new UI paradigm (no portal/focus-trap/z-index work)
− Full page navigation away from the board loses scroll position/context on every settings visit

### Direction C: Scope-separated left-rail, rendered as an overlay (hash/query-addressable)
Same left-rail/category content as Direction B, but mounted as an overlay reachable from anywhere in the app via URL fragment or query state (e.g. `#settings/profile`), matching the claude.ai reference pattern the user pointed to. Reuses existing modal/dialog conventions already in the codebase (`WorkspaceModals.tsx`, `ContextPanel.tsx`).
+ Same core build cost as B (nav-rail + category content is shared work) plus a real UX win: no context loss, closable back to exact prior board state, still URL-addressable
− Adds overlay-specific concerns (focus-trap, z-index stacking against existing modals like card detail) that B doesn't have

---

## Open Questions for pocket-grinding
- [ ] Invite blast-radius policy: resolve `workspace_invites` by `user_id` at accept time, or lock a released username from reuse for some period? Which does the existing invite-acceptance code path support more cheaply?
- [ ] Does the production Docker deploy volume-mount `client/public/uploads/` (or wherever avatars land), or does that path get wiped on redeploy?
- [ ] Should username rename invalidate/refresh the current session, or is the session already keyed by `user.id` (not username) end-to-end?
- [ ] What validation should govern rename frequency/cooldown, if any — unlimited renames re-opens the invite-hijack surface repeatedly?
- [ ] For Direction C: does an overlay-based settings surface conflict with any existing modal z-index/focus-trap stacking (e.g. opening Settings while a card detail modal is open)?
- [ ] Does `USERNAME_RE` / `validateUsername` (already used in `set-username`) get reused as-is for rename, or does rename need different validation (e.g. blocking renames to a very recently-released username)?

---

## Recommended Direction
Direction C — it requires the same nav-rail and category-content work as Direction B, but the overlay wrapper is a comparatively thin addition on top of modal patterns already present in this codebase, and it delivers a genuine UX improvement (no context loss leaving the board) that matches both the reference pattern the user identified and common practice across comparable products.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction C as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- Note: `display_name` editing and `username` renaming are two separate risk profiles that may warrant separate Stories/Rules in grinding, not one merged "profile edit" story
