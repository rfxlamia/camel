# Complete shared 400 validation (#197, #198, #199) — Execution Index

**Date:** 2026-10-09
**Spec:** docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
**Source Plan:** ../execution-plan.md
**source-sha256:** a42a696b3338c74a4b4a96513ed26251d61123fa95a7b348db865ff1ba82ac0c
**Total Tasks:** 16
**Total Phases:** 5

---

## Execution Flow

```
T1→T2,T3,T4(PARALLEL)→T5,T6,T7(PARALLEL)→T8→T9→T10→T11→T12,T13(PARALLEL)→T14→T15→T16
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Add legacyIntegerParam primitive (T1, T2, T3, T4)
- **Phase 2:** [phase-2.md](phase-2.md) — Migrate auth routes (router.ts, oauth.ts) (T5, T6, T7)
- **Phase 3:** [phase-3.md](phase-3.md) — Implement inline-400 AST detection (scanSource) (T8, T9, T10)
- **Phase 4:** [phase-4.md](phase-4.md) — Add integerIdArray and dedupe workspaceIdParam (T11, T12, T13)
- **Phase 5:** [phase-5.md](phase-5.md) — Single strict workspace-id parser and tighten lenient routes (T14, T15, T16)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Add legacyIntegerParam primitive | Phase 1 | [T1-add-legacyintegerparam-primitive.md](tasks/T1-add-legacyintegerparam-primitive.md) | [prereq] |
| T2 | Migrate agent board routes (read-routes.ts, routes.ts) | Phase 1 | [T2-migrate-agent-board-routes-read-routes-ts-routes-ts.md](tasks/T2-migrate-agent-board-routes-read-routes-ts-routes-ts.md) | [depends: T1] |
| T3 | Migrate agent ticket-intake routes (routes.ts, submit.ts) | Phase 1 | [T3-migrate-agent-ticket-intake-routes-routes-ts-submit-ts.md](tasks/T3-migrate-agent-ticket-intake-routes-routes-ts-submit-ts.md) | [depends: T1] |
| T4 | Migrate chat routes (routes.ts, message-stream.ts) | Phase 1 | [T4-migrate-chat-routes-routes-ts-message-stream-ts.md](tasks/T4-migrate-chat-routes-routes-ts-message-stream-ts.md) | [depends: T1] |
| T5 | Migrate auth routes (router.ts, oauth.ts) | Phase 2 | [T5-migrate-auth-routes-router-ts-oauth-ts.md](tasks/T5-migrate-auth-routes-router-ts-oauth-ts.md) | [depends: T2, T3, T4] |
| T6 | Migrate realtime SSE workspace-id 400 (sse.ts) | Phase 2 | [T6-migrate-realtime-sse-workspace-id-400-sse-ts.md](tasks/T6-migrate-realtime-sse-workspace-id-400-sse-ts.md) | [depends: T2, T3, T4] |
| T7 | Migrate notifications and activity 400s | Phase 2 | [T7-migrate-notifications-and-activity-400s.md](tasks/T7-migrate-notifications-and-activity-400s.md) | [depends: T2, T3, T4] |
| T8 | Implement inline-400 AST detection (scanSource) | Phase 3 | [T8-implement-inline-400-ast-detection-scansource.md](tasks/T8-implement-inline-400-ast-detection-scansource.md) | [depends: T5, T6, T7] |
| T9 | Add the guard CLI, tree walk and allowlist | Phase 3 | [T9-add-the-guard-cli-tree-walk-and-allowlist.md](tasks/T9-add-the-guard-cli-tree-walk-and-allowlist.md) | [depends: T8] |
| T10 | Wire the guard into package.json, Makefile, CI and CLAUDE.md | Phase 3 | [T10-wire-the-guard-into-package-json-makefile-ci-and-claude-md.md](tasks/T10-wire-the-guard-into-package-json-makefile-ci-and-claude-md.md) | [depends: T9] |
| T11 | Add integerIdArray and dedupe workspaceIdParam | Phase 4 | [T11-add-integeridarray-and-dedupe-workspaceidparam.md](tasks/T11-add-integeridarray-and-dedupe-workspaceidparam.md) | [depends: T10] |
| T12 | Extract tracker reference parsers and use integerIdArray | Phase 4 | [T12-extract-tracker-reference-parsers-and-use-integeridarray.md](tasks/T12-extract-tracker-reference-parsers-and-use-integeridarray.md) | [depends: T11] |
| T13 | Share the lock-reference extractor and pin create rejection | Phase 4 | [T13-share-the-lock-reference-extractor-and-pin-create-rejection.md](tasks/T13-share-the-lock-reference-extractor-and-pin-create-rejection.md) | [depends: T11] [test-risk] |
| T14 | Single strict workspace-id parser and tighten lenient routes | Phase 5 | [T14-single-strict-workspace-id-parser-and-tighten-lenient-routes.md](tasks/T14-single-strict-workspace-id-parser-and-tighten-lenient-routes.md) | [depends: T12, T13] |
| T15 | Unify username wording | Phase 5 | [T15-unify-username-wording.md](tasks/T15-unify-username-wording.md) | [depends: T14] |
| T16 | Verify client parsing; draft issue comment and PR text | Phase 5 | [T16-verify-client-parsing-draft-issue-comment-and-pr-text.md](tasks/T16-verify-client-parsing-draft-issue-comment-and-pr-text.md) | [depends: T14, T15] |
