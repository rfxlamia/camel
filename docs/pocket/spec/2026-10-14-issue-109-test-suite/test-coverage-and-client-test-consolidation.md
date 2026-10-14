# Issue #109 — Test Coverage Baseline and Client Test Consolidation

**Date:** 2026-10-14
**Status:** draft
**Author:** brainstorm session
**Spec path:** docs/pocket/spec/2026-10-14-issue-109-test-suite/test-coverage-and-client-test-consolidation.md

---

## Summary

Establish an informational, all-source coverage baseline before consolidating any client tests, and publish separate CI coverage reports for client unit tests, server unit tests, and server DB integration tests. Then selectively consolidate only client test setup/assertions whose redundancy is verified, preserving unique regression checks and the named server keep-list. CI integration gating is already marked complete in Issue #109 and is not reopened here.

## Context

### Current State

- The root `npm test` runs guards, server tests, client tests, and feature-module tests. Workspace tests are `vitest run`; DB integration is separately gated behind `RUN_INTEGRATION`.
- Client Vitest config is `client/vitest.config.ts` (jsdom, `src/**/*.test.{ts,tsx}`, shared `src/shared/testSetup.ts`). Server config is `server/vitest.config.ts` (`src/**/*.test.ts`).
- `package-lock.json` resolves `vitest` to `4.1.10`; client and server manifests have different semver declarations, but no duplicate workspace Vitest versions resolve. Neither workspace declares an installed coverage provider.
- `.github/workflows/ci.yml` already has distinct `client-unit`, `server-unit`, `db-integration`, and optional `llm-integration` jobs. DB CI provisions Postgres 16 and Redis 7 and selects integration tests using `scripts/list-integration-tests.mjs`. LLM execution is conditional on `ANTHROPIC_API_KEY`.
- Most named candidate test files still exist, although some issue paths have moved: `TrackerRow.test.tsx` is under `client/src/features/tracker/`; `api.test.ts` and `api.tracker.test.ts` are at `client/src/`.
- The API facade was extracted in `74f3c54`. Current API tests cover different concerns: `api.test.ts` includes the facade surface, request boundary, and board serialization; `api.tracker.test.ts` exercises tracker API behavior. Existing evidence does not establish that these suites reassert the same serialization.

### Problem / Motivation

No coverage is currently measured or enforced, so maintainers cannot make evidence-backed decisions about consolidation. Several client suites are large and contain repeated API mock scaffolding, but line count is not proof of redundant assertions. The issue status update explicitly places coverage measurement before consolidation and records the high-regression-value server suites to retain.

### Related Areas

- `client/vitest.config.ts`, `client/src/shared/testSetup.ts`
- `server/vitest.config.ts`
- `.github/workflows/ci.yml`, `scripts/list-integration-tests.mjs`
- Client candidates: `TrackerPage.test.tsx`, `MyWorkDetailSheet.test.tsx`, `api.test.ts`, `api.tracker.test.ts`, `TrackerProjectPage.test.tsx`, `TrackerCreateModal.test.tsx`, `TrackerRow.test.tsx`, `BoardPage.test.tsx`, `MyWorkPage.test.tsx`, and focus/board context suites (overlap to be verified).
- Server keep-list: `server/src/routes/work-item-unified.integration.test.ts`; `server/src/routes/work-item-{phase,project,member}-concurrency.integration.test.ts`; `server/src/modules/board/cards-mutations.integration.test.ts`; `server/src/modules/agent/llm.test.ts`; security/core suites `server/src/__tests__/{csrf,security-headers,timeout,config,file-validator}.test.ts`.

## Scope

### In-Scope

- Configure Vitest coverage for client and server using a provider compatible with the lockfile-resolved Vitest version.
- Include production `.ts`/`.tsx` source under each workspace `src/` in each applicable report, including unimported source as uncovered; exclude test files, generated files, and test-only helpers using explicit, reviewed patterns.
- Upload distinct informational reports from client unit, server unit, and server DB integration CI lanes. No percentage threshold is introduced.
- Make test failure, coverage-generation failure, skipped lanes, and absent optional LLM credentials distinguishable. Artifact upload must not turn a failed test job green.
- Capture the initial successful reports for the three requested lanes before changing client test assertions/setup (conservative sequencing recommendation; see assumptions).
- After baseline capture, inspect and selectively consolidate duplicated client API mock setup or overlapping test cases while retaining every unique behavior assertion.
- Keep the named high-regression server tests intact and selectable in their existing CI lanes.

### Out-of-Scope

- Reworking the completed DB/LLM CI gating behavior.
- Coverage thresholds or failing builds based on percentage.
- Merging server unit and DB integration coverage into one indistinguishable result.
- Requiring LLM coverage in the baseline; its secret-dependent lane remains optional.
- Broadly adding tests for the old untested-file audit, deleting tests based on size, or changing React version.
- Treating coverage percentages as proof of assertion equivalence.

## Architecture Constraints

- **Layers this work may touch:** client/server Vitest configs and package manifests/lockfile; existing test helpers where repeated setup is verified; CI workflow and narrowly scoped artifact/report scripts if needed.
- **Layers this work must NOT touch:** product runtime code, DB schema/migrations, API behavior, or already-completed CI selection/gating logic except minimal invocation needed to collect and upload lane-specific reports.
- **Patterns that must be followed:** preserve workspace-scoped test commands and default local behavior; use the existing CI lanes and their path conditions; maintain explicit integration gates; use source-accurate all-file include/exclude patterns; keep feature test helpers within existing conventions; keep action references pinned consistently with current workflow conventions.
- **Architecture validation result:** PASS at the design level. The proposed source roots and explicit test/generated/test-helper exclusions are grounded in the repository inventory and exact-version Vitest coverage docs. The implementation must still test its concrete glob patterns and failure/report behavior; no package has been installed and no CI behavior has been exercised. Consolidation targets remain conditional on assertion-by-assertion inspection.

### Validation Evidence

| Claim or constraint | Codebase evidence (paths/symbols) | External source (URL, version/date) | Result and finding |
|---|---|---|---|
| CI already separates the needed lanes and DB dependencies | `.github/workflows/ci.yml`: `client-unit`, `server-unit`, `db-integration`, `llm-integration`; DB job provisions Postgres 16/Redis 7 and runs selected tests | N/A | PASS — add reporting to these lanes rather than changing completed gating. |
| DB integration file selection is an existing boundary | `scripts/list-integration-tests.mjs`; `server/package.json` integration scripts | N/A | PASS — DB coverage is the selected DB lane's tests, not the full suite. |
| The lockfile resolves one Vitest version and no coverage provider | `package-lock.json` (`node_modules/vitest` = 4.1.10); client/server manifests; no installed `@vitest/coverage-v8` package entry | npm registry metadata for `@vitest/coverage-v8@4.1.10`, accessed 2026-10-14: https://registry.npmjs.org/@vitest%2fcoverage-v8/4.1.10 — peer dependency is exactly `vitest@4.1.10` (browser peer optional) | PASS — registry metadata confirms exact peer compatibility for the proposed version; package remains uninstalled until implementation approval. |
| Vitest supports explicit untested-source inclusion and report-on-failure | Workspace configs include `src` tests but no coverage config. Exact v4.1.10-tagged docs define `coverage.include`, `coverage.exclude`, `coverage.reportsDirectory`, `coverage.reporter`, and `coverage.reportOnFailure` (default false). | Official version-tagged source: https://github.com/vitest-dev/vitest/blob/v4.1.10/docs/config/coverage.md and https://github.com/vitest-dev/vitest/blob/v4.1.10/docs/guide/coverage.md; accessed 2026-10-14. It states default report includes only imported files; `coverage.include` is needed for untested files; `reportOnFailure` generates reports when tests fail. | PASS — relevant Vitest behavior is verified against the lockfile version. CI preservation of failed test status must still be tested in implementation. |
| V8 provider is supported for this runtime and version | CI uses Node 22 (`actions/setup-node` in `.github/workflows/ci.yml`) | Vitest official guide https://vitest.dev/guide/coverage.html (accessed 2026-10-14; page last updated 2026-09-29), plus exact provider peer metadata above. The guide recommends V8 for Node/V8 runtimes. | PASS — V8 is a viable provider; exact package peer version is verified. |
| Artifacts can be lane-specific and retained under repository policy | Current workflow has no coverage artifact upload. | GitHub Actions official docs https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts (accessed 2026-10-14); `actions/upload-artifact` v4 README https://github.com/actions/upload-artifact/blob/v4/README.md (accessed 2026-10-14). Docs recommend explicit names, document retention-days and repository default retention, and say repeated same-name uploads in one run fail unless overwritten. GitHub expressions docs https://docs.github.com/en/actions/learn-github-actions/expressions (accessed 2026-10-14) document `always()` for steps/jobs after failure/skip. | PASS — lane/run/attempt identity avoids same-name collisions; use a failure-aware finalization step. Repository-default retention remains an assumption pending approval. |
| A universal API mock helper is justified by current client evidence | `client/src/shared/testSetup.ts` is a focused global canvas shim. `TrackerPage.test.tsx`, `TrackerProjectPage.test.tsx`, `TrackerCreateModal.test.tsx`, `MyWorkDetailSheet.test.tsx`, `BoardPage.test.tsx`, and `MyWorkPage.test.tsx` have distinct API/context mock surfaces and reset conventions. Vitest v4.1.10 mocking docs describe hoisted `vi.mock` and require mock state reset/restore. | https://github.com/vitest-dev/vitest/blob/v4.1.10/docs/guide/mocking.md (accessed 2026-10-14): `vi.mock` is hoisted before imports; mock state should be cleared/restored. | UNVERIFIED as a general proposition — current inspection does not justify a universal factory. Recommended design avoids one and permits a small helper only for an exactly matched repeated subset with equivalent isolation. |
| The `api.test.ts` and `api.tracker.test.ts` assertions duplicate serialization | `client/src/api.test.ts` checks facade/request boundary and Board create metadata; `client/src/api.tracker.test.ts` checks tracker paths and payloads. `client/src/shared/apiFacade.test.ts` verifies real imports without API/feature mocks; recent `74f3c54` extracted `client/src/features/{board,tracker}/*Api.ts`. | N/A | UNVERIFIED — excerpts do not establish overlapping serialization assertions. Preserve `apiFacade.test.ts` real-import smoke coverage and inspect exact assertions before any consolidation; do not state the issue claim is false. |
| Coverage denominator design and test-only exclusions | Read-only glob-equivalent inventory: client `src` has 407 `.ts/.tsx` files and server `src` has 528; total 935. `*.test.ts(x)` excludes 130 client and 225 server files (355 total). Exact named helper/generated exclusions remove 7 more client and 28 more server files, leaving 270 client and 275 server source files (545 total). No `.d.ts` files or `generated/` directories were found; generated `server/src/db/types.ts` is identified by its generated header. Additional test-only modules are confirmed by test callers/imports: client `src/shared/testSetup.ts`, `src/features/my-work/myWorkTestSupport.ts`, `src/attachments-system.harness{,-adapters}.ts`, and `src/pages/myWorkPage.integration.{harness,navigation,states}.tsx`; server `src/db/{scratch-pool-test-support,scratch-schema-test-support,work-item-merge.test-support,work-item-merged-app.test-support,work-item-merged-fixture.test-support}.ts`; `src/modules/board/{attachments-system.create-support,attachments-system.support,card-attachments-upload.support,card-attachments.integration.support,card-create-attachments.test-support,card-create-attachments.validation,card-create-attachments.cleanup,card-create-attachments.creation,columns-is-done-remap.test-support,columns-is-done-remap.basic.scenarios,columns-is-done-remap.edge.scenarios,columns-is-done-remap.failure.scenarios}.ts`; `src/modules/my-work/{my-work-test-support,my-work-pagination-test-support,my-work-status-test-support,my-work-pagination-assertions,my-work.integration.shared,my-work.integration.fixtures,my-work.integration.mutations,my-work.integration.rollup,my-work.integration.authorization}.ts`; and `src/routes/cards-identity.integration.helpers.ts`. These are imported by tests or test-only scenario registration. Applying those exclusions leaves no non-test source importing Vitest. Production examples remain included: `server/src/core/position.ts`, `server/src/db/migrate.ts`, `server/src/scripts/check-key-collisions.ts`, `server/src/validators/schemas.ts`, `client/src/features/board/BoardContext.tsx`, and `client/src/features/tracker/trackerApi.ts`. | Vitest v4.1.10 `coverage.include`/`coverage.exclude` docs above | PASS for the proposed source inventory/exclusion design, based on enumeration, exact helper imports/callers, generated header, and representative production inclusions. Concrete coverage globs/report output remain implementation acceptance checks. Do not blanket-exclude helper/validation/scenario directories; similarly named production code must remain included. |

## Dependencies

### Existing (to leverage)

- Vitest — client and server test runners; lockfile-resolved version `4.1.10`.
- Existing GitHub Actions lanes — add the proposed `actions/upload-artifact` reporting steps without introducing a coverage service. The current workflow has no artifact-upload action.

### New (proposed)

- `@vitest/coverage-v8@4.1.10` in client and server dev dependencies — exact peer compatibility with locked Vitest; alternative `@vitest/coverage-istanbul@4.1.10` is available but not preferred because V8 is recommended for Node and avoids source instrumentation. No package changes yet.

## Stories + Scenarios

### Story: Establish meaningful coverage baselines

> As a maintainer, I want distinct all-source reports for the routinely exercised CI lanes, so I can see what the current tests cover before deciding what to consolidate.

**Rule 1: Every report has a reproducible production-source denominator.**
- Example A: An untested production source file under `src/` is listed with zero coverage.
- Example B: A test file, generated DB type, or test-only helper is excluded using an explicit pattern; a production module is not excluded merely because it is small or helper-shaped.

**Rule 2: Reports are lane-specific and informational.**
- Example C: Client unit, server unit, and selected DB integration runs upload separate reports.
- Example D: DB coverage does not get merged invisibly with server-unit coverage; no percentage threshold fails CI.

```gherkin
Scenario: COV-01 — Client unit report includes uncovered production source
  Given the client-unit CI lane runs
  And client/src contains a production TypeScript source file not imported by any test
  When the test run completes successfully with coverage enabled
  Then the report lists that file with zero coverage
  And excludes test files, generated files, and explicitly identified test-only helpers
  And uploads a client-specific coverage artifact

Scenario: COV-02 — Server unit and DB reports remain distinct
  Given the server-unit and DB-integration lanes both run
  When each lane completes successfully
  Then each uploads an all-server-source coverage report
  And the server-unit report contains only server-unit test execution
  And the DB report contains only the selected integration tests
  And neither overwrites or silently merges with the other

Scenario: COV-03 — Coverage remains informational
  Given a lane produces a valid report below any chosen percentage
  When CI evaluates the job
  Then no percentage threshold causes failure
  And test assertion failures still fail the lane
```

**Rule 3: A missing or partial report cannot be confused with a successful baseline.**
- Example E: A test fails after collection starts and a partial report exists; upload it but retain failed job status.
- Example F: A path-filtered or secret-gated lane does not run; mark it skipped/not-run, not zero coverage.

```gherkin
Scenario: COV-04 — Failed tests preserve partial coverage without masking failure
  Given tests in a coverage-enabled lane fail after producing a partial report
  When CI runs its artifact-finalization step
  Then the partial report is uploaded when available
  And the test job remains failed

Scenario: COV-05 — No report is available after failure
  Given test execution or coverage collection fails before a report is generated
  When CI finalizes the lane
  Then the missing report is made explicit
  And the lane remains failed and is not described as a completed baseline

Scenario: COV-06 — A skipped lane is not zero coverage
  Given a lane is skipped by the existing path filter
  Or optional LLM tests are skipped because ANTHROPIC_API_KEY is unavailable
  When the workflow completes
  Then no artifact implies that the lane ran with zero coverage
  And the skip is distinguishable from a generated report
```

**Rule 4: Local default behavior is unchanged.**

```gherkin
Scenario: COV-07 — Existing local test command keeps its current semantics
  Given a developer runs the existing default npm test command
  When client and server tests execute
  Then database integration remains environment-gated
  And adding coverage support alone does not make the default local command run DB or LLM integration tests
```

### Story: Consolidate only verified client test redundancy

> As a maintainer, I want repeated client test setup consolidated after the coverage baseline exists, so the suite is easier to maintain without losing regression signal.

**Rule 1: Size alone never justifies removal or consolidation.**
- Example A: Two files repeat genuinely identical API mock wiring; extract that wiring and leave their component-specific assertions in place.
- Example B: A large file has unique behavior assertions; retain those assertions even if the file stays large.

```gherkin
Scenario: CONS-01 — Extract verified repeated mock setup only
  Given current client candidate files use equivalent API mock setup
  And the equivalence is confirmed by inspecting current code and assertion behavior
  When the setup is extracted into a narrowly scoped shared test helper
  Then each test retains its unique behavior assertions
  And test isolation/reset behavior remains equivalent

Scenario: CONS-02 — Preserve unique assertions and leave non-overlapping candidates intact
  Given a large candidate contains unique regression assertions
  Or two candidate files use materially different mocks or seams
  When consolidation is considered
  Then unique assertions remain
  And the tests are not merged or deleted based solely on file size
```

**Rule 2: The baseline precedes assertion/setup changes; server keep-suites stay protected.**

```gherkin
Scenario: CONS-03 — Capture baseline before client consolidation
  Given coverage support has been added
  When the initial baseline is recorded
  Then successful client-unit, server-unit, and DB-integration artifacts exist from before client test consolidation begins

Scenario: CONS-04 — Keep server regression suites intact
  Given coverage setup or client test consolidation is in progress
  When the existing server keep-list suites are selected by their current CI lanes
  Then they remain present and selectable
  And no unique concurrency, unified work-item, board-mutation, pure-logic, or security regression assertions are removed
```

## Acceptance Criteria

```text
ACCEPTANCE CRITERIA — Issue #109 remaining test-suite work
Date: 2026-10-14 | Scope confirmed: yes (server unit + DB reports separately)

Rule: All-source, informational coverage
  ✓ Given client-unit runs, When coverage is generated, Then all client/src production TS/TSX files are represented including untested files, with tests/generated/test-only helpers excluded explicitly
  ✓ Given server-unit runs, When coverage is generated, Then its report is distinct from DB integration coverage and includes untested server production source
  ✓ Given DB integration runs, When selected integration tests complete, Then a distinct report represents that lane only
  ✓ Given any report is below an arbitrary percentage, When CI completes, Then no threshold fails the job

Rule: CI truthfulness and local compatibility
  ✓ Given a lane is skipped by path filters or optional LLM credentials are absent, When CI completes, Then skipped/not-run is distinct from zero coverage
  ✓ Given tests fail after producing partial coverage, When artifacts finalize, Then partial reports are uploaded if available and test status remains failed
  ✗ Given coverage generation fails or no report exists, When CI completes, Then the lane must not claim a completed baseline or hide the failure
  ✓ Given a developer runs default npm test, When it executes, Then DB integration remains gated and default local semantics are unchanged

Rule: Baseline before consolidation
  ✓ Given coverage configuration is ready, When client consolidation begins, Then successful client-unit, server-unit, and DB-integration baseline artifacts were collected first (conservative sequence proposed for approval)
  ✓ Given duplicate setup/assertion overlap is not demonstrated, When a candidate is considered, Then it is left intact regardless of file size
  ✓ Given repeated setup is confirmed and extracted, When tests are rerun, Then unique assertions and isolation behavior remain
  ✓ Given any server keep-list suite is selected, When the CI lane runs, Then the suite remains intact and selectable

OPEN QUESTIONS (risks if unresolved):
  - Which exact client files have assertion overlap? → assumed: no overlap is established yet; defer each selection until direct assertion comparison after baseline; risk: fewer consolidation targets may qualify than issue list implies.
  - Do the proposed source exclusions represent the intended production denominator? → inventory lists exact generated/test-only candidates and their test callers, but no final patterns were trialed; risk: denominator may be inflated or production code omitted if implementation patterns are inaccurate.
  - Must all three successful reports exist before any consolidation? → proposed conservative gate based on issue wording (“coverage measurement before deleting anything”), not separately confirmed; risk: may add a CI-cycle delay, but avoids changing tests before a cross-lane baseline.
  - Artifact retention duration? → assumed: repository's GitHub Actions default; risk: baseline may expire sooner than desired.

OUT-OF-SCOPE (remind pocket-planning):
  - No coverage thresholds; no React upgrade; no completed CI-gating redesign; no blanket old-audit tests; no coverage-driven deletion without assertion review; no mandatory LLM baseline.
```

## Design Decision

**Chosen option:** Option A — Add separate V8 reports to existing CI lanes.

**Summary:** Use `@vitest/coverage-v8@4.1.10` to match the lockfile-resolved Vitest; enable report generation in existing client-unit, server-unit, and DB-integration jobs; use explicit source include/exclude patterns; upload distinct lane/run/attempt artifacts. Coverage percentages remain informational. After an initial baseline, consolidate only a specific repeated mock/setup subset whose behavior and reset isolation match.

**Options mapped to scenarios:**
- **Option A — Existing-lane reports (recommended):** COV-01–COV-07 and CONS-01–CONS-04. It fits existing lane triggers and DB resources. Risk: coverage cost is added to normal CI; explicit include/exclude globs need testing.
- **Option B — Dedicated coverage workflow:** can satisfy COV-01–COV-07 and CONS-01–CONS-04 if consolidation still follows the baseline, but path-filtered runs may leave reports absent and duplicating DB setup/test selection creates drift. It adds suite runtime/cost and does not preserve semantics as directly as instrumenting current jobs.
- **Option C — One merged server report:** can partially satisfy COV-01/COV-03 but fails COV-02 because unit and DB signal are no longer distinguishable; rejected given the user's explicit lane choice.

**Rejected options:**
- No measurement (current state): fails COV-01/COV-02/CONS-03 and the issue's measurement goal.
- Universal shared API mock factory: not justified by inspected evidence; prefer narrowly verified reusable subsets whose reset/isolation behavior is equivalent.

**Key tradeoffs accepted:**
- Coverage adds runtime and artifact size to existing CI lanes.
- Exact denominator patterns need an implementation test against the inventory; the source-scope design is validated, but report output and glob behavior remain implementation acceptance checks.
- Coverage measures executed source, not assertion quality; consolidation still needs assertion-level review.
- LLM remains optional and is not included in the required baseline.

## Independent Review Record

- **Edge-case hunter review 1:** Needs Clarification. It identified ambiguity in the source denominator, skipped-lane representation, partial-report acceptance, artifact identity/retention, and whether baseline artifacts must precede consolidation.
- **Focused edge-case hunter review 2:** Clear after scenarios defined production source scope, all-source zero coverage, lane skip/report distinction, partial-report behavior, artifact identity, default local semantics, baseline sequencing, and assertion preservation. No blocking scenario ambiguity remained. Its non-blocking recommendation was to keep DB selected tests and server keep-suites tied to current CI selections.
- Review revisions are reflected in the Stories + Scenarios and Acceptance Criteria above. The source exclusion design is grounded in the repository inventory; concrete config globs and generated report output remain implementation acceptance checks.

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|---|---|---|
| How to report server lanes? | User selected separate server-unit and DB-integration artifacts. | Combining them would hide regression signal by lane. |
| Which files may be consolidated? | No file is pre-approved for deletion; inspect current duplication after baseline. | The older issue list may be stale after API facade extraction. |
| Is all-three baseline-before-consolidation mandatory? | Conservative proposal based on “coverage before deleting anything”; approval requested. | Adds a sequencing/CI delay if issue owner intended a narrower baseline gate. |
| Artifact retention? | Use repository default unless explicitly chosen during planning. | Baseline artifacts may expire under repository policy. |

## Implementation Notes

- Use `src/**/*.{ts,tsx}` as the inclusion scope in each workspace and exclude `**/*.test.ts`, `**/*.test.tsx`, generated `server/src/db/types.ts`, plus the exact test-only helper/support files listed in the denominator evidence row. The read-only inventory leaves 270 client and 275 server files after these exclusions, with no source importing Vitest and representative production routes/scripts/migrations/features still included. Do not exclude by broad directory or vague suffix. Context7 was not used; version-dependent findings were checked against official Vitest v4.1.10-tagged sources.
- The current client API tests do not prove the issue's claimed duplicate serialization. Re-check after coverage support and before deciding whether API tests should be merged or split.
- The per-file API/context mocks differ in module shape and reset behavior. Prefer no global shared mock factory unless a specific repeated subset is demonstrated and can preserve Vitest hoisting/isolation behavior.
- Upload only a report that exists; use an always-run finalization path where supported, but never make artifact upload the source of test success.
- Run baseline collection on CI events that trigger all three existing lanes; path-filtered skips are not reports.

## Rollback Plan

- Revert the coverage provider/configuration and CI artifact steps; no runtime product code or database migration is involved.
- Remove any narrowly extracted client test helper and restore its prior inline setup if it causes isolation or assertion regressions.
- Keep the baseline artifacts as informational history until their normal repository retention expires.
