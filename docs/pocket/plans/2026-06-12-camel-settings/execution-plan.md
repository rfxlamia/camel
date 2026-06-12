# EXECUTION PLAN — Settings Infrastructure

**Date:** 2026-06-13
**Spec:** docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md
**Status:** validated (2026-06-13 — DRY/YAGNI/TDD + codebase gap analysis applied)
**Total tasks:** 6

---

### Test-Architect Summary

```
Tasks enriched: 6
Integration test tasks added: 0 (all GWT scenarios are unit-verifiable)
TDD order corrections made: 3
  - T1 — was structural-only, added type-check step
  - T5 — validators moved to client/src/lib/settingsValidation.ts so the red phase is real
          (previously defined in the test file → no genuine failure, untested page logic)
  - T6 — utils moved to client/src/lib/title.ts for the same reason
Test framework used: Vitest
Coverage areas:
  - Tested: board name validation, file type/size validation, logo filename generation,
    API method signatures, context integration patterns, shared client validators,
    title/favicon utils
  - Intentionally not tested: full HTTP request/response cycle (no DB mocking infra),
    React component rendering (no testing-library setup), multer internals,
    Redis pub/sub behavior
```

---

## Execution Overview

### Recommended Order
```
T1 → T2, T4 (parallel) → T3 → T5, T6 (parallel)
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T2, T4 | T1 completes |
| Group B | T5, T6 | T2+T3+T4 (T5), T4 (T6) |

### Constraints Reminder
**Architecture:** No changes to core/ modules (position, wip, metrics). Optimistic locking via a **single global settings version** = `MAX(version)` across all setting rows (PATCH validates the incoming version against this global value; on write, touched rows are bumped to `global + 1`). This matches the aggregate version already returned by `generateDefaultSettings` and the single `settingsVersion` held client-side — a per-row version check against an aggregate value would 409 falsely. `requireAuth` on all settings routes. Toast feedback via `BoardContext.showToast()`. Settings changes fan out over the existing SSE channel (`settings.updated` event) so other clients call `refreshSettings()`. File paths (uploads dir, multer destination) must resolve to an absolute path anchored at the repo root — never a `process.cwd()`-relative string.
**Out-of-scope:** Per-user settings, AI toggle, workspace/role system, Delete Board, tabbed layout, external storage (S3/Cloudinary), audit trail.
**Assumptions at risk:** None — all open questions resolved.
**Sequencing:** T2 and T4 are parallel (both depend only on T1). T3 depends on T2 (modifies settings.ts created by T2). T5 needs T2+T3+T4 complete (full server + client integration). T6 only needs T4 (sidebar reads from context).

### File Structure Map

```
Rule: Settings DB Schema
  Modify: server/src/db/schema.sql  (append settings DDL — schema.sql is the only thing migrate.ts runs)
  Modify: client/src/types.ts
  Test:   client/src/types.test.ts (type contract)

Rule: Settings API
  Create: server/src/routes/settings.ts
  Modify: server/src/routes.ts
  Modify: server/src/realtime.ts (add "settings.updated" to BoardEvent union)
  Test:   server/src/routes/settings.test.ts

Rule: Logo Upload
  Create: (within server/src/routes/settings.ts)
  Modify: server/src/index.ts (express.static for /uploads in production)
  Modify: server/package.json (add multer)
  Test:   server/src/routes/settings.test.ts

Rule: Client Settings Integration
  Modify: client/src/types.ts
  Modify: client/src/api.ts
  Modify: client/src/context/BoardContext.tsx

Rule: Settings Page
  Create: client/src/pages/SettingsPage.tsx
  Create: client/src/components/LogoCropper.tsx
  Create: client/src/lib/settingsValidation.ts (shared validation utils — imported by page AND test)
  Modify: client/src/App.tsx
  Test:   client/src/lib/settingsValidation.test.ts

Rule: Dynamic Sidebar
  Modify: client/src/layout/Sidebar.tsx
  Modify: client/src/layout/AppLayout.tsx
  Create: client/src/lib/title.ts (formatTitle/getFaviconLink utils — imported by layout AND test)
  Test:   client/src/lib/title.test.ts
```

---

## Pocket Packets

---

### Task 1: Settings DB Schema + Shared Types [prereq]

## OBJECTIVE
Create the `settings` table in PostgreSQL and define shared TypeScript types for settings data. This is the foundation all other tasks depend on.

Files:
- Modify: `server/src/db/schema.sql` (append settings table DDL)
- Modify: `client/src/types.ts` (add Settings interface)

> **Migration mechanism:** `server/src/db/migrate.ts` reads and applies **only** `schema.sql` — there is no runner that scans a `migrations/` directory. Do **not** create a standalone `migrations/add-settings-table.sql`; it would be dead code and duplicate the DDL. Appending idempotent DDL to `schema.sql` (the established pattern) is the migration.

Steps:
1. Write failing test for: TypeScript types compile and match expected shape
   File: `client/src/types.test.ts`
   Test verifies: Given SettingsMap interface, When used in type-checked function, Then boardName and logoPath accessible

   ```typescript
   import { describe, expect, it } from "vitest";
   import type { SettingsMap } from "./types";

   function getBoardName(s: SettingsMap): string {
     return s.boardName;
   }

   function getLogoPath(s: SettingsMap): string {
     return s.logoPath;
   }

   function getVersion(s: SettingsMap): number {
     return s.version;
   }

   describe("SettingsMap interface", () => {
     it("allows access to boardName, logoPath, and version", () => {
       const settings: SettingsMap = { boardName: "Dev Team", logoPath: "/uploads/logo.png", version: 3 };
       expect(getBoardName(settings)).toBe("Dev Team");
       expect(getLogoPath(settings)).toBe("/uploads/logo.png");
       expect(getVersion(settings)).toBe(3);
     });

     it("works with default values", () => {
       const settings: SettingsMap = { boardName: "Camel", logoPath: "/logo.png", version: 0 };
       expect(settings.boardName).toBe("Camel");
       expect(settings.logoPath).toBe("/logo.png");
       expect(settings.version).toBe(0);
     });
   });
   ```

2. Run test — verify FAIL:
   `npx vitest run client/src/types.test.ts`
   Expected failure: Module not found — SettingsMap not exported from types.ts

3. Append the settings DDL to `server/src/db/schema.sql` (the single source of truth that `migrate.ts` applies — see the migration-mechanism note above):
   ```sql
   CREATE TABLE IF NOT EXISTS settings (
     key       TEXT PRIMARY KEY,
     text_value TEXT,
     bool_value BOOLEAN,
     version   INTEGER NOT NULL DEFAULT 1,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```
   File: `server/src/db/schema.sql`

4. Add TypeScript types to `client/src/types.ts`. `SettingsMap` carries the global settings `version` so the client can send it back on PATCH for optimistic locking:
   ```typescript
   export interface Setting {
     key: string;
     textValue: string | null;
     boolValue: boolean | null;
     version: number;
     updatedAt: string;
   }

   export interface SettingsMap {
     boardName: string;
     logoPath: string;
     version: number;
   }
   ```
   File: `client/src/types.ts`

5. Run test — verify PASS:
   `npx vitest run client/src/types.test.ts`
   Expected: PASS — SettingsMap interface accessible with boardName, logoPath, and version

6. Verify migration runs: `npm run db:migrate` (re-runnable; `IF NOT EXISTS` makes it idempotent)

7. Commit:
   `git add server/src/db/schema.sql client/src/types.ts client/src/types.test.ts`
   `git commit -m "chore(settings): add settings table schema and shared types"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md — rule: Settings DB Schema
server/src/db/schema.sql — existing schema patterns (columns, cards, users, sessions tables)
client/src/types.ts — existing type patterns (Card, Column, User interfaces)

## WHY THIS APPROACH
Complexity: lightweight
Justification: Schema DDL is structural, no behavioral logic. Types are shared contract for server+client. Type test verifies interface contract.

## SANDWICH CONTEXT
[CRITICAL: settings table must use typed columns (text_value, bool_value) — no JSONB]
You are implementing Settings DB Schema for Settings Infrastructure.
Spec: docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md
Design decision: Option A — Single Settings Table with typed columns
Files in scope: server/src/db/schema.sql, client/src/types.ts, client/src/types.test.ts
Available after: none (prereq)
Architecture rule: No changes to core/ modules. Typed columns for type safety.
[RESTATE: settings table must use typed columns (text_value, bool_value) — no JSONB]

## DELIVERABLE
Verification — task is DONE when all pass:

Given settings DDL appended to schema.sql, When `npm run db:migrate` runs, Then `settings` table is created with columns: key (TEXT PK), text_value (TEXT), bool_value (BOOLEAN), version (INTEGER DEFAULT 1), updated_at (TIMESTAMPTZ)
Given migrate.ts only reads schema.sql, When verifying, Then no standalone migrations/ file is created (DDL lives only in schema.sql)
Given types.ts updated, When TypeScript compiles, Then Setting and SettingsMap interfaces are exported
Given SettingsMap type, When used in test, Then boardName, logoPath, and version accessible

All tests PASS. Commit exists with message matching `chore(settings): add settings table schema and shared types`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - settings table with typed columns (text_value, bool_value)
  - version field for optimistic locking
  - TypeScript interfaces exported from types.ts
  - Migration is idempotent (IF NOT EXISTS)
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - JSONB columns (violates design decision)
  - scope column (per-user settings is out-of-scope)
  - Changes to existing tables
  - A standalone `migrations/add-settings-table.sql` file (migrate.ts never runs it — DDL belongs in schema.sql)

Open question risks:
  — None

Rollback note:
  - `DROP TABLE IF EXISTS settings;` — no data loss (settings is additive)

## STOP CONDITIONS
Done when: migration runs successfully, schema.sql updated, types.ts compiles, tests pass
Uncertain when: never (straightforward structural task)
Escalate when: migration fails or conflicts with existing schema

---

### Task 2: Settings Server API + Validation [depends: T1]

## OBJECTIVE
Implement REST API endpoints for settings CRUD: GET all settings (with defaults), PATCH bulk update with per-setting optimistic locking, DELETE (reset settings), and reset app. All routes require authentication.

Files:
- Create: `server/src/routes/settings.ts`
- Modify: `server/src/routes.ts` (mount settings router)
- Modify: `server/src/realtime.ts` (add `"settings.updated"` to the `BoardEvent` `type` union)
- Modify: `server/package.json` (add multer dependency — for logo upload in T3, but install here)
- Test: `server/src/routes/settings.test.ts`

> **Optimistic locking — single global version.** `generateDefaultSettings` returns one aggregate `version = MAX(version)` across rows, and the client holds one `settingsVersion`. PATCH therefore validates the incoming version against this **global** value (not per-row): if `incomingVersion !== currentGlobalMax` → 409 `code: "version_conflict"`. On a successful write, every touched row is set to `currentGlobalMax + 1` so the next GET's aggregate advances. A naive per-row `version = $sent` check against an aggregate value would 409 falsely (e.g. board_name row=2, logo_path row=5, global=5 → editing board_name with version 5 must NOT conflict).
>
> **First-write upsert.** A setting key may have no row yet (GET returned default with global version 0). The PATCH upsert must `INSERT ... ON CONFLICT (key) DO UPDATE` and, on the no-row path, accept incoming version 0 and insert with `version = 1`.
>
> **Active-user check uses the real signature.** `onlineUsers(self: AuthUser)` always includes `self` in its result. "Others online" = `(await onlineUsers(req.user!)).filter(u => u.id !== req.user!.id).length > 0`. When Redis is down it returns only `[self]`, so reset is allowed.

**Important:** Since there is no DB mocking infrastructure, tests focus on pure validation functions extracted from the route handlers. The validation logic is implemented as testable pure functions in `settings.ts`, then used by route handlers.

Steps:
1. Write failing test for: board name validation rejects empty input
   File: `server/src/routes/settings.test.ts`
   Test verifies: Given empty string, When validateBoardName called, Then returns error "Name is required"

   ```typescript
   import { describe, expect, it } from "vitest";
   import {
     validateBoardName,
     validateSettingKey,
     generateDefaultSettings,
     DEFAULT_SETTINGS,
   } from "./settings.js";

   describe("validateBoardName", () => {
     it("rejects empty string", () => {
       const result = validateBoardName("");
       expect(result).toEqual({ valid: false, error: "Name is required" });
     });

     it("rejects whitespace-only string", () => {
       const result = validateBoardName("   ");
       expect(result).toEqual({ valid: false, error: "Name is required" });
     });

     it("rejects names exceeding 15 characters", () => {
       const result = validateBoardName("Super Long Board Name");
       expect(result).toEqual({ valid: false, error: "Max 15 characters" });
     });

     it("accepts valid name and trims whitespace", () => {
       const result = validateBoardName("  Dev Team  ");
       expect(result).toEqual({ valid: true, trimmed: "Dev Team" });
     });

     it("accepts single character name", () => {
       const result = validateBoardName("A");
       expect(result).toEqual({ valid: true, trimmed: "A" });
     });

     it("accepts exactly 15 character name", () => {
       const name = "A".repeat(15);
       const result = validateBoardName(name);
       expect(result).toEqual({ valid: true, trimmed: name });
     });
   });

   describe("validateSettingKey", () => {
     it("accepts known setting keys", () => {
       expect(validateSettingKey("board_name")).toBe(true);
       expect(validateSettingKey("logo_path")).toBe(true);
     });

     it("rejects unknown setting keys", () => {
       expect(validateSettingKey("unknown_key")).toBe(false);
       expect(validateSettingKey("")).toBe(false);
     });
   });

   describe("DEFAULT_SETTINGS", () => {
     it("has correct default values", () => {
       expect(DEFAULT_SETTINGS.boardName).toBe("Camel");
       expect(DEFAULT_SETTINGS.logoPath).toBe("/logo.png");
     });
   });

   describe("generateDefaultSettings", () => {
     it("returns defaults when no rows provided", () => {
       const settings = generateDefaultSettings([]);
       expect(settings).toEqual({ boardName: "Camel", logoPath: "/logo.png", version: 0 });
     });

     it("merges board_name from rows", () => {
       const rows = [{ key: "board_name", textValue: "Dev Team", boolValue: null, version: 2, updatedAt: "2026-06-13" }];
       const settings = generateDefaultSettings(rows);
       expect(settings.boardName).toBe("Dev Team");
       expect(settings.logoPath).toBe("/logo.png");
     });

     it("merges both settings from rows", () => {
       const rows = [
         { key: "board_name", textValue: "Dev Team", boolValue: null, version: 2, updatedAt: "2026-06-13" },
         { key: "logo_path", textValue: "/uploads/custom.png", boolValue: null, version: 3, updatedAt: "2026-06-13" },
       ];
       const settings = generateDefaultSettings(rows);
       expect(settings.boardName).toBe("Dev Team");
       expect(settings.logoPath).toBe("/uploads/custom.png");
     });

     it("uses max version across all rows", () => {
       const rows = [
         { key: "board_name", textValue: "A", boolValue: null, version: 5, updatedAt: "2026-06-13" },
         { key: "logo_path", textValue: "/b.png", boolValue: null, version: 3, updatedAt: "2026-06-13" },
       ];
       const settings = generateDefaultSettings(rows);
       expect(settings.version).toBe(5);
     });
   });
   ```

2. Run test — verify FAIL:
   `npx vitest run src/routes/settings.test.ts`
   Expected failure: module not found (settings.ts doesn't exist)

3. Implement pure validation functions in settings.ts:
   ```typescript
   export const VALID_SETTING_KEYS = new Set(["board_name", "logo_path"]);

   export const DEFAULT_SETTINGS = {
     boardName: "Camel",
     logoPath: "/logo.png",
   } as const;

   export function validateBoardName(name: string): { valid: false; error: string } | { valid: true; trimmed: string } {
     const trimmed = name.trim();
     if (trimmed === "") return { valid: false, error: "Name is required" };
     if (trimmed.length > 15) return { valid: false, error: "Max 15 characters" };
     return { valid: true, trimmed };
   }

   export function validateSettingKey(key: string): boolean {
     return VALID_SETTING_KEYS.has(key);
   }

   export interface SettingRow {
     key: string;
     textValue: string | null;
     boolValue: boolean | null;
     version: number;
     updatedAt: string;
   }

   export interface SettingsResponse {
     boardName: string;
     logoPath: string;
     version: number;
   }

   export function generateDefaultSettings(rows: SettingRow[]): SettingsResponse {
     const map = new Map(rows.map(r => [r.key, r]));
     const boardName = map.get("board_name")?.textValue ?? DEFAULT_SETTINGS.boardName;
     const logoPath = map.get("logo_path")?.textValue ?? DEFAULT_SETTINGS.logoPath;
     const version = rows.reduce((max, r) => Math.max(max, r.version), 0);
     return { boardName, logoPath, version };
   }
   ```
   File: `server/src/routes/settings.ts`

4. Run test — verify PASS:
   `npx vitest run src/routes/settings.test.ts`
   Expected: PASS — all validation functions work correctly

5. Write failing test for: PATCH validation rejects invalid key
   ```typescript
   describe("PATCH validation", () => {
     it("rejects setting with unknown key", () => {
       // Verify validateSettingKey rejects unknown keys
       expect(validateSettingKey("unknown_key")).toBe(false);
     });

     it("rejects board_name with empty value", () => {
       const result = validateBoardName("");
       expect(result.valid).toBe(false);
     });

     it("accepts valid board_name update", () => {
       const result = validateBoardName("Dev Team");
       expect(result.valid).toBe(true);
       if (result.valid) expect(result.trimmed).toBe("Dev Team");
     });
   });
   ```

6. Implement route handlers with Express Router:
   - GET /settings: query all rows, merge with defaults via `generateDefaultSettings`
   - PATCH /settings: validate each setting (key + board name), check incoming version against the **global** `MAX(version)`, 409 on mismatch, then upsert each touched row with `version = global + 1` (`INSERT ... ON CONFLICT (key) DO UPDATE`, first-write inserts version 1). On success call `publishEvent({ type: "settings.updated", actor: req.user! })`.
   - DELETE /settings: delete all rows (reverts to defaults on next GET). Call `publishEvent({ type: "settings.updated", actor: req.user! })`.
   - POST /settings/reset-app: block if other users online (`onlineUsers(req.user!)` filtered to exclude self), else hard-delete. Deleting `columns` cascades to `cards` (FK `ON DELETE CASCADE`) which cascades to `card_events` — so a single `DELETE FROM columns` clears the board and activity feed; then `DELETE FROM settings`. Wrap in a transaction. `publishEvent` afterward so other clients refresh.
   File: `server/src/routes/settings.ts`

7. Mount settings router in routes.ts and extend the realtime event union:
   ```typescript
   // routes.ts
   import { settingsRouter } from "./routes/settings.js";
   api.use("/settings", settingsRouter);
   ```
   ```typescript
   // realtime.ts — add to the BoardEvent type union
   type: "card.created" | "card.updated" | "card.moved" | "card.deleted"
     | "column.updated" | "presence.changed" | "settings.updated";
   ```
   Files: `server/src/routes.ts`, `server/src/realtime.ts`

8. Install multer: `npm install multer @types/multer --workspace=server`

9. Run all tests — verify PASS:
   `npx vitest run src/routes/settings.test.ts`

10. Commit:
    `git add server/src/routes/settings.ts server/src/routes.ts server/src/routes/settings.test.ts server/package.json server/package-lock.json`
    `git commit -m "feat(settings): add settings API with validation and optimistic locking"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md — rules: Board Name Customization, Reset Settings, Reset App
server/src/routes.ts — existing route patterns (requireAuth, recordActivity, publishEvent)
server/src/realtime.ts — `onlineUsers(self)` (always includes self — filter it out for the "others online" check) and `publishEvent`/`BoardEvent` union
server/src/auth.ts — requireAuth middleware pattern

## WHY THIS APPROACH
Complexity: standard
Justification: Multi-endpoint with validation, optimistic locking, and active user check. Requires judgment on upsert pattern and error handling. Pure function extraction enables testing without DB mocking.

## SANDWICH CONTEXT
[CRITICAL: No changes to core/ modules (position, wip, metrics)]
You are implementing Settings Server API for Settings Infrastructure.
Spec: docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md
Design decision: Option A — Single Settings Table, per-setting version, bulk PATCH
Files in scope: server/src/routes/settings.ts, server/src/routes.ts, server/src/routes/settings.test.ts
Available after: T1 (settings table + types exist)
Architecture rule: requireAuth on all routes. Optimistic locking via version field. Toast feedback delegated to client.
[RESTATE: No changes to core/ modules (position, wip, metrics)]

## DELIVERABLE
Verification — task is DONE when all pass:

Given empty settings, When GET /settings, Then returns `{ boardName: "Camel", logoPath: "/logo.png", version: 0 }`
Given no row for board_name (global version 0), When PATCH with version 0, Then row inserted with version 1 (first-write upsert)
Given board_name update with "Dev Team", When PATCH /settings, Then saved, returns updated settings with bumped global version
Given board_name update with "", When PATCH /settings, Then 400 "Name is required"
Given board_name update with 16+ chars, When PATCH /settings, Then 400 "Max 15 characters"
Given board_name update with "  Dev Team  ", When PATCH /settings, Then trimmed to "Dev Team"
Given board_name row=2 and logo_path row=5 (global=5), When PATCH board_name with version 5, Then succeeds (no false 409)
Given PATCH with version less than the current global max, When processed, Then 409 conflict `code: "version_conflict"`
Given customized settings, When DELETE /settings, Then table empty, defaults on next GET, `settings.updated` published
Given another user online (besides self), When POST /settings/reset-app, Then 409 "Cannot reset while other users are online"
Given only self online, When POST /settings/reset-app, Then columns+cards+card_events (cascade) + settings deleted, users remain

Given validateBoardName(""), When called, Then returns `{ valid: false, error: "Name is required" }`
Given validateBoardName("Super Long Name Here"), When called, Then returns `{ valid: false, error: "Max 15 characters" }`
Given validateBoardName("  Dev Team  "), When called, Then returns `{ valid: true, trimmed: "Dev Team" }`
Given validateSettingKey("board_name"), When called, Then returns true
Given validateSettingKey("unknown"), When called, Then returns false
Given empty rows, When generateDefaultSettings called, Then returns defaults with version 0

All tests PASS. Commit exists with message matching `feat(settings): add settings API with validation and optimistic locking`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Board name validation: 1-15 chars, trim, reject empty
  - Optimistic locking on PATCH against the single global version (409 on conflict), touched rows bumped to global+1
  - First-write upsert (ON CONFLICT) handling a key with no existing row
  - Reset App active-user check that excludes self
  - Reset App as a transaction; relies on FK cascade (columns→cards→card_events)
  - `settings.updated` published on PATCH/DELETE/reset so other clients refresh
  - requireAuth on all endpoints
  - Pure validation functions extracted and tested independently
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Changes to core/ modules
  - Per-user settings (no scope column)
  - Audit trail for settings changes
  - Modifications to files outside listed scope

Open question risks:
  — None

Rollback note:
  - Revert routes.ts mount + delete settings.ts — no existing behavior changed

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never
Escalate when: task touches core/ files or adds out-of-scope features

---

### Task 3: Logo Upload + Cleanup Endpoints [depends: T2]

## OBJECTIVE
Implement server-side logo upload endpoint using multer: accept .png/.jpg files <=10MB, save to `client/public/uploads/`, delete old logo on new upload, return saved path.

Files:
- Modify: `server/src/routes/settings.ts` (add logo upload endpoint — created by T2)
- Modify: `server/src/index.ts` (serve `/uploads` statically in production builds)
- Test: `server/src/routes/settings.test.ts` (append logo tests)

> **Path resolution (critical).** The uploads directory must be an **absolute path anchored at the repo root**, not the `process.cwd()`-relative string `"client/public/uploads"` — workspace scripts run with cwd = `server/`, so a relative path would write to `server/client/public/uploads`. Derive it once, e.g. `const UPLOADS_DIR = fileURLToPath(new URL("../../../client/public/uploads", import.meta.url))` (adjust depth to settings.ts location), and use it for both `mkdirSync` and multer's `diskStorage.destination`.
>
> **Serving uploads.** In dev, Vite serves `client/public` at :5173 so `/uploads/x.png` resolves. In a production build there is no Vite — add `app.use("/uploads", express.static(UPLOADS_DIR))` (or equivalent) in `server/src/index.ts` so saved logos are reachable. The stored `logo_path` stays root-relative (`/uploads/<file>`).

Steps:
1. Write failing test for: file type validation rejects non-image
   File: `server/src/routes/settings.test.ts`
   Test verifies: Given .pdf file, When validateLogoFile called, Then error "Only .png and .jpg files are accepted"

   ```typescript
   import {
     validateLogoFile,
     validateFileSize,
     generateLogoFilename,
     MAX_LOGO_SIZE_BYTES,
   } from "./settings.js";

   describe("validateLogoFile", () => {
     it("accepts image/png", () => {
       expect(validateLogoFile("image/png")).toEqual({ valid: true });
     });

     it("accepts image/jpeg", () => {
       expect(validateLogoFile("image/jpeg")).toEqual({ valid: true });
     });

     it("rejects application/pdf", () => {
       expect(validateLogoFile("application/pdf")).toEqual({
         valid: false,
         error: "Only .png and .jpg files are accepted",
       });
     });

     it("rejects image/gif", () => {
       expect(validateLogoFile("image/gif")).toEqual({
         valid: false,
         error: "Only .png and .jpg files are accepted",
       });
     });

     it("rejects empty mimetype", () => {
       expect(validateLogoFile("")).toEqual({
         valid: false,
         error: "Only .png and .jpg files are accepted",
       });
     });
   });

   describe("validateFileSize", () => {
     it("accepts file under 10MB", () => {
       expect(validateFileSize(2 * 1024 * 1024)).toEqual({ valid: true });
     });

     it("accepts file exactly at 10MB", () => {
       expect(validateFileSize(10 * 1024 * 1024)).toEqual({ valid: true });
     });

     it("rejects file over 10MB", () => {
       expect(validateFileSize(15 * 1024 * 1024)).toEqual({
         valid: false,
         error: "File size must be under 10MB",
       });
     });

     it("rejects file at 10MB + 1 byte", () => {
       expect(validateFileSize(10 * 1024 * 1024 + 1)).toEqual({
         valid: false,
         error: "File size must be under 10MB",
       });
     });
   });

   describe("generateLogoFilename", () => {
     it("generates filename with logo prefix and timestamp", () => {
       const filename = generateLogoFilename("image/png");
       expect(filename).toMatch(/^logo-\d+-\w+\.png$/);
     });

     it("uses jpg extension for jpeg", () => {
       const filename = generateLogoFilename("image/jpeg");
       expect(filename).toMatch(/\.jpg$/);
     });

     it("generates unique filenames on consecutive calls", () => {
       const a = generateLogoFilename("image/png");
       const b = generateLogoFilename("image/png");
       // Both should match pattern, but may be same if called in same ms
       expect(a).toMatch(/^logo-/);
       expect(b).toMatch(/^logo-/);
     });
   });

   describe("MAX_LOGO_SIZE_BYTES", () => {
     it("is 10MB", () => {
       expect(MAX_LOGO_SIZE_BYTES).toBe(10 * 1024 * 1024);
     });
   });
   ```

2. Run test — verify FAIL:
   `npx vitest run src/routes/settings.test.ts`
   Expected failure: module not found (validateLogoFile not exported from settings.ts)

3. Implement pure validation functions in settings.ts:
   ```typescript
   export const MAX_LOGO_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
   const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

   export function validateLogoFile(mimetype: string): { valid: boolean; error?: string } {
     if (!ALLOWED_MIME_TYPES.has(mimetype)) {
       return { valid: false, error: "Only .png and .jpg files are accepted" };
     }
     return { valid: true };
   }

   export function validateFileSize(size: number): { valid: boolean; error?: string } {
     if (size > MAX_LOGO_SIZE_BYTES) {
       return { valid: false, error: "File size must be under 10MB" };
     }
     return { valid: true };
   }

   export function generateLogoFilename(mimetype: string): string {
     const ext = mimetype === "image/jpeg" ? "jpg" : "png";
     const timestamp = Date.now();
     const random = Math.random().toString(36).substring(2, 8);
     return `logo-${timestamp}-${random}.${ext}`;
   }
   ```
   File: `server/src/routes/settings.ts`

4. Run test — verify PASS:
   `npx vitest run src/routes/settings.test.ts`
   Expected: PASS — all validation functions work correctly

5. Implement POST /settings/logo endpoint with multer:
   - Configure multer with diskStorage:
     - destination: the absolute `UPLOADS_DIR` (see path-resolution note — NOT a relative string)
     - filename: use `generateLogoFilename()`
   - File filter: use `validateLogoFile()` (rejects non-png/jpg)
   - Size limit: set `limits.fileSize = MAX_LOGO_SIZE_BYTES`. multer rejects oversize files with a `LIMIT_FILE_SIZE` error before the handler runs — map it to `413 "File size must be under 10MB"`. (`validateFileSize` is the pure, independently-tested mirror of this rule; use it as the single source for the limit constant and message, and as a guard if reading size off a buffered upload.)
   - On upload: query current logo_path setting, delete old file if it exists and is under `UPLOADS_DIR`
   - Save new path (`/uploads/<file>`) as `logo_path` setting, then `publishEvent({ type: "settings.updated", actor: req.user! })`
   - Return updated settings
   File: `server/src/routes/settings.ts`

6. Ensure the uploads directory exists (absolute path — see note):
   ```typescript
   import { mkdirSync } from "node:fs";
   import { fileURLToPath } from "node:url";
   const UPLOADS_DIR = fileURLToPath(new URL("../../../client/public/uploads", import.meta.url));
   mkdirSync(UPLOADS_DIR, { recursive: true });
   ```

7. Add production static serving in `server/src/index.ts` so uploaded logos resolve without Vite:
   ```typescript
   app.use("/uploads", express.static(UPLOADS_DIR));
   ```
   File: `server/src/index.ts`

8. Run all tests — verify PASS:
   `npx vitest run src/routes/settings.test.ts`

9. Commit:
   `git add server/src/routes/settings.ts server/src/index.ts server/src/routes/settings.test.ts`
   `git commit -m "feat(settings): add logo upload with file validation and cleanup"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md — rule: Logo Customization
expressjs/multer docs — diskStorage, fileFilter, limits configuration
server/src/routes.ts — existing route patterns

## WHY THIS APPROACH
Complexity: standard
Justification: File upload requires multer configuration, file validation, cleanup logic, and error handling. Client-side cropping means server receives already-cropped image. Pure function extraction enables testing without multer/Express mocking.

## SANDWICH CONTEXT
[CRITICAL: Logo files must be stored in client/public/uploads/ — not server directory]
You are implementing Logo Upload for Settings Infrastructure.
Spec: docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md
Design decision: Option A — multer for Express, local filesystem storage
Files in scope: server/src/routes/settings.ts, server/src/index.ts, server/src/routes/settings.test.ts
Available after: T2 (settings table + settings.ts file exist)
Architecture rule: requireAuth. File filter for .png/.jpg only. 10MB max. Absolute UPLOADS_DIR. express.static for /uploads in production.
[RESTATE: Logo files must be stored in client/public/uploads/ — not server directory]

## DELIVERABLE
Verification — task is DONE when all pass:

Given valid .png file (2MB), When POST /settings/logo, Then file saved to the absolute repo-root `client/public/uploads/` (NOT `server/client/...`), `/uploads/<file>` path returned
Given .pdf file, When POST /settings/logo, Then 400 "Only .png and .jpg files are accepted"
Given 15MB file, When POST /settings/logo, Then multer LIMIT_FILE_SIZE mapped to 413 "File size must be under 10MB"
Given existing logo, When new logo uploaded, Then old file deleted from filesystem
Given a production build (no Vite), When GET /uploads/<file>, Then express.static serves it
Given network error during upload, Then multer error handled, no orphaned temp file

Given validateLogoFile("image/png"), When called, Then returns `{ valid: true }`
Given validateLogoFile("application/pdf"), When called, Then returns error
Given validateFileSize(2MB), When called, Then returns `{ valid: true }`
Given validateFileSize(15MB), When called, Then returns error
Given generateLogoFilename("image/png"), When called, Then returns `logo-{timestamp}-{random}.png`

All tests PASS. Commit exists with message matching `feat(settings): add logo upload with file validation and cleanup`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - File type validation (.png/.jpg only)
  - File size limit (10MB) — multer LIMIT_FILE_SIZE mapped to 413
  - Absolute UPLOADS_DIR anchored at repo root (no cwd-relative path)
  - express.static("/uploads") for production serving
  - Old logo cleanup on new upload
  - requireAuth on endpoint
  - Pure validation functions extracted and tested independently
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - External storage (S3/Cloudinary) — out-of-scope
  - Server-side image processing (client crops before upload)
  - Modifications to files outside listed scope

Open question risks:
  — None

Rollback note:
  - Remove logo endpoint from settings.ts — no existing behavior changed

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never
Escalate when: multer API changes or file system permissions issue

---

### Task 4: Client Settings Integration (Context + API) [depends: T1]

## OBJECTIVE
Extend BoardContext to include settings state and add settings API methods to the client api.ts. Settings load on app init and update reactively.

Files:
- Modify: `client/src/api.ts` (add settings API methods)
- Modify: `client/src/context/BoardContext.tsx` (add settings state + refresh)

Steps:
1. Write failing test for: API method signatures match expected types
   File: `client/src/api.test.ts`
   Test verifies: Given api module, When importing settings methods, Then methods exist with correct signatures

   ```typescript
   import { describe, expect, it, vi } from "vitest";

   // Mock fetch globally for API tests
   const mockFetch = vi.fn();
   vi.stubGlobal("fetch", mockFetch);

   describe("Settings API methods", () => {
     it("getSettings returns SettingsMap", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ boardName: "Dev Team", logoPath: "/uploads/logo.png", version: 1 }),
       });

       const { api } = await import("./api");
       const result = await api.getSettings();
       expect(result).toEqual({ boardName: "Dev Team", logoPath: "/uploads/logo.png", version: 1 });
     });

     it("updateSettings sends PATCH with body", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ boardName: "New Name", logoPath: "/logo.png", version: 2 }),
       });

       const { api } = await import("./api");
       await api.updateSettings([{ key: "board_name", textValue: "New Name", version: 1 }]);

       expect(mockFetch).toHaveBeenCalledWith(
         "/api/settings",
         expect.objectContaining({
           method: "PATCH",
           headers: { "Content-Type": "application/json" },
         })
       );
     });

     it("resetSettings sends DELETE", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 204,
         json: () => Promise.resolve(undefined),
       });

       const { api } = await import("./api");
       await api.resetSettings();

       expect(mockFetch).toHaveBeenCalledWith(
         "/api/settings",
         expect.objectContaining({ method: "DELETE" })
       );
     });

     it("resetApp sends POST", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 204,
         json: () => Promise.resolve(undefined),
       });

       const { api } = await import("./api");
       await api.resetApp();

       expect(mockFetch).toHaveBeenCalledWith(
         "/api/settings/reset-app",
         expect.objectContaining({ method: "POST" })
       );
     });

     it("uploadLogo sends FormData via POST", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ boardName: "Camel", logoPath: "/uploads/new.png", version: 2 }),
       });

       const { api } = await import("./api");
       const file = new File(["test"], "logo.png", { type: "image/png" });
       const result = await api.uploadLogo(file);

       expect(mockFetch).toHaveBeenCalledWith(
         "/api/settings/logo",
         expect.objectContaining({ method: "POST" })
       );
       expect(result.logoPath).toBe("/uploads/new.png");
     });
   });
   ```

2. Run test — verify FAIL:
   `npx vitest run client/src/api.test.ts`
   Expected failure: api.getSettings is not a function

3. Implement API methods in api.ts:
   ```typescript
   // Settings
   getSettings: () => request<SettingsMap>("/settings"),
   updateSettings: (settings: Array<{ key: string; textValue?: string; boolValue?: boolean; version: number }>) =>
     request<SettingsMap>("/settings", { method: "PATCH", body: JSON.stringify(settings) }),
   resetSettings: () => request<void>("/settings", { method: "DELETE" }),
   resetApp: () => request<void>("/settings/reset-app", { method: "POST" }),
   uploadLogo: async (file: File): Promise<SettingsMap> => {
     const formData = new FormData();
     formData.append("logo", file);
     const res = await fetch("/api/settings/logo", { method: "POST", body: formData });
     if (!res.ok) {
       let message = `Upload failed (${res.status})`;
       try {
         const body = await res.json();
         if (body.error) message = body.error;
       } catch {
         // non-JSON error body
       }
       throw new ApiError(message, res.status);
     }
     return res.json();
   },
   ```
   File: `client/src/api.ts`

4. Run test — verify PASS:
   `npx vitest run client/src/api.test.ts`
   Expected: PASS

5. Extend BoardContext with settings state:
   ```typescript
   // Add to BoardContextValue interface:
   settings: SettingsMap;
   settingsVersion: number;
   refreshSettings: () => Promise<void>;
   
   // Add to BoardProvider:
   const [settings, setSettings] = useState<SettingsMap>({ boardName: "Camel", logoPath: "/logo.png", version: 0 });
   const [settingsVersion, setSettingsVersion] = useState(0);
   
   const refreshSettings = useCallback(async () => {
     const s = await api.getSettings();
     setSettings(s);
     setSettingsVersion(s.version);
   }, []);
   ```
   Callers PATCH with this single `settingsVersion` (global optimistic-locking version — see T2). 
   File: `client/src/context/BoardContext.tsx`

6. Load settings on mount AND keep them live over SSE (in the existing refresh useEffect). The board stream already pushes events; parse them and refresh settings when a `settings.updated` event arrives, so another client's change updates the sidebar/title without a reload:
   ```typescript
   void refreshSettings();
   // ...
   stream.onmessage = (e) => {
     void refresh();
     try {
       if (JSON.parse(e.data).type === "settings.updated") void refreshSettings();
     } catch {
       // non-JSON keep-alive comment
     }
   };
   ```

7. Expose settings, settingsVersion, and refreshSettings in context provider value.

8. Run tests — verify PASS:
   `npx vitest run client/src/api.test.ts`

9. Commit:
   `git add client/src/api.ts client/src/api.test.ts client/src/context/BoardContext.tsx`
   `git commit -m "feat(settings): add client settings API and context integration"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md — rule: Client Settings Integration
client/src/api.ts — existing API pattern (request helper, ApiError)
client/src/context/BoardContext.tsx — existing context pattern (useState, useCallback, useEffect)
client/src/types.ts — SettingsMap interface (from T1)

## WHY THIS APPROACH
Complexity: lightweight
Justification: Extending existing patterns — API methods follow request<T>() helper, context follows useState+useCallback pattern. Tests verify method signatures and fetch behavior.

## SANDWICH CONTEXT
[CRITICAL: Settings state must live in BoardContext — not a separate SettingsContext]
You are implementing Client Settings Integration for Settings Infrastructure.
Spec: docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md
Design decision: Option A — BoardContext integration (not dedicated SettingsContext)
Files in scope: client/src/api.ts, client/src/api.test.ts, client/src/context/BoardContext.tsx
Available after: T1 (SettingsMap type exists)
Architecture rule: Settings in BoardContext. Toast via showToast().
[RESTATE: Settings state must live in BoardContext — not a separate SettingsContext]

## DELIVERABLE
Verification — task is DONE when all pass:

Given API returns settings, When app loads, Then settings state (incl. version) populated in BoardContext
Given settings updated, When refreshSettings called, Then context state reflects new values
Given another client emits `settings.updated` over SSE, When the event is received, Then refreshSettings runs and settings state updates live
Given uploadLogo called, When file sent, Then returns updated SettingsMap
Given api.getSettings(), When called, Then fetches /api/settings
Given api.updateSettings(), When called, Then sends PATCH with body
Given api.resetSettings(), When called, Then sends DELETE
Given api.resetApp(), When called, Then sends POST to /settings/reset-app
Given api.uploadLogo(), When called, Then sends FormData via POST

All tests PASS. Commit exists with message matching `feat(settings): add client settings API and context integration`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Settings state in BoardContext (not separate context), including the global version
  - All API methods: getSettings, updateSettings, resetSettings, resetApp, uploadLogo
  - Settings load on app mount
  - SSE `settings.updated` triggers refreshSettings (live cross-client sync)
  - Tests verify API method behavior via mocked fetch
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Dedicated SettingsContext (out-of-scope per design decision)
  - Modifications to files outside listed scope

Open question risks:
  — None

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never
Escalate when: context refactor breaks existing board functionality

---

### Task 5: Settings Page + Logo Cropper + Danger Zone [depends: T2, T3, T4]

## OBJECTIVE
Build the /settings page with collapsible sections (Identity, Danger Zone), board name input with live preview, logo upload with client-side cropping via react-easy-crop, and destructive actions (Reset Settings, Reset App) with appropriate safeguards.

Files:
- Create: `client/src/lib/settingsValidation.ts` (shared client-side validators — imported by SettingsPage AND its test)
- Create: `client/src/pages/SettingsPage.tsx`
- Create: `client/src/components/LogoCropper.tsx`
- Modify: `client/src/App.tsx` (add /settings route)
- Modify: `client/package.json` (add react-easy-crop)
- Test: `client/src/lib/settingsValidation.test.ts`

> **No duplicated logic / real red phase.** The previous draft defined the validators *inside* the test file and then claimed a red→green cycle — but a function defined in its own test can never fail to import, so the "red" was fake and the actual page logic went untested. Extract the validators to `client/src/lib/settingsValidation.ts` and have both `SettingsPage.tsx` and the test import them. The test's red phase is then genuine (module-not-found until the file exists).

Steps:
1. Install react-easy-crop: `npm install react-easy-crop --workspace=client`

2. Write failing test for: board name validation rejects empty input. Import the validators from the real module (this is the genuine red phase — the module does not exist yet):
   File: `client/src/lib/settingsValidation.test.ts`
   Test verifies: Given empty input, When validateBoardName called, Then error "Name is required"

   ```typescript
   import { describe, expect, it } from "vitest";
   import {
     validateBoardName,
     validateResetAppConfirmation,
     validateUnsavedChanges,
   } from "./settingsValidation";

   describe("validateBoardName (client)", () => {
     it("rejects empty string", () => {
       expect(validateBoardName("")).toEqual({ valid: false, error: "Name is required" });
     });

     it("rejects whitespace-only string", () => {
       expect(validateBoardName("   ")).toEqual({ valid: false, error: "Name is required" });
     });

     it("rejects name over 15 characters", () => {
       expect(validateBoardName("Super Long Board Name")).toEqual({
         valid: false,
         error: "Max 15 characters",
       });
     });

     it("accepts valid name and trims whitespace", () => {
       expect(validateBoardName("  Dev Team  ")).toEqual({ valid: true, trimmed: "Dev Team" });
     });

     it("accepts single character", () => {
       expect(validateBoardName("A")).toEqual({ valid: true, trimmed: "A" });
     });

     it("accepts exactly 15 characters", () => {
       const name = "A".repeat(15);
       expect(validateBoardName(name)).toEqual({ valid: true, trimmed: name });
     });

     it("rejects 16 characters", () => {
       const name = "A".repeat(16);
       expect(validateBoardName(name)).toEqual({ valid: false, error: "Max 15 characters" });
     });
   });

   describe("validateResetAppConfirmation", () => {
     it("enables when DELETE typed and checkbox checked", () => {
       expect(validateResetAppConfirmation("DELETE", true)).toEqual({ enabled: true });
     });

     it("enables for lowercase delete", () => {
       expect(validateResetAppConfirmation("delete", true)).toEqual({ enabled: true });
     });

     it("enables for mixed case with spaces", () => {
       expect(validateResetAppConfirmation("  Delete  ", true)).toEqual({ enabled: true });
     });

     it("disables when DELETE typed but checkbox unchecked", () => {
       expect(validateResetAppConfirmation("DELETE", false)).toEqual({ enabled: false });
     });

     it("disables when checkbox checked but wrong text", () => {
       expect(validateResetAppConfirmation("WRONG", true)).toEqual({ enabled: false });
     });

     it("disables when both wrong", () => {
       expect(validateResetAppConfirmation("", false)).toEqual({ enabled: false });
     });
   });

   describe("validateUnsavedChanges", () => {
     it("detects changes", () => {
       expect(validateUnsavedChanges("Camel", "Dev Team")).toBe(true);
     });

     it("ignores whitespace-only changes", () => {
       expect(validateUnsavedChanges("Camel", "  Camel  ")).toBe(false);
     });

     it("detects actual content change", () => {
       expect(validateUnsavedChanges("Camel", "New Name")).toBe(true);
     });

     it("no change returns false", () => {
       expect(validateUnsavedChanges("Camel", "Camel")).toBe(false);
     });
   });
   ```

3. Run test — verify FAIL:
   `npx vitest run client/src/lib/settingsValidation.test.ts`
   Expected failure: module not found — `./settingsValidation` does not exist yet

4. Implement the validators in `client/src/lib/settingsValidation.ts`:
   ```typescript
   export function validateBoardName(name: string): { valid: false; error: string } | { valid: true; trimmed: string } {
     const trimmed = name.trim();
     if (trimmed === "") return { valid: false, error: "Name is required" };
     if (trimmed.length > 15) return { valid: false, error: "Max 15 characters" };
     return { valid: true, trimmed };
   }

   export function validateResetAppConfirmation(text: string, checkboxChecked: boolean): { enabled: boolean } {
     const trimmed = text.trim().toUpperCase();
     return { enabled: trimmed === "DELETE" && checkboxChecked };
   }

   export function validateUnsavedChanges(original: string, current: string): boolean {
     return original.trim() !== current.trim();
   }
   ```
   File: `client/src/lib/settingsValidation.ts`

5. Run test — verify PASS:
   `npx vitest run client/src/lib/settingsValidation.test.ts`
   Expected: PASS — all validation functions work correctly

6. Implement LogoCropper component:
   - Accept `image: string` (object URL) and `onCropComplete: (blob: Blob) => void`
   - Use react-easy-crop Cropper with `aspect={1}` (1:1)
   - Implement getCroppedImg utility using canvas
   - Show crop area, zoom slider, Confirm/Cancel buttons
   File: `client/src/components/LogoCropper.tsx`

7. Implement SettingsPage component (import validators from `../lib/settingsValidation` — do NOT redefine them):
   - Identity section: board name input + logo preview + upload button
   - Danger Zone section: Reset Settings button + Reset App button
   - Board name: input with validation, Save button, live preview; PATCH carries `settingsVersion` from context (global optimistic-lock version)
   - On 409 from save, show "Someone else updated settings first" toast and refreshSettings (mirrors the cards conflict flow)
   - Logo: file input (.png/.jpg), on select open LogoCropper, on confirm upload
   - Reset Settings: confirmation dialog -> call api.resetSettings() -> refreshSettings
   - Reset App: multi-step modal (type "DELETE" + checkbox, gated by validateResetAppConfirmation) -> call api.resetApp()
   - Unsaved changes warning via beforeunload (gated by validateUnsavedChanges)
   File: `client/src/pages/SettingsPage.tsx`

8. Add /settings route to App.tsx:
   ```typescript
   { path: "settings", Component: SettingsPage },
   ```
   File: `client/src/App.tsx`

9. Run all tests — verify PASS:
   `npx vitest run client/src/lib/settingsValidation.test.ts`

10. Commit:
   `git add client/src/lib/settingsValidation.ts client/src/lib/settingsValidation.test.ts client/src/pages/SettingsPage.tsx client/src/components/LogoCropper.tsx client/src/App.tsx client/package.json client/package-lock.json`
   `git commit -m "feat(settings): add settings page with logo cropper and danger zone"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md — rules: Board Name, Logo, Reset Settings, Reset App, Settings Page
client/src/App.tsx — router setup pattern (lazy import for DashboardPage)
client/src/context/BoardContext.tsx — showToast, settings, refreshSettings (from T4)
client/src/api.ts — settings API methods (from T4)
valentinh/react-easy-crop docs — Cropper component, aspect prop, onCropComplete
docs/pocket/rule/creative-brief.md — design tokens (colors, typography, button styles)

## WHY THIS APPROACH
Complexity: deep
Justification: Multi-component page with client-side cropping (new dependency), multi-step confirmation, file upload flow, and unsaved changes detection. Requires architectural judgment on crop utility and modal state. Client-side validation utilities tested independently.

## SANDWICH CONTEXT
[CRITICAL: No changes to core/ modules. Settings page must use BoardContext for state.]
You are implementing Settings Page for Settings Infrastructure.
Spec: docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md
Design decision: Option A — single /settings page with collapsible sections
Files in scope: client/src/lib/settingsValidation.ts, client/src/lib/settingsValidation.test.ts, client/src/pages/SettingsPage.tsx, client/src/components/LogoCropper.tsx, client/src/App.tsx
Available after: T2 (server API), T3 (logo upload), T4 (client integration)
Architecture rule: Use BoardContext for settings state. Toast via showToast(). Design tokens from creative-brief.md.
[RESTATE: No changes to core/ modules. Settings page must use BoardContext for state.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given user on /settings, When types "Dev Team" and saves, Then board name updates, toast "Settings saved"
Given user on /settings, When submits empty name, Then error "Name is required"
Given user on /settings, When submits 16+ chars, Then error "Max 15 characters"
Given user on /settings, When uploads .png and crops, Then logo saved, preview updates
Given user on /settings, When uploads .pdf, Then error "Only .png and .jpg files are accepted"
Given user on /settings, When uploads 15MB file, Then error "File size must be under 10MB"
Given user on /settings, When cancels crop, Then no file uploaded, current logo remains
Given board has cards, When user resets settings, Then cards and columns unchanged
Given API error on /settings load, When page renders, Then error state with retry option
Given user clicks Reset Settings, When confirms, Then settings deleted, defaults restored
Given user clicks Reset App, When types "DELETE" + checks box, Then app reset
Given user on Reset App modal, When types "delete" (lowercase), Then button enabled
Given user on Reset App modal, When types "DELETE" but no checkbox, Then button disabled
Given unsaved changes, When navigates away, Then confirmation dialog shown

Given validateBoardName(""), When called, Then error "Name is required"
Given validateBoardName("  Dev Team  "), When called, Then trimmed "Dev Team"
Given validateResetAppConfirmation("DELETE", true), When called, Then enabled
Given validateResetAppConfirmation("delete", true), When called, Then enabled
Given validateResetAppConfirmation("DELETE", false), When called, Then disabled
Given validateUnsavedChanges("Camel", "Dev Team"), When called, Then true
Given validateUnsavedChanges("Camel", "Camel"), When called, Then false

All tests PASS. Commit exists with message matching `feat(settings): add settings page with logo cropper and danger zone`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Board name validation (1-15 chars, trim, reject empty)
  - Logo upload with client-side cropping (1:1 aspect)
  - File type validation (.png/.jpg) and size limit (10MB)
  - Reset Settings confirmation dialog
  - Reset App multi-step confirmation (type "DELETE" + checkbox)
  - Unsaved changes warning (beforeunload)
  - Design tokens from creative-brief.md (colors, typography)
  - Validators live in client/src/lib/settingsValidation.ts and are imported by BOTH page and test (no copy in the test file)
  - Genuine TDD red phase (test fails on missing module, not on logic in its own file)
  - 409 conflict handling on save (toast + refreshSettings)
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Validators redefined inside the test file (fake red phase) or duplicated into SettingsPage.tsx
  - External storage (S3/Cloudinary) — out-of-scope
  - Tabbed settings layout — out-of-scope
  - Per-user settings — out-of-scope
  - Changes to files outside listed scope

Open question risks:
  — None

Rollback note:
  - Remove SettingsPage.tsx, LogoCropper.tsx, revert App.tsx route — no existing behavior changed

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never
Escalate when: react-easy-crop API incompatible or design tokens conflict

---

### Task 6: Dynamic Sidebar + Browser Title + Favicon [depends: T4]

## OBJECTIVE
Refactor Sidebar to display dynamic board name and logo from settings state. Update browser tab title and favicon dynamically when settings change. Add Settings nav item to sidebar.

Files:
- Create: `client/src/lib/title.ts` (formatTitle/getFaviconLink — imported by AppLayout AND test)
- Modify: `client/src/layout/Sidebar.tsx`
- Modify: `client/src/layout/AppLayout.tsx`

> **Real red phase (same fix as T5).** Don't define `formatTitle`/`getFaviconLink` inside the test. Put them in `client/src/lib/title.ts`, import them in both AppLayout and the test, so the first run genuinely fails on a missing module.

Steps:
1. Write failing test for: formatTitle utility generates correct title. Import from the real module:
   File: `client/src/lib/title.test.ts`
   Test verifies: Given board name "Dev Team", When formatTitle called, Then returns "Dev Team — Kanban"

   ```typescript
   import { describe, expect, it } from "vitest";
   import { formatTitle, getFaviconLink } from "./title";

   describe("formatTitle", () => {
     it("formats title with custom board name", () => {
       expect(formatTitle("Dev Team")).toBe("Dev Team — Kanban");
     });

     it("formats title with default board name", () => {
       expect(formatTitle("Camel")).toBe("Camel — Kanban");
     });

     it("handles empty board name", () => {
       expect(formatTitle("")).toBe(" — Kanban");
     });

     it("handles board name with special characters", () => {
       expect(formatTitle("Team #1")).toBe("Team #1 — Kanban");
     });
   });

   describe("getFaviconLink", () => {
     it("returns default logo path", () => {
       expect(getFaviconLink("/logo.png")).toBe("/logo.png");
     });

     it("returns custom uploaded logo path", () => {
       expect(getFaviconLink("/uploads/logo-123-abc.png")).toBe("/uploads/logo-123-abc.png");
     });
   });
   ```

2. Run test — verify FAIL:
   `npx vitest run client/src/lib/title.test.ts`
   Expected failure: module not found — `./title` does not exist yet

3. Implement the utilities in `client/src/lib/title.ts`:
   ```typescript
   export function formatTitle(boardName: string): string {
     return `${boardName} — Kanban`;
   }

   export function getFaviconLink(logoPath: string): string {
     return logoPath;
   }
   ```
   Run test — verify PASS: `npx vitest run client/src/lib/title.test.ts`
   File: `client/src/lib/title.ts`

4. Refactor Sidebar.tsx — replace hardcoded values:
   ```typescript
   // Before:
   <img src="/logo.png" alt="Camel" className="h-6 w-6 shrink-0" />
   <span className={...}>Camel</span>
   
   // After:
   const { settings } = useBoard();
   <img src={settings.logoPath} alt={settings.boardName} className="h-6 w-6 shrink-0" />
   <span className={...}>{settings.boardName}</span>
   ```
   Apply to both desktop Sidebar and MobileNav components.
   File: `client/src/layout/Sidebar.tsx`

5. Add Settings nav item to NAV_ITEMS:
   ```typescript
   import { Settings } from "lucide-react";
   // Add to NAV_ITEMS array:
   { to: "/settings", label: "Settings", icon: Settings },
   ```
   File: `client/src/layout/Sidebar.tsx`

6. Add dynamic title + favicon in AppLayout.tsx (import `formatTitle`/`getFaviconLink` from `../lib/title`):
   ```typescript
   import { formatTitle, getFaviconLink } from "../lib/title";
   // ...
   const onSettings = location.pathname.startsWith("/settings");
   useEffect(() => {
     // Spec Story 5: the Settings page tab reads "Settings — <board>";
     // every other route uses the default "<board> — Kanban".
     document.title = onSettings
       ? `Settings — ${settings.boardName}`
       : formatTitle(settings.boardName);

     // Update favicon
     let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
     if (!link) {
       link = document.createElement("link");
       link.rel = "icon";
       document.head.appendChild(link);
     }
     link.href = getFaviconLink(settings.logoPath);
   }, [settings.boardName, settings.logoPath, onSettings]);
   ```
   File: `client/src/layout/AppLayout.tsx`

7. Run tests — verify PASS:
   `npx vitest run client/src/lib/title.test.ts`

8. Commit:
   `git add client/src/lib/title.ts client/src/lib/title.test.ts client/src/layout/Sidebar.tsx client/src/layout/AppLayout.tsx`
   `git commit -m "feat(settings): dynamic sidebar, browser title, and favicon from settings"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md — rule: Settings Page (sidebar + title)
client/src/layout/Sidebar.tsx — current hardcoded logo + name, NAV_ITEMS, desktop + mobile
client/src/layout/AppLayout.tsx — app shell, where title/favicon logic belongs
client/src/context/BoardContext.tsx — settings state (from T4)

## WHY THIS APPROACH
Complexity: lightweight
Justification: Simple refactor replacing hardcoded values with context-driven values. Existing patterns (useBoard, useEffect) reused. Utility functions enable testing without DOM/rendering setup.

## SANDWICH CONTEXT
[CRITICAL: Sidebar must use settings from BoardContext — not fetch independently]
You are implementing Dynamic Sidebar for Settings Infrastructure.
Spec: docs/pocket/spec/2026-06-12-camel-settings/settings-infrastructure.md
Design decision: Option A — settings in BoardContext, sidebar consumes
Files in scope: client/src/lib/title.ts, client/src/lib/title.test.ts, client/src/layout/Sidebar.tsx, client/src/layout/AppLayout.tsx
Available after: T4 (settings in BoardContext)
Architecture rule: Use useBoard() for settings. No direct API calls in layout.
[RESTATE: Sidebar must use settings from BoardContext — not fetch independently]

## DELIVERABLE
Verification — task is DONE when all pass:

Given settings.boardName = "Dev Team", When Sidebar renders, Then shows "Dev Team"
Given settings.logoPath = "/uploads/logo-abc.png", When Sidebar renders, Then shows custom logo
Given no custom settings, When Sidebar renders, Then shows "Camel" + "/logo.png" (defaults)
Given settings.boardName = "Dev Team" on a non-settings route, When AppLayout mounts, Then document.title = "Dev Team — Kanban"
Given user is on /settings with boardName "Camel", When effect runs, Then document.title = "Settings — Camel"
Given settings.logoPath changed, When effect runs, Then favicon href updated
Given NAV_ITEMS updated, When Sidebar renders, Then Settings link visible

Given formatTitle("Dev Team"), When called, Then returns "Dev Team — Kanban"
Given formatTitle("Camel"), When called, Then returns "Camel — Kanban"
Given getFaviconLink("/logo.png"), When called, Then returns "/logo.png"
Given getFaviconLink("/uploads/custom.png"), When called, Then returns "/uploads/custom.png"

All tests PASS. Commit exists with message matching `feat(settings): dynamic sidebar, browser title, and favicon from settings`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Dynamic board name from settings
  - Dynamic logo from settings
  - Settings nav item in sidebar
  - Dynamic document.title ("<board> — Kanban", and "Settings — <board>" on /settings)
  - Dynamic favicon
  - Utilities live in client/src/lib/title.ts, imported by BOTH AppLayout and test (genuine red phase; no copy in the test file)
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Direct API calls in layout components
  - Changes to files outside listed scope

Open question risks:
  — None

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never
Escalate when: layout refactor breaks existing navigation

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Settings DB Schema + Shared Types | prereq | lightweight | schema.sql DDL (no migrations/ file), types compile incl. `version`, type test passes |
| T2 | Settings Server API + Validation | T1 | standard | Pure validation tested; GET/PATCH/DELETE + reset-app; single global version locking; self-excluded online check; `settings.updated` event |
| T3 | Logo Upload + Cleanup Endpoints | T2 | standard | File validation tested; multer upload to absolute UPLOADS_DIR; express.static for prod |
| T4 | Client Settings Integration | T1 | lightweight | API methods tested with mocked fetch; context incl. version; SSE settings sync |
| T5 | Settings Page + Logo Cropper + Danger Zone | T2,T3,T4 | deep | Validators in lib/settingsValidation.ts (real red phase); full settings page; 409 handling |
| T6 | Dynamic Sidebar + Browser Title + Favicon | T4 | lightweight | Utils in lib/title.ts (real red phase); dynamic values; Settings-page title |
