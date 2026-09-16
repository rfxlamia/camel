# Feature-module directory convention — Execution Index

**Date:** 2026-09-16
**Spec:** docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
**Source Plan:** ../execution-plan.md
**source-sha256:** ec3518a23419d6b6fcd3b2f3854b08c831d6e54ddaa611fe455dead0f41febcf
**Total Tasks:** 6
**Total Phases:** 1

---

## Execution Flow

```
T1→T2,T6(PARALLEL)→T3,T4(PARALLEL)→T5
```

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Map data, git-diff helper, CLI stub, shared kernel folder | Phase 1 | [T1-map-data-git-diff-helper-cli-stub-shared-kernel-folder.md](tasks/T1-map-data-git-diff-helper-cli-stub-shared-kernel-folder.md) | [prereq] [test-risk] |
| T2 | Placement allowlist | Phase 1 | [T2-placement-allowlist.md](tasks/T2-placement-allowlist.md) | [depends: T1] |
| T3 | 300-line ceiling on touch | Phase 1 | [T3-300-line-ceiling-on-touch.md](tasks/T3-300-line-ceiling-on-touch.md) | [depends: T2] [test-risk] |
| T4 | Public API and one-way import walls | Phase 1 | [T4-public-api-and-one-way-import-walls.md](tasks/T4-public-api-and-one-way-import-walls.md) | [depends: T2] [parallel: T3] |
| T5 | Wire npm, Makefile, and CI | Phase 1 | [T5-wire-npm-makefile-and-ci.md](tasks/T5-wire-npm-makefile-and-ci.md) | [depends: T3, T4] [test-risk] |
| T6 | ADR and agent convention docs | Phase 1 | [T6-adr-and-agent-convention-docs.md](tasks/T6-adr-and-agent-convention-docs.md) | [depends: T1] [parallel: T2] |
