# Column Color Shuffle

**Date:** 2026-07-06
**Status:** draft
**Author:** brainstorm session
**Spec path:** docs/pocket/spec/2026-07-06-column-color-shuffle/color-shuffle.md

---

## Summary

Replace the fixed 5-name column color picker with a shuffle-based randomizer. A new shuffle button (lucide `Shuffle` icon) generates 5 fresh pastel OKLCH swatches on demand, using the `culori` library instead of hand-authored CSS custom properties. Users pick one per column; each column's color stays independent. This removes the hardcoded 5-color ceiling the user explicitly wants gone.

---

## Context

### Current State
- `client/src/lib/columnColors.ts` defines a fixed `COLUMN_COLORS` array of 5 names (`powder-blue`, `pale-sky`, `light-cyan`, `frozen-water`, `turquoise`), each backed by a hand-authored OKLCH scale (shades 50–950) in `client/src/index.css`.
- `server/src/validators/column.ts` duplicates the same 5-name enum for `isValidColumnColor()`, used by both the single-column PATCH route and `validateColumnBatch()` (the `/columns/batch` route).
- `ColumnView.tsx` renders swatch buttons (`COLUMN_COLORS.map(...)`), local `useState<ColumnColor | null>` seeded from `column.color`, persisted only when the settings form's Save button is clicked (same pattern as `title`/`wipLimit`/`policy`).
- Column border/bg rendering uses static Tailwind arbitrary-value classes referencing the CSS vars (`COLUMN_STYLES`), e.g. `border-[var(--color-powder-blue-200)] bg-[var(--color-powder-blue-50)]`.
- DB: `columns.color` is a loose `TEXT` column, nullable, no CHECK constraint.
- `client/src/lib/templates.ts` / `TemplatePicker.tsx` use the same 5 legacy names as static preview fixtures, posted through `/columns/batch` when a template is applied.

### Problem / Motivation
User wants more variety than 5 hardcoded named colors without hand-authoring more CSS. Wants a "shuffle" interaction — generate new candidate colors on demand — backed by a real color-generation library instead of manually writing more OKLCH scales.

### Related Areas
- `client/src/lib/columnColors.ts`, `client/src/components/ColumnView.tsx`
- `server/src/validators/column.ts`, `server/src/routes/columns.ts`
- `client/src/index.css` (existing 5 named CSS vars, kept as legacy fallback)
- `client/src/lib/templates.ts` (legacy names, untouched — see Out-of-Scope)

---

## Scope

### In-Scope
- Shuffle button (lucide `Shuffle` icon) next to the "Color" label in column settings.
- Clicking shuffle generates 5 new candidate swatches via `culori`: random hue (0–360°), lightness/chroma locked to a "bright pastel" band, clamped to sRGB gamut (`clampChroma`) — only for the column currently being edited.
- The column's currently-active color (previously saved, or just-picked earlier in this shuffle session) is always included as one of the 5 shown swatches, highlighted as selected.
- Picking a swatch updates local component state only; persists to server on Save (unchanged pattern).
- Clicking the already-selected swatch again still toggles it off to `null` (unchanged existing behavior). The "Remove color" (X) button remains as an additional explicit path to `null`.
- Colors are independent per column — shuffling/selecting on column A never changes an already-saved color on column B.
- Storage: only the border-equivalent OKLCH string is persisted (e.g. `"oklch(88% 0.09 47.3)"`); the bg-tint is derived at render time from the same hue via `culori` (higher L, lower C), not stored separately.
- Server validator (`isValidColumnColor`) becomes a dual check: valid if it matches one of the 5 legacy names, OR is a well-formed `oklch(...)` string within a loose sanity range (L 0–1, C 0–0.4, H 0–360). It does not re-enforce the tight "brand pastel" band — that band only constrains client-side generation.
- The 5 legacy named colors remain valid for both read (render) and write (PATCH/batch input) — `templates.ts` requires no changes.
- New dependency: `culori` (client-side only).

### Out-of-Scope
- Freeform hex/color-wheel manual input — shuffle is the only entry point, no manual color typing.
- Per-card colors — columns only.
- Dark mode tuning — no existing dark-mode variant for column colors, not adding one now.
- Shuffle history / undo.
- Retroactively changing a column's already-selected/saved color without the user explicitly shuffling that column.
- Migrating `client/src/lib/templates.ts` to the new OKLCH format — legacy names stay valid input, so no migration is needed there.
- Adding a `version`/optimistic-locking field to columns — none exists today (only cards have it); last-write-wins for color stays consistent with all other column fields.
- Server-side color generation (e.g. a dedicated API endpoint) — see Design Decision.

---

## Architecture Constraints

- Layers this work may touch: `client/src/lib/columnColors.ts`, `client/src/components/ColumnView.tsx`, `server/src/validators/column.ts`, `client/package.json` (new dep), `client/src/index.css` (existing 5 named colors kept as legacy fallback, not removed).
- Layers this work must NOT touch: DB schema (no migration needed — `color` is already `TEXT`), card-level color logic, other column fields (`wipLimit`/`policy`/`isDone`), `client/src/lib/templates.ts`.
- Patterns that must be followed: OKLCH color space (per `docs/pocket/rule/creative-brief.md`), existing two-tone rendering (border ~shade-200-equivalent lightness, bg ~shade-50-equivalent lightness), local-state-until-Save (same as other column settings fields), NodeNext ESM `.js` import extensions on server, Biome lint rules, React object-form `style={{...}}` for inline styles (not string-templated).
- Architecture validation result: **PASS** (see Phase 6 checklist — all items confirmed, no conditional items).

---

## Dependencies

### Existing (to leverage)
- None directly reused for color generation — this introduces the first color-manipulation dependency in the client.

### New (proposed)
- `culori` — OKLCH-native color library. Provides `random('oklch', {l, c, h})` for constrained random generation, `clampChroma()` for sRGB gamut safety, `formatCss()`/`formatHex()` for output, and parsing/conversion for deriving the bg-tint from a stored border color at render time.
  - Alternatives rejected: `chroma-js` (less OKLCH-native, larger surface for what's needed here), `colorjs.io` (viable but less code-snippet coverage / less battle-tested per context7 lookup), hand-rolled OKLCH math + gamut clamping (reinventing a solved, non-trivial problem — gamut mapping is fiddly to get right by hand).

---

## Stories + Scenarios

### Story: Shuffle to a new column color
> As a board member customizing column appearance, I want to shuffle through randomly generated pastel colors and pick one per column, so that columns can have distinct, vivid, non-hardcoded colors instead of a fixed small palette.

**Rule 1: Shuffle generates 5 brand-safe pastel candidates**
- Example A: Column has no color → open settings → 5 fresh random swatches, none highlighted.
- Example B: Random hue lands where the target chroma isn't displayable in sRGB → `clampChroma` pulls chroma down, swatch still renders a valid, visibly pastel color (not broken/undefined).

```gherkin
Scenario: Open settings for column with no color
  Given column.color is null
  When user opens column settings
  Then the picker shows 5 freshly generated pastel swatches
  And none of them is highlighted as selected

Scenario: Random hue hits the gamut edge
  Given the color generator picks a hue where the target chroma is out of sRGB gamut
  When the shuffle generates that swatch
  Then clampChroma pulls the chroma down until it's in-gamut
  And the swatch still renders as a valid bright pastel color
```

**Rule 2: The active color is always pinned as one of the 5**
- Example C: Column has a saved color → reopen settings → that color appears as one of the 5, highlighted.
- Example D: User shuffles once, picks a new color, shuffles again → the just-picked color (not the original saved one) is what's pinned this time.

```gherkin
Scenario: Reopen settings for a column with a saved color
  Given column.color = "oklch(88% 0.09 47.3)" (previously saved)
  When user opens column settings
  Then one of the 5 swatches equals that stored color and is highlighted selected
  And the other 4 are freshly random

Scenario: Repeated shuffle before save
  Given the picker is open and swatch showing color X is currently selected
  When user clicks shuffle
  Then the 5 new swatches are [color X pinned + 4 new random], X still highlighted

Scenario: Pick a new color, then shuffle again
  Given user shuffled once and then picked color Y from those results
  When user clicks shuffle a second time
  Then the 5 new swatches are [color Y pinned + 4 new random] — not the original saved color
```

**Rule 3: Selection only persists on Save, independently per column**
- Example E: Pick a swatch, click Save → that column's color updates; sibling columns untouched.
- Example F: Click the already-selected swatch again → toggles to null (same as today). X button also clears to null.

```gherkin
Scenario: Pick and save
  Given user picks color Z from the displayed swatches
  When user clicks Save
  Then column.color is persisted as the OKLCH string for Z
  And the column's border renders from that stored value; bg-tint is derived at render time from the same hue

Scenario: Sibling column unaffected
  Given column A has color "oklch(70% 0.1 30)" saved
  When user shuffles and saves a new color on column B
  Then column A's color is still "oklch(70% 0.1 30)", unchanged

Scenario: Re-click active swatch clears it
  Given a swatch is currently selected (highlighted)
  When user clicks that same swatch again
  Then color becomes null (same toggle behavior as before this feature)

Scenario: Remove color via X button
  Given column has a color set (legacy name or OKLCH string)
  When user clicks "Remove color" (X) then Save
  Then column.color is null, styling reverts to default neutral
```

**Rule 4: Legacy named colors remain valid, both read and write**
- Example G: A column already has `color = "powder-blue"` from before this feature shipped.
- Example H: A template is applied, posting the 5 legacy names through `/columns/batch`.

```gherkin
Scenario: Legacy color renders unchanged
  Given column.color = "powder-blue" (pre-existing data)
  When the board loads / column settings opens
  Then border/bg render identically to before this feature (legacy CSS var fallback)

Scenario: Saving a legacy-colored column without touching color
  Given column.color = "powder-blue" and user edits only the title, then clicks Save
  When the PATCH request re-submits the unchanged "powder-blue" value
  Then the server validator accepts it (dual check: legacy name OR OKLCH format)

Scenario: Template application still works
  Given a workspace template posts columns with legacy color names via /columns/batch
  When the batch validator runs
  Then it accepts the legacy names as before — no 400 error
```

---

## Acceptance Criteria

```
Rule: Shuffle generates 5 brand-safe pastel candidates
  ✓ Given column has no color, When settings open, Then 5 fresh random swatches shown, none selected
  ✓ Given a hue lands out of sRGB gamut for the target chroma, When generated, Then clampChroma produces a valid in-gamut pastel

Rule: The active color is always pinned as one of the 5
  ✓ Given column has a saved color, When settings reopen, Then that color is one of the 5, highlighted
  ✓ Given user shuffled and picked a new color, When shuffling again, Then the just-picked color (not the original) is pinned

Rule: Selection only persists on Save, independently per column
  ✓ Given user picks a swatch, When Save is clicked, Then only that column's color updates
  ✓ Given user clicks the already-selected swatch again, Then color toggles to null
  ✓ Given user clicks "Remove color" (X) then Save, Then color is null / default neutral

Rule: Legacy named colors remain valid, both read and write
  ✓ Given column.color = a legacy name, When rendered, Then it looks identical to before
  ✓ Given column.color = a legacy name and only title is edited, When saved, Then the PATCH validator accepts the unchanged legacy value
  ✓ Given a template posts legacy names via /columns/batch, Then the batch validator accepts them
  ✗ Given a color value that is neither a legacy name nor a well-formed oklch() string in sanity range, When submitted, Then the server rejects it (400)
```

---

## Design Decision

**Chosen option:** Option A — Client-only generation (culori end-to-end)

**Summary:** Shuffle generates candidates entirely in the browser via `culori`; the server's role is limited to format + loose sanity-range validation on Save. No new API endpoint, no server-side color generation.

**Rejected options:**
- Option B (server-generated candidates via a new `/columns/:id/shuffle-color` endpoint): rejected — adds a network round-trip for a purely cosmetic, not-yet-persisted action, and would require `culori` as a duplicated server dependency with no scenario that needs server-side control over randomness.

**Key tradeoffs accepted:**
- Server does not strictly re-enforce the "brand pastel" L/C band — it only checks structural validity + a loose sanity range. A client bypass (e.g. direct API call) could in theory persist an out-of-band OKLCH color. Accepted per explicit user decision: the tight pastel band is a client-side generation concern, not a server-enforced invariant.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Exact numeric L/C pastel band for generation | Not pinned to specific numbers in this spec — implementer derives from existing 5-color OKLCH values already in `index.css` (border ~L 85-94%, bg ~L 96-98%) as a reference band, full 360° hue | Pocket-planning/implementation should propose exact constants; low risk since it's a purely cosmetic tuning knob, easy to adjust post-hoc |

*(No blocking questions remain — all Three Amigos + edge-case-hunter clarifications were resolved before this handoff.)*

---

## Implementation Notes

- Swatch list rendering must use index-based React `key`s (0–4), not the color value itself — two random draws could coincide and collide on a color-string key.
- Derive bg-tint from the stored border color via `useMemo` keyed on the column's color value, to avoid recomputing via `culori` on every re-render (e.g. during drag-and-drop).
- Render border/bg via object-form `style={{ borderColor, backgroundColor }}` (React), not string-templated styles — consistent with existing code in `ColumnView.tsx` and avoids any CSS-injection surface.
- Server validator regex/parse for the new format should be permissive but structurally sound (must parse as `oklch(L% C H)` or equivalent culori-parseable form) — reject anything that doesn't parse, accept the rest within the loose sanity range.
- No `version`/optimistic-locking concurrency change — last-write-wins on column color stays consistent with every other column field today.

---

## Rollback Plan

- No DB migration occurred (schema unchanged), so rollback is a pure code revert.
- Revert client changes (shuffle button, culori dependency, rendering) — legacy named colors and their CSS vars are untouched/kept, so any already-saved OKLCH-string colors would simply stop being selectable via UI (but existing legacy-named columns are unaffected either way).
- Revert server validator to enum-only if needed — since legacy names remain valid throughout, this is a safe, backward-compatible rollback in either direction.
