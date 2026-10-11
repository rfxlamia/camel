# Global Agent Spend Kill Switch — Execution Index

**Date:** 2026-10-10
**Spec:** `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`
**Source Plan:** ../execution-plan.md
**source-sha256:** dc8d2e491e196f5abb0cd4385154ba57ccd1d5beb17beb22e3d07eeff2cf83c4
**Total Tasks:** 6
**Total Phases:** 1

---

## Execution Flow

```
T1→T2,T6(PARALLEL)→T3,T4,T5(PARALLEL)
```

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Define startup config and shared spend guard | Phase 1 | [T1-define-startup-config-and-shared-spend-guard.md](tasks/T1-define-startup-config-and-shared-spend-guard.md) | [prereq] |
| T2 | Guard agent spend entrances before side effects | Phase 1 | [T2-guard-agent-spend-entrances-before-side-effects.md](tasks/T2-guard-agent-spend-entrances-before-side-effects.md) | [depends: T1] |
| T3 | Map agent guard errors to stable HTTP 503 | Phase 1 | [T3-map-agent-guard-errors-to-stable-http-503.md](tasks/T3-map-agent-guard-errors-to-stable-http-503.md) | [depends: T2] |
| T4 | Reject chat send and retry before streaming | Phase 1 | [T4-reject-chat-send-and-retry-before-streaming.md](tasks/T4-reject-chat-send-and-retry-before-streaming.md) | [depends: T2] [test-risk] |
| T5 | Guard ticket extraction but preserve classifier question | Phase 1 | [T5-guard-ticket-extraction-but-preserve-classifier-question.md](tasks/T5-guard-ticket-extraction-but-preserve-classifier-question.md) | [depends: T2] [parallel: T4] |
| T6 | Wire production Compose env and operator runbook | Phase 1 | [T6-wire-production-compose-env-and-operator-runbook.md](tasks/T6-wire-production-compose-env-and-operator-runbook.md) | [depends: T1] [parallel: T2] |
