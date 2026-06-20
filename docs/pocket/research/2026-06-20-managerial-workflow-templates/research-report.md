# Research Report — Managerial Workflow Templates for Camel

- **Date:** 2026-06-20
- **Verdict:** Confirmed
- **Confidence:** Medium

## Assumption tested

"There exist repetitive managerial workflows that can be identified from industry research + codebase analysis, and are viable candidates for new agent templates in Camel for small dev teams using kanban."

**Disconfirming observation:** No repetitive managerial workflows found that apply to small dev teams, OR workflows found are too unique/contextual to become generic templates.

## Methods used

1. **Verbalized Sampling** (elicitation) — Distributed candidate managerial workflows with probability estimates based on industry research
2. **Source Triangulation** (triangulation) — Cross-checked findings across 6+ independent sources: Atlassian, Monday.com, Jira/IBM, Capterra, Breeze, Monograph, plus codebase analysis
3. **Counterexample Hunt** (adversarial) — Refutation method: searched for cases where managerial workflows cannot be automated; identified limitations (static rules fail in dynamic environments, 42% of PM tasks can't be automated per Unito)

## Evidence

| Finding | Source | Supports / Refutes |
|---------|--------|--------------------|
| 54% of managers use AI for risk management, 53% for task automation | Capterra 2024 Survey | Supports |
| Status reporting, task assignment, meeting notes are top repetitive workflows | Atlassian, Monday.com, IBM, Breeze (6+ sources) | Supports |
| Automation saves 5-10 hours/week on administrative tasks | Multiple industry sources | Supports |
| 80% of PM tasks expected to be automated by 2030 | Gartner prediction (single source) | Supports (weak) |
| 42% of project management tasks cannot be automated | Unito research | Refutes (partial) |
| Static automation rules fail in dynamic project environments | Celoxis, Rocketlane | Refutes (partial) |
| Camel has 1 template (research-report) but no managerial templates | `server/src/agent/templates.ts` | Supports (gap exists) |
| Camel has flow metrics (cycle time, throughput) and activity feed | `server/src/core/metrics.ts`, `card_events` table | Supports (data available) |
| Camel's agent pipeline uses sequential columns with tool registry | `server/src/agent/service.ts` | Supports (architecture supports new templates) |
| Creative brief targets "small dev team" with kanban | `docs/pocket/rule/creative-brief.md` | Context filter |

## Curation notes

**Advisor curation (Gate 3) identified:**

Strongest evidence:

- Industry convergence across 6+ independent sources naming same ~8-10 repetitive PM workflows
- Capterra 2024 survey data (54% risk mgmt, 53% task automation) — dated, survey-based, recognized source
- Codebase gap analysis: metrics.ts, card_events exist but no managerial templates

Weakest evidence (downweighted):

- YouTube/LinkedIn sources are promotional, not research — treated as flavor only
- "80% by 2030" is single Gartner prediction — cited as prediction, not fact

Critical gaps addressed:

1. **User persona filter:** Creative brief targets "small dev team" — enterprise workflows (budget tracking, resource allocation, multi-project) filtered out
2. **Technical feasibility:** Current pipeline has no DB-query tools (only web_search, create_file) — status report templates would need new `query_board_data` tool
3. **Prioritization:** Applied impact × feasibility matrix

Contradictions acknowledged:

- Sources say automation saves 5-10 hrs/week, but also say 42% of PM tasks can't be automated (Unito)

## Verdict & reasoning

**Confirmed (Medium confidence).**

The assumption is supported by multiple independent industry sources (6+) that consistently identify repetitive managerial workflows suitable for automation. The codebase analysis confirms Camel has the data infrastructure (metrics, activity feed) and architecture (template pipeline, tool registry) to support new templates, but currently only has 1 template (research-report). The disconfirming observation (no applicable workflows found) did NOT occur — instead, 4 viable candidate templates were identified after filtering for small dev team relevance.

Confidence is Medium (not High) because:

1. Industry sources are mostly enterprise-focused; small dev team specific data is thinner
2. Technical feasibility requires a new tool (`query_board_data`) that hasn't been built or validated
3. The 42% automation ceiling (Unito) means not all workflows are viable

## Candidate Templates (Prioritized)

### 🥇 Priority 1: Status/Progress Report

- **Frequency:** Very high (6+ sources cite as top automation target)
- **Data source:** `metrics.ts` (cycle time, throughput, flow efficiency) + `card_events` (activity)
- **Tool needed:** `query_board_data` (new) — to read metrics and activity from DB
- **Pipeline:** Research Specialist → Data Analyst → Writer → Editor → QA Guardian
- **Small team fit:** High — even small teams need to update stakeholders/leads

### 🥈 Priority 2: Daily Standup Summary

- **Frequency:** High (multiple sources, core agile practice)
- **Data source:** `card_events` (recent activity: moves, completions, blocks)
- **Tool needed:** `query_board_data` (new)
- **Pipeline:** Activity Collector → Summary Writer → QA Guardian
- **Small team fit:** Very high — daily standup is universal in agile teams

### 🥉 Priority 3: Retrospective Analysis

- **Frequency:** Medium (agile-specific sources)
- **Data source:** `metrics` (cycle time trends, throughput) + `card_events` (what moved, what blocked)
- **Tool needed:** `query_board_data` (new)
- **Pipeline:** Data Collector → Pattern Analyst → Insight Writer → QA Guardian
- **Small team fit:** High — core agile ceremony

### Priority 4: Sprint/Iteration Planning

- **Frequency:** Medium (agile sources)
- **Data source:** `cards` (backlog) + `columns` (workflow stages) + historical velocity
- **Tool needed:** `query_board_data` (new)
- **Pipeline:** Backlog Analyst → Capacity Planner → Sprint Plan Writer → QA Guardian
- **Small team fit:** Medium-High — useful but more complex

### Deprioritized: Task Delegation

- **Reason:** Already handled by kanban board manual workflow; automation adds marginal value for small teams

## Recommendation (non-binding)

1. **Adopt:** Build `query_board_data` tool first — this is the foundation for all managerial templates
2. **Adopt:** Start with **Status Report** template (Priority 1) — highest frequency, clearest data sources
3. **Adopt:** Follow with **Daily Standup** template (Priority 2) — very high small team fit
4. **Investigate further:** Validate whether the sequential 5-column pipeline shape fits managerial workflows (some may need parallel execution or conditional branching)
5. **Adapt:** Consider making templates configurable — small teams may want different report formats

## What would change this verdict

- **Refuted:** If `query_board_data` tool proves technically infeasible (e.g., metrics data insufficient for meaningful reports)
- **Refuted:** If small dev teams in user research indicate they don't use status reports or standups
- **Downgraded to Inconclusive:** If the sequential pipeline shape doesn't fit managerial workflows (need parallel/conditional execution)
- **Upgraded to High confidence:** If user validation confirms demand + technical spike proves feasibility

---

## Appendix: Evidence Sources

### Industry Sources (Triangulation)

1. Atlassian — Workflow automation for project management
2. Monday.com — Project management automation statistics 2025
3. IBM — Task automation definition and examples
4. Capterra — 2024 Most Impactful Project Management Tool Survey
5. Breeze — Task management statistics 2026
6. Monograph — 10 Project Management Tasks to Automate
7. Unito — Project Management Automation: 8 Use Cases
8. Mosaicapp — Project Management Software Statistics 2025
9. PPM Express — Top 65+ Project Management Statistics 2024
10. Plaky — Project Management Statistics and Trends 2026

### Codebase Sources

- `server/src/agent/templates.ts` — Template definitions (1 template: research-report)
- `server/src/agent/service.ts` — Agent pipeline architecture
- `server/src/agent/routes.ts` — Agent API endpoints
- `server/src/core/metrics.ts` — Flow metrics computation
- `server/src/db/schema.sql` — Database schema (cards, columns, card_events)
- `server/src/db/agent-schema.sql` — Agent subsystem schema
- `docs/pocket/rule/creative-brief.md` — Design system and target persona

### Counterexample Sources (Adversarial)

- Celoxis — Where automation fails under pressure
- Rocketlane — Limitations of project management automation
- Unito — 42% of PM tasks cannot be automated
