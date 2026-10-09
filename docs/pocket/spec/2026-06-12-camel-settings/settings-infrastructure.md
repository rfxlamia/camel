# Settings Infrastructure

**Date:** 2026-06-13
**Status:** draft
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md

---

## Summary

Camel has zero configuration surface — board name ("Camel"), logo (`/logo.png`), and browser title are all hardcoded. This feature adds a settings infrastructure: a `settings` table in PostgreSQL, REST API for CRUD, and a dedicated `/settings` page with live preview. MVP scope covers board name customization, logo upload with client-side cropping, and destructive actions (Reset Settings, Reset App) with appropriate safeguards.

---

## Context

### Current State
- Sidebar (`client/src/layout/Sidebar.tsx`): hardcoded `<img src="/logo.png">` and `<span>Camel</span>`
- Browser tab title (`client/index.html`): hardcoded `"Camel — Kanban for dev teams"`
- Favicon: none implemented
- DB schema: only `columns`, `cards`, `card_events`, `users`, `sessions` tables
- BoardContext (`client/src/context/BoardContext.tsx`): no settings state, all `useState` for board data
- No settings API routes in `server/src/routes.ts`
- Optimistic locking pattern exists on cards (field `version`) — reusable pattern

### Problem / Motivation
For an open-source kanban board targeting plug-and-play configurability, zero customization is a blocking gap. Users/admins cannot customize board identity or control features. Personalization creates ownership feeling and is a selling point for self-hosted deployments.

### Related Areas
- `client/src/layout/Sidebar.tsx` — renders board name and logo (needs refactor)
- `client/index.html` — static title tag (needs dynamic update)
- `client/src/context/BoardContext.tsx` — may need settings state
- `client/src/App.tsx` — router setup (new `/settings` route)
- `server/src/routes.ts` — API routes (new settings endpoints)
- `server/src/db/schema.sql` — DB schema (new `settings` table)
- `server/src/auth.ts` — `requireAuth` middleware (reuse for settings routes)

---

## Scope

### In-Scope
- Settings table in DB (typed columns: `text_value`, `bool_value`)
- GET/PATCH API endpoints for settings (bulk operations)
- Settings page at `/settings` route with collapsible sections: Identity, Danger Zone
- Board name customization (1-15 chars, live preview after save)
- Logo upload with client-side cropping (`.png`/`.jpg`, ≤10MB, 1:1 aspect ratio)
- Dynamic favicon from uploaded logo
- Dynamic browser tab title with board name
- Reset Settings (delete all settings, revert to hardcoded defaults)
- Reset App (hard delete cards + columns + settings, users remain, multi-step confirmation)
- Optimistic locking on settings (version field, conflict detection)
- Unsaved changes warning when navigating away
- Toast feedback after save/reset operations
- Error popovers for logo validation failures
- Active user check before Reset App (prevent reset while others online)

### Out-of-Scope
- Per-user settings (defer to post-MVP, no scope column)
- AI feature toggle (no AI features exist yet)
- Search/filter settings (premature for <30 settings)
- Audit trail for settings changes (addable later via trigger)
- Image upload to external storage (S3/Cloudinary) — local filesystem only
- Integrations section (no integrations exist)
- Tabbed settings layout (premature optimization for <20 settings)
- Delete Board (separate from Reset App, defer to future)
- Workspace/role system (all users equal access for MVP)

---

## Architecture Constraints

- **Layers this work may touch:** DB schema, server routes, client pages/components/context
- **Layers this work must NOT touch:** core/ modules (position, wip, metrics) — pure functions, no settings dependency
- **Patterns that must be followed:**
  - Optimistic locking via `version` field (matches cards pattern)
  - Toast feedback via `BoardContext.showToast()` (existing pattern)
  - `requireAuth` middleware on all settings routes (existing pattern)
  - Soft delete where applicable (cards have `deleted_at`)
- **Architecture validation result:** PASS

---

## Stories + Scenarios

### Story 1: Board Name Customization
> As a user, I want to change the board name, so that my team sees our identity in the sidebar and browser tab.

**Rule 1: Board name must be 1-15 characters**
- Example A: Input "Dev Team" → saved, sidebar shows "Dev Team"
- Example B: Input "A" → saved, sidebar shows "A"
- Example C: Input "" (empty) → error: "Name is required"
- Example D: Input "   " (whitespace) → error: "Name is required"
- Example E: Input "  Dev Team  " → trimmed to "Dev Team"
- Example F: Input "1234567890123456" (16 chars) → error: "Max 15 characters"

**Rule 2: Sidebar and browser title update after save**
- Example A: Save name "Dev Team" → sidebar shows "Dev Team", tab title shows "Dev Team — Kanban"

```gherkin
Scenario: User changes board name successfully
  Given user is on /settings page
  And current board name is "Camel"
  When user types "Dev Team" in board name input
  And clicks Save
  Then board name updates to "Dev Team"
  And sidebar shows "Dev Team"
  And browser tab title shows "Dev Team — Kanban"
  And toast shows "Settings saved"

Scenario: User submits empty board name
  Given user is on /settings page
  When user clears board name input
  And clicks Save
  Then error message appears: "Name is required"
  And settings are not saved

Scenario: User submits name exceeding 15 characters
  Given user is on /settings page
  When user types "Super Long Board Name" in board name input
  And clicks Save
  Then error message appears: "Max 15 characters"
  And settings are not saved

Scenario: User submits whitespace-only name
  Given user is on /settings page
  When user types "   " in board name input
  And clicks Save
  Then error message appears: "Name is required"
  And settings are not saved

Scenario: User submits name with leading/trailing spaces
  Given user is on /settings page
  When user types "  Dev Team  " in board name input
  And clicks Save
  Then board name is trimmed to "Dev Team"
  And sidebar shows "Dev Team"

Scenario: Optimistic locking conflict on board name
  Given User A and User B both open /settings
  And current board name version is 1
  When User A changes name to "Alpha" and saves
  Then User A sees success
  When User B changes name to "Beta" and saves
  Then User B sees conflict error: "Someone else updated settings first"
  And settings refresh to show "Alpha"
```

### Story 2: Logo Customization
> As a user, I want to upload a custom logo, so that my board has a unique identity in sidebar and browser tab.

**Rule 1: Only .png and .jpg files accepted, max 10MB**
- Example A: Upload "logo.png" (2MB) → accepted, crop UI shown
- Example B: Upload "doc.pdf" → error: "Only .png and .jpg files are accepted"
- Example C: Upload 15MB image → error: "File size must be under 10MB"

**Rule 2: User crops to 1:1 aspect ratio before upload**
- Example A: Select crop area → upload proceeds
- Example B: Cancel crop → no file uploaded, current logo remains

**Rule 3: Old logo file deleted when new one uploaded**
- Example A: Upload new logo → old file deleted from filesystem, new file saved

**Rule 4: Sidebar and favicon update after save**
- Example A: Save logo → sidebar shows new logo, favicon updates

```gherkin
Scenario: User uploads and crops logo successfully
  Given user is on /settings page
  When user selects a .png file (2MB)
  Then crop UI appears with 1:1 aspect ratio
  When user selects crop area and confirms
  And clicks Save
  Then logo file is saved to client/public/uploads/
  And settings store new logo path
  And sidebar shows new logo
  And favicon updates to new logo
  And toast shows "Settings saved"

Scenario: User uploads non-image file
  Given user is on /settings page
  When user selects a .pdf file
  Then error popover appears: "Only .png and .jpg files are accepted"

Scenario: User uploads file exceeding 10MB
  Given user is on /settings page
  When user selects a .png file (15MB)
  Then error popover appears: "File size must be under 10MB"

Scenario: User cancels crop
  Given user is on /settings page
  And crop UI is open
  When user clicks Cancel on crop UI
  Then crop UI closes
  And no file is uploaded
  And current logo remains unchanged

Scenario: User uploads new logo, old file is cleaned up
  Given user previously uploaded logo "custom-abc123.png"
  When user uploads new logo and saves
  Then old file "custom-abc123.png" is deleted from filesystem
  And new file is saved

Scenario: Upload fails mid-transfer (network error)
  Given user is uploading a logo
  When network error occurs during upload
  Then error popover appears: "Upload failed. Please try again."
  And current logo remains unchanged
  And no orphaned temp file remains
```

### Story 3: Reset Settings
> As a user, I want to reset all settings to defaults, so that I can start fresh without losing board data.

**Rule 1: Reset deletes all settings from DB, reverts to hardcoded defaults**
- Example A: Custom name "Dev Team" + custom logo → reset → name "Camel", logo "/logo.png"

**Rule 2: Confirmation dialog required before reset**
- Example A: Click Reset Settings → confirmation → user confirms → reset proceeds
- Example B: Click Reset Settings → confirmation → user cancels → nothing happens

**Rule 3: Board data (cards, columns) NOT affected**
- Example A: Board has 5 columns, 20 cards → reset settings → columns and cards unchanged

```gherkin
Scenario: User resets settings successfully
  Given user has customized board name to "Dev Team"
  And user has uploaded custom logo
  When user clicks "Reset Settings" in Danger Zone
  Then confirmation dialog appears: "Reset all settings to defaults?"
  When user clicks Confirm
  Then all settings rows are deleted from DB
  And board name reverts to "Camel"
  And logo reverts to "/logo.png"
  And sidebar shows defaults
  And browser tab title shows "Camel — Kanban"
  And favicon reverts to default
  And toast shows "Settings reset to defaults"

Scenario: User cancels reset settings
  Given user has customized settings
  When user clicks "Reset Settings" in Danger Zone
  Then confirmation dialog appears
  When user clicks Cancel
  Then dialog closes
  And settings remain unchanged

Scenario: Reset settings does not affect board data
  Given board has 3 columns and 15 cards
  When user resets settings
  Then columns and cards remain unchanged
```

### Story 4: Reset App
> As a user, I want to reset the entire app to a fresh state, so that I can start over when needed.

**Rule 1: Hard delete all cards, columns, and settings; users remain**
- Example A: Board has data → reset app → board empty, settings default, users can log in

**Rule 2: Multi-step confirmation required**
- Example A: Type "DELETE" (case-insensitive) + check "I understand" → button enabled
- Example B: Type "delete" → button enabled (not case-sensitive)
- Example C: Type "DELETE" but don't check box → button disabled
- Example D: Type "  DELETE  " (extra spaces) → trimmed, button enabled

**Rule 3: Blocked when other users are online**
- Example A: User B online → User A tries reset → error: "Cannot reset while other users are online"

```gherkin
Scenario: User resets app successfully
  Given board has 5 columns, 20 cards, custom settings
  And no other users are online
  When user clicks "Reset App" in Danger Zone
  Then multi-step confirmation modal appears
  When user types "DELETE" in text input
  And checks "I understand this cannot be undone" checkbox
  And clicks "Reset App" button
  Then all cards are hard-deleted
  And all columns are hard-deleted
  And all settings are deleted
  And board shows empty state
  And users can still log in
  And toast shows "App has been reset"

Scenario: User types confirmation text (case-insensitive)
  Given user is on Reset App confirmation modal
  When user types "delete" (lowercase)
  Then "Reset App" button becomes enabled

Scenario: User does not check understanding checkbox
  Given user is on Reset App confirmation modal
  When user types "DELETE" correctly
  But does not check the checkbox
  Then "Reset App" button remains disabled

Scenario: User cancels reset app
  Given user is on Reset App confirmation modal
  When user clicks Cancel
  Then modal closes
  And all data remains unchanged

Scenario: Reset app blocked when other users are online
  Given User A wants to reset app
  And User B is currently online
  When User A clicks "Reset App"
  Then error message appears: "Cannot reset while other users are online"
  And reset is not performed

Scenario: User types with extra spaces
  Given user is on Reset App confirmation modal
  When user types "  DELETE  " (with spaces)
  Then text is trimmed and "Reset App" button becomes enabled
```

### Story 5: Settings Page
> As a user, I want a dedicated settings page, so that I can manage board configuration in one place.

**Rule 1: Settings page at /settings route, accessible from sidebar**
- Example A: Click "Settings" in sidebar → navigates to /settings
- Example B: Navigate directly to /settings via URL → page loads

**Rule 2: Page shows current settings values from DB**
- Example A: Board name "Dev Team" → input shows "Dev Team"
- Example B: No settings in DB (fresh install) → shows defaults ("Camel", "/logo.png")

**Rule 3: Unsaved changes warning when navigating away**
- Example A: Change name but don't save → click Board nav → browser confirms discard

```gherkin
Scenario: User navigates to settings page
  Given user is logged in
  When user clicks "Settings" in sidebar
  Then /settings page loads
  And shows current board name in input
  And shows current logo preview
  And shows Danger Zone section at bottom
  And browser tab title shows "Settings — Camel"

Scenario: Settings page shows current values
  Given board name is "Dev Team"
  And logo is custom upload
  When user navigates to /settings
  Then board name input shows "Dev Team"
  And logo preview shows custom upload

Scenario: Settings page loads with no existing settings (fresh install)
  Given no settings exist in DB
  When user navigates to /settings
  Then board name input shows "Camel" (default)
  And logo preview shows "/logo.png" (default)

Scenario: User has unsaved changes and navigates away
  Given user changed board name but did not save
  When user clicks another nav link (e.g., Board)
  Then browser shows "Discard unsaved changes?" confirmation
  If user confirms → navigate away, changes lost
  If user cancels → stay on /settings

Scenario: Settings page API fails to load
  Given API returns error when loading settings
  When user navigates to /settings
  Then error state shown with retry option
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — Settings Infrastructure
Date: 2026-06-13 | Scope confirmed: yes

Rule: Board Name Customization
  ✓ Given user on /settings, When types "Dev Team" and saves, Then sidebar + tab title show "Dev Team"
  ✓ Given user on /settings, When submits empty name, Then error "Name is required"
  ✓ Given user on /settings, When submits 16+ chars, Then error "Max 15 characters"
  ✓ Given user on /settings, When submits "  Dev Team  ", Then trimmed to "Dev Team"
  ✓ Given two users edit name, When second saves, Then conflict error shown

Rule: Logo Customization
  ✓ Given user on /settings, When uploads .png and crops, Then logo saved to public/uploads/
  ✓ Given user on /settings, When uploads .pdf, Then error "Only .png and .jpg files are accepted"
  ✓ Given user on /settings, When uploads 15MB file, Then error "File size must be under 10MB"
  ✓ Given user on /settings, When cancels crop, Then no file uploaded
  ✓ Given old logo exists, When new logo uploaded, Then old file deleted
  ✓ Given network error on upload, Then error popover shown, current logo unchanged

Rule: Reset Settings
  ✓ Given customized settings, When user resets, Then settings deleted, defaults restored
  ✓ Given user clicks Reset Settings, When cancels, Then settings unchanged
  ✓ Given board has cards, When user resets settings, Then cards unchanged

Rule: Reset App
  ✓ Given no other users online, When user resets app, Then cards + columns + settings hard-deleted
  ✓ Given other users online, When user tries reset, Then error "Cannot reset while other users are online"
  ✓ Given user on confirmation, When types "delete" + checks box, Then button enabled
  ✓ Given user on confirmation, When types "DELETE" but no checkbox, Then button disabled

Rule: Settings Page
  ✓ Given user logged in, When clicks Settings in sidebar, Then /settings loads
  ✓ Given no settings in DB, When loads /settings, Then defaults shown
  ✓ Given unsaved changes, When navigates away, Then confirmation dialog shown
  ✓ Given API error, When loads /settings, Then error state with retry

OPEN QUESTIONS (risks if unresolved):
  - None — all questions resolved

OUT-OF-SCOPE (remind pocket-planning):
  - Per-user settings (no scope column)
  - AI feature toggle (no AI features yet)
  - Workspace/role system (trust-based for MVP)
  - Delete Board (defer to future)
  - Tabbed settings layout
  - External storage (S3/Cloudinary)
  - Audit trail
```

---

## Design Decision

**Chosen option:** Option A — Single Settings Table + BoardContext Integration

**Summary:** Settings stored in single `settings` table with typed columns (`text_value`, `bool_value`). Client extends existing BoardContext to include settings state. Single API endpoint for bulk GET/PATCH. Optimistic locking via `version` field per setting.

**Rejected options:**
- Option B (Dedicated SettingsContext): rejected because over-engineering for MVP — settings is small, doesn't warrant separate context
- Option C (JSONB column): rejected because violates "no JSONB" constraint — typed columns preferred for type safety and performance

**Key tradeoffs accepted:**
- Per-setting version (not atomic across all settings) — acceptable because settings change rarely
- react-easy-crop as new dependency — necessary for client-side cropping UX
- multer for Express — standard for file uploads, no external storage dependency

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Max board name length | confirmed: 15 characters | UI may feel cramped if too short |
| Logo file storage | confirmed: `client/public/uploads/` | May need CDN for production scale |
| Reset App confirmation text | confirmed: "DELETE", case-insensitive, trimmed | Low risk — explicit user intent |
| Active user detection | use existing presence/heartbeat system | Already implemented, no new infra |
| Default values | confirmed: "Camel" + "/logo.png" hardcoded | Low risk — fallback always works |

---

## Implementation Notes

1. **Sidebar refactor:** Replace hardcoded `<img src="/logo.png">` and `<span>Camel</span>` with dynamic values from settings state
2. **favicon link element:** Dynamically create/update `<link rel="icon">` in `<head>` when settings load
3. **document.title:** Update via `useEffect` when board name changes
4. **Logo upload flow:** Client-side crop → FormData upload → server saves to `public/uploads/` → returns path → store in settings
5. **Active user check:** Reuse existing `onlineUsers()` from `realtime.ts` before allowing Reset App
6. **DB migration:** New `settings` table, no ALTER on existing tables

---

## Rollback Plan

1. **Code rollback:** Revert commits touching `settings` table, routes, and UI
2. **DB cleanup:** `DROP TABLE IF EXISTS settings;` — no data loss (settings is additive)
3. **File cleanup:** `rm -rf client/public/uploads/` — remove uploaded logos
4. **Sidebar restore:** Hardcode "Camel" and "/logo.png" back to Sidebar.tsx
5. **No feature flag needed:** This is additive, no existing behavior changed
