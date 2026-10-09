# EXECUTION PLAN — Column Color Shuffle

**Date:** 2026-07-06
**Spec:** docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md
**Status:** validated
**Total tasks:** 5

---

## Execution Overview

### Recommended Order
```
T1, T2 (parallel) → T3 → T4 → T5
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Foundation | T1, T2 | none (both prereq) |
| Rendering | T3 | T1 completes |
| Picker UI | T4 | T3 completes |
| Verification | T5 | T2, T4 complete |

### Constraints Reminder
**Architecture:** Client-only culori generation; server validates format + loose sanity range only. No DB migration. Do not touch `templates.ts`, card colors, or dark mode. OKLCH color space. React object-form `style={{...}}` for inline colors. Legacy 5 named CSS vars kept in `index.css`.
**Out-of-scope:** Freeform hex input, per-card colors, dark mode, shuffle history, template migration, server-side generation API, column `version` field.
**Assumptions at risk:** Exact L/C pastel band derived from existing `index.css` shade-200/50 values — cosmetic tuning knob.
**Sequencing:** T1 and T2 are independent foundations. T3/T4 both touch `ColumnView.tsx` sequentially to avoid merge conflicts.

### Manual QA (after T4)
1. Apply a workspace template → columns keep legacy named colors on the board.
2. Open column settings on one column → Shuffle → pick a swatch → Save → reload board → OKLCH border/bg render correctly.
3. Reopen settings on that column → saved color pinned and highlighted.
4. Open settings on a legacy-colored column (e.g. `powder-blue`) → swatch preview shows correct tint, saved name highlighted.

### File Structure Map

```
Rule: Shuffle generates 5 brand-safe pastel candidates
  Create: client/src/lib/columnColorUtils.ts        (created by: T1)
  Modify: client/package.json                       (created by: T1)
  Modify: package-lock.json                         (created by: T1)
  Test:   client/src/lib/columnColorUtils.test.ts   (created by: T1)

Rule: The active color is always pinned as one of the 5
  Modify: client/src/lib/columnColorUtils.ts        (T1 — generateSwatchCandidates)
  Test:   client/src/lib/columnColorUtils.test.ts   (T1)

Rule: Selection only persists on Save, independently per column
  Modify: client/src/components/ColumnView.tsx      (T4 — ColumnSettings)
  Test:   client/src/components/ColumnView.test.tsx (T4)

Rule: Legacy named colors remain valid, both read and write
  Modify: server/src/validators/column.ts             (T2)
  Modify: server/src/routes/columns.ts                (T2 — PATCH error message)
  Modify: client/src/lib/columnColors.ts            (T3 — comment only, no rename)
  Create: client/src/lib/columnStyleResolver.ts       (created by: T3)
  Modify: client/src/components/ColumnView.tsx        (T3 — board rendering; T4 — picker)
  Test:   server/src/validators/column.test.ts        (T2)
  Test:   client/src/lib/columnStyleResolver.test.ts  (T3)

Rule: Reject invalid color values (negative)
  Modify: server/src/validators/column.ts             (T2)
  Modify: server/src/routes/columns.ts                (T2)
  Test:   server/src/validators/column.test.ts        (T2)
  Test:   server/src/routes/columns.patch.integration.test.ts (T5 — optional)
```

---

## Pocket Packets

---

### Task 1: Culori color utilities — generation, pinning, bg derivation [prereq]

## OBJECTIVE
Add `culori` client dependency and a domain-scoped `columnColorUtils` module that generates 5 pastel OKLCH border colors, pins the active selection, and derives bg-tints.

Files:
- Create: `client/src/lib/columnColorUtils.ts`
- Modify: `client/package.json`
- Test: `client/src/lib/columnColorUtils.test.ts`

Steps:
1. Write failing test for: shuffle generates 5 brand-safe pastel candidates (no pinned color)
   File: `client/src/lib/columnColorUtils.test.ts`
   ```typescript
   import { describe, expect, it } from "vitest";
   import { generateSwatchCandidates } from "./columnColorUtils";

   const OKLCH_RE = /^oklch\(/;

   function parseL(css: string): number {
     const m = css.match(/oklch\(([\d.]+)%/);
     return m ? Number(m[1]) / 100 : Number(css.match(/oklch\(([\d.]+)/)?.[1]);
   }

   describe("generateSwatchCandidates", () => {
     it("returns 5 oklch border colors in pastel L band when nothing pinned", () => {
       const swatches = generateSwatchCandidates(null);
       expect(swatches).toHaveLength(5);
       for (const s of swatches) {
         expect(s).toMatch(OKLCH_RE);
         const l = parseL(s);
         expect(l).toBeGreaterThanOrEqual(0.84);
         expect(l).toBeLessThanOrEqual(0.94);
       }
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- client/src/lib/columnColorUtils.test.ts`
   Expected failure: module `./columnColorUtils` not found

3. Install dependency and verify culori API before implementing:
   File: `client/package.json` — add `"culori": "^4.0.1"` to dependencies; run `npm install` from repo root
   In a scratch import or REPL, confirm `random`, `clampChroma`, `formatCss`, and `parse` named exports work as expected. Adjust call signatures in step 4 if the installed version differs (e.g. `random` hue range shape).

4. Implement minimal code to satisfy the test:
   File: `client/src/lib/columnColorUtils.ts`
   Implement:
   - `PASTEL_BORDER_L = 0.89`, `PASTEL_BORDER_C = 0.07` (derived from legacy shade-200 OKLCH in `index.css`: L 84–94%, C 0.027–0.096)
   - `PASTEL_BG_L = 0.97`, `PASTEL_BG_C = 0.015` (derived from shade-50: L 96–98%, C 0.007–0.027)
   - `generateRandomPastelBorder(): string` — `random('oklch', { mode: 'oklch', l: PASTEL_BORDER_L, c: PASTEL_BORDER_C, h: [0, 360] })` then `clampChroma` + `formatCss`
   - `generateSwatchCandidates(pinned: string | null): string[]` — if pinned, return `[pinned, ...4 random]`; else 5 random
   - `deriveBackgroundColor(borderCss: string): string` — parse border OKLCH, return `formatCss({ mode: 'oklch', l: PASTEL_BG_L, c: PASTEL_BG_C, h })`

5. Run test — verify PASS:
   `npm run test -- client/src/lib/columnColorUtils.test.ts`
   Expected: PASS

6. Write failing test for: active color pinned + gamut clamp + `isStoredOklchColor`
   File: `client/src/lib/columnColorUtils.test.ts`
   ```typescript
   import {
     generateRandomPastelBorder,
     generateSwatchCandidates,
     deriveBackgroundColor,
     isStoredOklchColor,
   } from "./columnColorUtils";

   describe("pinning and gamut safety", () => {
     const PINNED = "oklch(88% 0.09 47.3)";

     it("pins the active color as first swatch", () => {
       const swatches = generateSwatchCandidates(PINNED);
       expect(swatches).toHaveLength(5);
       expect(swatches[0]).toBe(PINNED);
     });

     it("generates in-gamut pastel strings (clampChroma)", () => {
       for (let i = 0; i < 20; i++) {
         const css = generateRandomPastelBorder();
         expect(css).toMatch(OKLCH_RE);
         expect(css.length).toBeGreaterThan(10);
       }
     });

     it("derives a lighter bg tint from border color", () => {
       const bg = deriveBackgroundColor(PINNED);
       expect(bg).toMatch(OKLCH_RE);
       expect(parseL(bg)).toBeGreaterThan(parseL(PINNED));
     });
   });

   describe("isStoredOklchColor", () => {
     it("returns true for oklch strings and false for legacy names", () => {
       expect(isStoredOklchColor("oklch(88% 0.09 47.3)")).toBe(true);
       expect(isStoredOklchColor("powder-blue")).toBe(false);
     });
   });
   ```

7. Run test — verify FAIL (pinning / isStoredOklchColor not implemented)

8. Implement pinning + `isStoredOklchColor(value: string): boolean` — true when value starts with `oklch(` (structural check only; T3 uses this to branch legacy vs inline)

9. Run test — verify PASS:
   `npm run test -- client/src/lib/columnColorUtils.test.ts`

10. Refactor while green (bounded):
    - Ensure all culori imports use named exports (`random`, `clampChroma`, `formatCss`, `parse`)
    - Re-run test: `npm run test -- client/src/lib/columnColorUtils.test.ts` — must stay PASS
    - Nothing else to refactor → proceed

11. Commit:
    `git add client/package.json package-lock.json client/src/lib/columnColorUtils.ts client/src/lib/columnColorUtils.test.ts`
    `git commit -m "feat(columns): add culori-based pastel color generation utils"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md — rules: Shuffle generates 5 candidates, Active color pinned
client/src/lib/columnColors.ts — existing 5-name legacy palette (unchanged enum, reference for L/C bands)
client/src/index.css — OKLCH shade-200/50 values for pastel constant derivation
client/src/lib/agentColumnState.test.ts — vitest + describe/it/expect pattern

## WHY THIS APPROACH
Justification: Shared helper extracted first per Shared Helper Pattern — T3/T4 import generation logic instead of duplicating culori calls. `isStoredOklchColor` gives T3/T4 a single branch point for legacy vs OKLCH.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: culori is client-only — server must NOT import culori or add a shuffle API endpoint]
You are implementing culori color utilities for Column Color Shuffle.
Spec: docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md
Design decision: Option A — Client-only generation (culori end-to-end)
Files in scope: client/package.json, client/src/lib/columnColorUtils.ts, client/src/lib/columnColorUtils.test.ts
Available after: none (prereq)
Architecture rule: OKLCH color space; clampChroma for sRGB gamut safety
[RESTATE: culori is client-only — server must NOT import culori or add a shuffle API endpoint]

## DELIVERABLE
Given column has no color, When `generateSwatchCandidates(null)` is called, Then 5 fresh random swatches returned, none equal to each other by construction (may coincidentally match — acceptable)
Given a hue lands out of sRGB gamut for the target chroma, When generated, Then clampChroma produces a valid in-gamut pastel
Given column has a saved color, When `generateSwatchCandidates(saved)` is called, Then that color is result[0]
Given user shuffled and picked color Y, When `generateSwatchCandidates(Y)` is called, Then Y is pinned (not original saved color unless Y equals it)
Given `isStoredOklchColor("oklch(...)")`, Then true; Given legacy name, Then false

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Tests written BEFORE implementation (TDD)
  - Pastel L/C constants documented with reference to index.css shade values
  - `formatCss` output used for storage strings
  - Culori API verified against installed package before implementation
  - Commit follows conventional commits

Must-not-have:
  - Server-side culori dependency
  - Modifications to templates.ts or DB schema
  - Generic `utils.ts` filename

Open question risks:
  - Exact L/C band numbers are implementer-derived → if visually off-brand: adjust constants post-hoc (cosmetic only)

Rollback note:
  - Revert culori dep + utils file; legacy palette unaffected

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: culori API differs from docs — resolve in step 3 before writing generation logic
Escalate when: culori cannot be installed or tree-shaking breaks build

---

### Task 2: Server dual color validator — legacy names + OKLCH strings [prereq]

## OBJECTIVE
Expand `isValidColumnColor` to accept legacy 5-name palette OR well-formed OKLCH strings within loose sanity range; reject everything else. Keep PATCH route error message in sync with validator.

Files:
- Modify: `server/src/validators/column.ts`
- Modify: `server/src/routes/columns.ts`
- Test: `server/src/validators/column.test.ts`

Steps:
1. Write failing test for: legacy names still accepted + OKLCH accepted + invalid rejected + mixed batch
   File: `server/src/validators/column.test.ts`
   ```typescript
   import { describe, expect, it } from "vitest";
   import { isValidColumnColor, validateColumnBatch } from "./column.js";

   describe("isValidColumnColor — dual legacy + OKLCH", () => {
     it("accepts legacy names and null", () => {
       expect(isValidColumnColor(null)).toBe(true);
       expect(isValidColumnColor("powder-blue")).toBe(true);
       expect(isValidColumnColor("turquoise")).toBe(true);
     });

     it("accepts well-formed OKLCH in sanity range", () => {
       expect(isValidColumnColor("oklch(88% 0.09 47.3)")).toBe(true);
     });

     it("rejects values outside sanity range or unknown strings", () => {
       expect(isValidColumnColor("oklch(2 0.5 400)")).toBe(false);
       expect(isValidColumnColor("hot-pink")).toBe(false);
       expect(isValidColumnColor("")).toBe(false);
     });
   });

   describe("validateColumnBatch — OKLCH mixed with legacy", () => {
     it("accepts batch with one OKLCH color", () => {
       const result = validateColumnBatch([
         { title: "A", color: "oklch(88% 0.09 47.3)", wipLimit: null, policy: "", isDone: false },
       ]);
       expect(result.valid).toBe(true);
     });

     it("normalizes a batch with both legacy names and OKLCH strings", () => {
       const result = validateColumnBatch([
         { title: "Backlog", color: "powder-blue", wipLimit: null, policy: "p", isDone: false },
         { title: "Done", color: "oklch(88% 0.09 47.3)", wipLimit: null, policy: "p", isDone: true },
       ]);
       expect(result.valid).toBe(true);
       expect(result.normalized?.[1].color).toBe("oklch(88% 0.09 47.3)");
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/validators/column.test.ts`
   Expected failure: OKLCH strings rejected / `isValidColumnColor("oklch(...)")` is false

3. Implement minimal code:
   File: `server/src/validators/column.ts`
   - Change `NormalizedColumn.color` type to `string | null`
   - Add `parseOklchColor(value: string): { l: number; c: number; h: number } | null` — regex match `oklch(...)` with % or 0-1 L, parse floats
   - `isValidColumnColor`: null → true; legacy name in COLUMN_COLORS → true; else parse OKLCH and check L 0–1, C 0–0.4, H 0–360
   - Export `COLUMN_COLOR_VALIDATION_ERROR` constant: e.g. `"color must be a legacy name (powder-blue, …), a well-formed oklch(...), or null"`
   - Use that constant in `validateColumnBatch` error message
   File: `server/src/routes/columns.ts`
   - Import `COLUMN_COLOR_VALIDATION_ERROR` and use it in the PATCH handler's 400 response (replace hardcoded 5-name-only message at ~line 254)

4. Run test — verify PASS:
   `npm run test -- server/src/validators/column.test.ts`

5. Refactor while green:
   - Keep validator self-contained (no culori on server)
   - Confirm existing `validFive` fixture still passes
   - Re-run: `npm run test -- server/src/validators/column.test.ts`

6. Commit:
   `git add server/src/validators/column.ts server/src/validators/column.test.ts server/src/routes/columns.ts`
   `git commit -m "feat(columns): accept OKLCH strings in column color validator"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md — rules: Legacy colors valid, Reject invalid values
server/src/validators/column.ts — current enum-only validation
server/src/validators/column.test.ts — existing vitest patterns with `col()` helper
server/src/routes/columns.ts — PATCH/batch call `isValidColumnColor`; duplicate error message

## WHY THIS APPROACH
Justification: Server validation is independent of client culori — can run parallel with T1. Route and validator share one error string so API consumers see consistent 400 messages.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Server must NOT re-enforce tight brand pastel band — only structural OKLCH validity + loose L 0–1, C 0–0.4, H 0–360]
You are implementing dual color validation for Column Color Shuffle.
Spec: docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md
Design decision: Option A — server validates format only, not generation band
Files in scope: server/src/validators/column.ts, server/src/routes/columns.ts, server/src/validators/column.test.ts
Available after: none (prereq, parallel with T1)
Architecture rule: NodeNext ESM — keep `.js` extensions in imports
[RESTATE: Server must NOT re-enforce tight brand pastel band — only structural OKLCH validity + loose sanity range]

## DELIVERABLE
Given column.color = a legacy name, When `isValidColumnColor` called, Then returns true
Given oklch(88% 0.09 47.3), When submitted via validateColumnBatch, Then accepted
Given a template posts legacy names via validateColumnBatch, Then accepted (existing validFive fixture)
Given mixed legacy + OKLCH batch, When validated, Then both colors preserved in normalized output
[must-not] Given color value neither legacy nor well-formed oklch in sanity range, When submitted, Then rejected
Given invalid color PATCHed, When route returns 400, Then error mentions legacy names and oklch format

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Legacy 5 names remain valid (no regression)
  - Null remains valid
  - TDD order enforced
  - PATCH route uses same error constant as validator
  - `recordActivity` untouched (validator only)

Must-not-have:
  - culori server dependency
  - DB migration
  - Changes to templates.ts

Open question risks:
  - OKLCH parse regex too strict/loose → adjust based on test cases

Rollback note:
  - Revert to enum-only validator; legacy names unaffected

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Escalate when: PATCH route error message contract breaks existing API consumers

---

### Task 3: Column style resolver — OKLCH inline styles + legacy CSS var fallback [depends: T1]

## OBJECTIVE
Resolve column border/bg styles for both legacy named colors and stored OKLCH strings; update board column rendering to use object-form inline styles for OKLCH.

Files:
- Create: `client/src/lib/columnStyleResolver.ts`
- Modify: `client/src/lib/columnColors.ts`
- Modify: `client/src/components/ColumnView.tsx`
- Test: `client/src/lib/columnStyleResolver.test.ts`

Steps:
1. Write failing test for: legacy + OKLCH style resolution
   File: `client/src/lib/columnStyleResolver.test.ts`
   ```typescript
   import { describe, expect, it } from "vitest";
   import { COLUMN_STYLES } from "./columnColors";
   import { deriveBackgroundColor } from "./columnColorUtils";
   import { resolveColumnAppearance } from "./columnStyleResolver";

   const BORDER = "oklch(88% 0.09 47.3)";

   describe("resolveColumnAppearance", () => {
     it("returns legacy Tailwind classes for named colors", () => {
       const result = resolveColumnAppearance("powder-blue", false);
       expect(result.kind).toBe("legacy");
       if (result.kind === "legacy") {
         expect(result.className).toBe(COLUMN_STYLES["powder-blue"]);
       }
     });

     it("returns inline border + derived bg for OKLCH strings", () => {
       const result = resolveColumnAppearance(BORDER, false);
       expect(result.kind).toBe("inline");
       if (result.kind === "inline") {
         expect(result.style.borderColor).toBe(BORDER);
         expect(result.style.backgroundColor).toBe(deriveBackgroundColor(BORDER));
       }
     });

     it("returns default neutral for null", () => {
       const result = resolveColumnAppearance(null, false);
       expect(result.kind).toBe("default");
     });

     it("treats non-legacy non-oklch strings as default", () => {
       const result = resolveColumnAppearance("hot-pink", false);
       expect(result.kind).toBe("default");
     });

     it("WIP over state overrides color", () => {
       const result = resolveColumnAppearance(BORDER, true);
       expect(result.kind).toBe("wip");
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- client/src/lib/columnStyleResolver.test.ts`
   Expected failure: module not found

3. Implement minimal code:
   File: `client/src/lib/columnStyleResolver.ts`
   - `resolveColumnAppearance(color: string | null, isWipOver: boolean)` → discriminated union:
     - `wip` — error border/bg classes (unchanged from today)
     - `default` — neutral border/bg classes
     - `legacy` — `COLUMN_STYLES[color]` when color is a key in `COLUMN_STYLES`
     - `inline` — when `isStoredOklchColor(color)` from `columnColorUtils`; `{ borderColor, backgroundColor: deriveBackgroundColor(color) }`
   File: `client/src/lib/columnColors.ts`
   - Add a brief comment that `COLUMN_COLORS` / `COLUMN_STYLES` are the legacy named palette; OKLCH strings bypass this map. Do **not** rename exports.
   File: `client/src/components/ColumnView.tsx` (board `<section>` rendering only)
   - Replace `getColumnColorStyles` with `resolveColumnAppearance`
   - Keep layout/shadow classes on `<section>` always; apply color **only** from resolver:
     - `legacy` / `default` / `wip` → append `appearance.className` (no inline color style)
     - `inline` → omit color Tailwind classes; set `style={appearance.style}` (object form)
   - `useMemo` inline style when `appearance.kind === 'inline'`, keyed on `column.color`

4. Run test — verify PASS:
   `npm run test -- client/src/lib/columnStyleResolver.test.ts`

5. Refactor while green:
   - Re-run tests
   - Ensure WIP error state still overrides color
   - Visually confirm no `border-neutral-*` / `bg-neutral-*` color classes remain on `<section>` when kind is `inline`

6. Commit:
   `git add client/src/lib/columnStyleResolver.ts client/src/lib/columnStyleResolver.test.ts client/src/lib/columnColors.ts client/src/components/ColumnView.tsx`
   `git commit -m "feat(columns): render OKLCH column colors with legacy fallback"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md — rules: Legacy renders unchanged, bg derived at render time
client/src/components/ColumnView.tsx — existing `getColumnColorStyles`, object-form style pattern
client/src/lib/columnColorUtils.ts — `deriveBackgroundColor`, `isStoredOklchColor` (from T1)

## WHY THIS APPROACH
Justification: Separates rendering from picker UI to keep ColumnView changes sequential (T3 then T4). `isStoredOklchColor` centralizes OKLCH detection for both board render and picker preview.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Legacy named colors must render identically via existing CSS var Tailwind classes — do not remove index.css vars]
You are implementing column color rendering for Column Color Shuffle.
Spec: docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md
Design decision: Option A — store border OKLCH only, derive bg client-side
Files in scope: columnStyleResolver.ts, columnColors.ts, ColumnView.tsx (rendering only, not ColumnSettings picker)
Available after: T1 (deriveBackgroundColor, isStoredOklchColor)
Architecture rule: React object-form style={{ borderColor, backgroundColor }} — no string-templated styles
[RESTATE: Legacy named colors must render identically via existing CSS var Tailwind classes]

## DELIVERABLE
Given column.color = "powder-blue", When board renders, Then border/bg identical to before (legacy CSS vars)
Given column.color = oklch border string, When board renders, Then borderColor from stored value and backgroundColor derived (no conflicting neutral color classes)
Given null color, When rendered, Then default neutral styling

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - useMemo on OKLCH inline style keyed on column.color
  - WIP over state still overrides color
  - `isStoredOklchColor` used for inline branch
  - TDD enforced

Must-not-have:
  - Removing legacy CSS vars from index.css
  - Changes to ColumnSettings picker (T4 scope)
  - Renaming `COLUMN_COLORS` export

## STOP CONDITIONS
Done when: DELIVERABLE passes, tests green, commit created
Escalate when: Tailwind class + inline style conflict on same element

---

### Task 4: Shuffle picker UI in ColumnSettings [depends: T1, T3]

## OBJECTIVE
Replace fixed 5-name swatch grid with shuffle-generated OKLCH swatches, Shuffle button, pinned-active-color logic, and unchanged Save/toggle/X behavior.

Files:
- Modify: `client/src/components/ColumnView.tsx`
- Create: `client/src/components/ColumnView.test.tsx`

Steps:
1. Create test file with shared harness (mocks + render helper):
   File: `client/src/components/ColumnView.test.tsx`
   ```typescript
   // client/src/components/ColumnView.test.tsx — jsdom; no jest-dom (see TemplatePicker.test.tsx)
   import { cleanup, fireEvent, render, screen } from "@testing-library/react";
   import { afterEach, describe, expect, it, vi } from "vitest";

   vi.mock("@dnd-kit/core", () => ({
     useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
   }));
   vi.mock("@dnd-kit/sortable", () => ({
     SortableContext: ({ children }: { children: React.ReactNode }) => children,
     verticalListSortingStrategy: {},
   }));
   vi.mock("../context/BoardContext", () => ({
     useBoard: () => ({ activeWorkspaceId: null }),
   }));
   vi.mock("../api", () => ({
     api: { getWorkspaceMembers: vi.fn().mockResolvedValue({ members: [] }) },
   }));
   vi.mock("./CardView", () => ({ default: () => null }));

   const SWATCHES = [
     "oklch(88% 0.09 47.3)",
     "oklch(90% 0.08 120)",
     "oklch(89% 0.07 200)",
     "oklch(87% 0.09 280)",
     "oklch(91% 0.06 40)",
   ];

   vi.mock("../lib/columnColorUtils", () => ({
     generateSwatchCandidates: vi.fn(() => [...SWATCHES]),
     deriveBackgroundColor: vi.fn((c: string) => c),
     isStoredOklchColor: vi.fn((c: string) => c.startsWith("oklch(")),
   }));

   import { generateSwatchCandidates } from "../lib/columnColorUtils";
   import ColumnView from "./ColumnView";
   import type { Column } from "../types";

   function makeColumn(overrides: Partial<Column> = {}): Column {
     return {
       id: 1,
       title: "Todo",
       position: 0,
       wipLimit: null,
       policy: "",
       isDone: false,
       isSignable: false,
       signableAssigneeId: null,
       color: null,
       cards: [],
       ...overrides,
     };
   }

   function openSettings(column: Column, onUpdate = vi.fn().mockResolvedValue(undefined)) {
     render(
       <ColumnView
         column={column}
         onOpenCard={vi.fn()}
         onAddCard={vi.fn().mockResolvedValue(undefined)}
         onUpdateColumn={onUpdate}
       />,
     );
     fireEvent.click(screen.getByRole("button", { name: /edit todo column/i }));
     return { onUpdate };
   }

   afterEach(cleanup);
   ```

2. Write failing tests — cycle 1 (open, shuffle, toggle, save):
   ```typescript
   describe("ColumnSettings color shuffle", () => {
     it("shows 5 swatches with none selected when column has no color", () => {
       openSettings(makeColumn({ color: null }));
       const swatches = screen.getAllByRole("button", { name: /^Color swatch \d$/i });
       expect(swatches).toHaveLength(5);
       for (const btn of swatches) {
         expect(btn.getAttribute("aria-pressed")).toBe("false");
       }
     });

     it("calls generateSwatchCandidates with current selection on shuffle", () => {
       openSettings(makeColumn({ color: null }));
       fireEvent.click(screen.getByRole("button", { name: /^Color swatch 1$/i }));
       fireEvent.click(screen.getByRole("button", { name: /shuffle colors/i }));
       expect(generateSwatchCandidates).toHaveBeenLastCalledWith(SWATCHES[0]);
     });

     it("toggles selected swatch off to null", () => {
       openSettings(makeColumn({ color: null }));
       const first = screen.getByRole("button", { name: /^Color swatch 1$/i });
       fireEvent.click(first);
       fireEvent.click(first);
       for (const btn of screen.getAllByRole("button", { name: /^Color swatch \d$/i })) {
         expect(btn.getAttribute("aria-pressed")).toBe("false");
       }
     });

     it("persists OKLCH only on Save", async () => {
       const { onUpdate } = openSettings(makeColumn({ color: null }));
       fireEvent.click(screen.getByRole("button", { name: /^Color swatch 1$/i }));
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ color: SWATCHES[0] }));
     });
   });
   ```

3. Write failing tests — cycle 2 (saved OKLCH, legacy reopen, X clear):
   ```typescript
   describe("ColumnSettings saved color and clear", () => {
     const SAVED = "oklch(88% 0.09 47.3)";

     it("highlights saved OKLCH when settings reopen", () => {
       vi.mocked(generateSwatchCandidates).mockReturnValueOnce([SAVED, ...SWATCHES.slice(1)]);
       openSettings(makeColumn({ color: SAVED }));
       const selected = screen.getByRole("button", { name: /^Color swatch 1$/i });
       expect(selected.getAttribute("aria-pressed")).toBe("true");
     });

     it("highlights saved legacy name when settings reopen", () => {
       vi.mocked(generateSwatchCandidates).mockReturnValueOnce([
         "powder-blue",
         ...SWATCHES.slice(1),
       ]);
       openSettings(makeColumn({ color: "powder-blue" }));
       const selected = screen.getByRole("button", { name: /^Color swatch 1$/i });
       expect(selected.getAttribute("aria-pressed")).toBe("true");
     });

     it("pins just-picked color (not original saved) on re-shuffle", () => {
       const PICKED = "oklch(90% 0.08 120)";
       openSettings(makeColumn({ color: SAVED }));
       fireEvent.click(screen.getByRole("button", { name: /^Color swatch 2$/i }));
       fireEvent.click(screen.getByRole("button", { name: /shuffle colors/i }));
       expect(generateSwatchCandidates).toHaveBeenLastCalledWith(PICKED);
     });

     it("clears color via X button then Save persists null", async () => {
       const { onUpdate } = openSettings(makeColumn({ color: SAVED }));
       fireEvent.click(screen.getByRole("button", { name: /remove color/i }));
       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ color: null }));
     });
   });
   ```

4. Run tests — verify FAIL:
   `npm run test -- client/src/components/ColumnView.test.tsx`
   Expected failure: file not found / shuffle UI not implemented

5. Implement minimal code:
   File: `client/src/components/ColumnView.tsx` — ColumnSettings only:
   - Change `color` state to `string | null` (seed from `column.color`)
   - Add `swatches` state: `useState(() => generateSwatchCandidates(column.color))`
   - Add helper `swatchPreviewStyle(swatch: string)`:
     - if `isStoredOklchColor(swatch)` → `{ backgroundColor: swatch }`
     - else if `swatch in COLOR_PREVIEWS` → `{ backgroundColor: COLOR_PREVIEWS[swatch as ColumnColor] }` (legacy names are CSS vars, not valid raw color strings)
     - else → `{ backgroundColor: swatch }` fallback
   - Color label row: flex with "Color" text + Shuffle button (`Shuffle` from lucide-react, `aria-label="Shuffle colors"`)
   - On shuffle click: `setSwatches(generateSwatchCandidates(color))`
   - Render swatches index `0`–`4` with keys `0`–`4` (not color string keys)
   - Each swatch button: `aria-label={`Color swatch ${i + 1}`}`, `aria-pressed={color === swatch}`, `style={swatchPreviewStyle(swatch)}`
   - Selection highlight via `color === swatch` (string equality) + existing border/scale classes
   - Toggle: click active swatch → null; X button → null (unchanged)
   - Selected label: `COLOR_LABELS[color]` for legacy, truncated OKLCH for stored strings, "Default neutral" for null
   - Save passes `color` unchanged (OKLCH string, legacy name, or null)

6. Run tests — verify PASS:
   `npm run test -- client/src/components/ColumnView.test.tsx`

7. Refactor while green:
   - Re-run tests
   - No extraction needed unless ColumnSettings exceeds ~50 lines added

8. Commit:
   `git add client/src/components/ColumnView.tsx client/src/components/ColumnView.test.tsx`
   `git commit -m "feat(columns): add shuffle-based column color picker"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md — rules: Shuffle candidates, pinned active, Save persistence, toggle/X clear
client/src/components/ColumnView.tsx — existing ColumnSettings color block lines 189-222
client/src/components/TemplatePicker.test.tsx — @testing-library/react + vitest patterns (no jest-dom)
client/src/pages/BoardPage.test.tsx — BoardContext mock pattern

## WHY THIS APPROACH
Justification: Picker UI depends on T1 utils and follows T3 rendering changes in same file sequentially. Full ColumnView render harness avoids exporting private ColumnSettings.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Color persists only on Save — local state until save button clicked, same as title/wipLimit/policy]
You are implementing shuffle picker UI for Column Color Shuffle.
Spec: docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md
Design decision: Option A — client-only shuffle, no API round-trip
Files in scope: client/src/components/ColumnView.tsx (ColumnSettings), client/src/components/ColumnView.test.tsx
Available after: T1, T3
Architecture rule: Swatch aria-labels `Color swatch 1`–`5`; index keys 0–4; legacy preview via COLOR_PREVIEWS
[RESTATE: Color persists only on Save — local state until save button clicked]

## DELIVERABLE
Given column.color is null, When settings open, Then 5 fresh swatches, none selected
Given column has saved OKLCH color, When settings reopen, Then saved color in swatches and highlighted
Given column has saved legacy name, When settings reopen, Then legacy swatch preview renders correctly and is highlighted
Given user picked Y then shuffles again, Then Y pinned (not original unless same)
Given user picks swatch and clicks Save, Then onUpdateColumn persists OKLCH string
Given active swatch clicked again, Then color null
Given Remove color X then Save, Then color null

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Shuffle icon from lucide-react, `aria-label="Shuffle colors"`
  - Swatch `aria-label={`Color swatch ${n}`}` for n = 1..5
  - `swatchPreviewStyle` branches legacy → COLOR_PREVIEWS, OKLCH → raw string
  - Test harness mocks dnd-kit, BoardContext, api, CardView
  - Independent per-column (component state scoped to ColumnSettings instance)
  - TDD enforced

Must-not-have:
  - Freeform color input
  - Server shuffle endpoint
  - Auto-persist on swatch click
  - `backgroundColor: "powder-blue"` (invalid CSS — must use COLOR_PREVIEWS)

## STOP CONDITIONS
Done when: DELIVERABLE passes, tests green, commit created
Escalate when: ColumnSettings becomes unwieldy (>300 lines) — extract subcomponent

---

### Task 5: Post-integration verification — optional route tests + QA sign-off [depends: T2, T4]

## OBJECTIVE
Optional gated PATCH integration cases and a final sign-off that server + client paths align. No new production code unless integration tests expose a bug.

Files:
- Test: `server/src/routes/columns.patch.integration.test.ts` (optional additions only)

Steps:
1. Confirm T2 unit tests already cover mixed legacy + OKLCH batch normalization — do not duplicate in this task.

2. (Optional) Add integration test cases behind `RUN_INTEGRATION=1`:
   File: `server/src/routes/columns.patch.integration.test.ts`
   - PATCH with `color: "oklch(88% 0.09 47.3)"` → 200, persisted value matches
   - PATCH with `color: "not-a-color"` → 400, body error matches `COLUMN_COLOR_VALIDATION_ERROR`
   Follow existing file gate pattern; skip when env unset.

3. Run default suite (must stay green):
   `npm run test -- server/src/validators/column.test.ts`
   `npm run test -- client/src/components/ColumnView.test.tsx`

4. (Optional) Run integration suite:
   `RUN_INTEGRATION=1 npm run test -- server/src/routes/columns.patch.integration.test.ts`

5. Complete Manual QA checklist from Execution Overview (template apply → shuffle → save → reload → legacy column reopen).

6. Commit only if integration test file changed:
   `git add server/src/routes/columns.patch.integration.test.ts`
   `git commit -m "test(columns): optional PATCH integration for OKLCH colors"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md — rules: Pick and save, Template batch, Reject invalid
server/src/routes/columns.patch.integration.test.ts — RUN_INTEGRATION=1 gate pattern

## WHY THIS APPROACH
Justification: Validator + route error message are fully covered in T2; this task is sign-off and optional DB-backed route tests only.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Integration tests require RUN_INTEGRATION=1 — do not break default `npm run test`]
You are verifying OKLCH color persistence end-to-end for Column Color Shuffle.
Spec: docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md
Files in scope: server integration test file (optional), manual QA
Available after: T2, T4
[RESTATE: Integration tests require RUN_INTEGRATION=1 — do not break default test run]

## DELIVERABLE
Given T2 complete, When default `npm run test` runs, Then validator + unit tests pass without RUN_INTEGRATION
Given valid OKLCH PATCHed (manual or integration), When board reloads, Then column renders with OKLCH styles
Given invalid color PATCHed (integration), When route handler runs, Then 400 with dual-format error message
Given Manual QA checklist, When completed, Then all four scenarios verified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Default test suite green without RUN_INTEGRATION
  - Manual QA checklist completed
  - No production code changes unless integration test reveals bug

Must-not-have:
  - DB schema changes
  - Duplicate unit tests already in T2

## STOP CONDITIONS
Done when: default tests green, Manual QA complete, optional integration commit if added
Escalate when: integration test reveals bug outside T2/T4 scope

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Culori color utilities | prereq | standard | 5 pastel swatches + pinning + isStoredOklchColor |
| T2 | Server dual validator + route error | prereq | standard | Legacy + OKLCH accept, mixed batch, PATCH 400 message |
| T3 | Column style resolver | T1 | standard | Legacy unchanged, OKLCH inline render, no class conflict |
| T4 | Shuffle picker UI | T1, T3 | standard | Harness tests, legacy preview, shuffle/pin/Save |
| T5 | Verification + QA sign-off | T2, T4 | lightweight | Optional integration, Manual QA checklist |
