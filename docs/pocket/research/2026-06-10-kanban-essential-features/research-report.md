# Research Report — Fitur Esensial Kanban dan Dampaknya terhadap Team Progress

- **Date:** 2026-06-10
- **Verdict:** Confirmed (with conditions)
- **Confidence:** Medium

---

## Assumption tested

**Operationalized question:**
> "Fitur esensial kanban (WIP limits, visual workflow, explicit policies, feedback loops, continuous improvement) secara signifikan meningkatkan progress team dibandingkan tidak menggunakan fitur-fitur tersebut."

**Disconfirming observation:**
- Evidence menunjukkan fitur-fitur tersebut tidak berdampak signifikan, atau
- Ada pendekatan lain yang lebih efektif tanpa fitur-fitur tersebut, atau
- Evidence terlalu lemah/kontradiktif untuk mendukung klaim ini

---

## Methods used

| # | Method | Category | Digunakan untuk |
|---|--------|----------|-----------------|
| 1 | Source Triangulation | Triangulation | Cross-check definisi, fitur esensial, dan evidence dari ≥3 sumber independen |
| 2 | First-Principles Decomposition | Analytical | Break down prinsip dasar dan mekanisme kerja ke atomic sub-claims |
| 3 | Falsification | Adversarial | Actively hunt evidence yang membantah efektivitas kanban |

---

## Evidence Summary

### A. Definisi Fundamental Kanban

| Sumber | Definisi |
|--------|----------|
| Toyota UK Magazine | "Quick-response system through which Just-In-Time production is achieved" |
| Toyota Global | "Tool that describes which and how many parts are used where and when" |
| Wikipedia | "Scheduling system for lean manufacturing (just-in-time manufacturing)" |
| David Anderson | "Method for defining, managing, and improving services that deliver knowledge work" |

**Consensus:** Kanban adalah **pull-based visual scheduling system** dari Toyota Production System (TPS) untuk **Just-In-Time delivery** dengan **eliminasi waste** (muda, muri, mura).

---

### B. Fitur Esensial (6 Features)

| Fitur | Mekanisme | Sumber yang Mendukung |
|-------|-----------|----------------------|
| **1. Visualize Workflow** | Invisible work → visible; spot bottlenecks | Semua sumber ✅ |
| **2. WIP Limits** | Force completion, reduce context-switching | Semua sumber ✅ |
| **3. Manage Flow** | Identify bottleneck → realokasi resource | Semua sumber ✅ |
| **4. Explicit Policies** | Reduce ambiguity, accelerate decisions | 3/4 sumber ✅ |
| **5. Feedback Loops** | Regular review, adapt based on data | 2/4 sumber ✅ |
| **6. Continuous Improvement** | Incremental evolution, kaizen mindset | Semua sumber ✅ |

---

### C. Evidence Empiris

| Case Study | Hasil | Sumber |
|------------|-------|--------|
| Vanguard (investment) | 4x throughput, 1/4 lead time | Kanban University |
| Microsoft XIT | Worst → best service record | Kanban University |
| General studies | Up to 50% productivity boost | Orangescrum (blog, bukan peer-reviewed) |
| Task switching | 40% less time on context-switching | Orangescrum (blog) |

**Academic studies:**
- ACM 2018: "An empirical study of WIP in kanban teams"
- IEEE 2012: "Quantifying the Effect of Using Kanban vs. Scrum"
- Semantic Scholar: "Increased effectiveness, better collaboration"

---

### D. Counter-Evidence (Falsification)

| Counter-evidence | Sumber | Severity |
|------------------|--------|----------|
| "Not suitable for timeline-based projects" | GeeksforGeeks | High |
| "Limited predictability" | AgileFever | High |
| "Success depends on disciplined execution" | AgileFever | Medium |
| "Less scalable than Scrum" | GeeksforGeeks | Medium |
| "Treating Kanban as PM approach is begging for failure" | Brodzinski | High |

**Common failure modes:**
1. ❌ Not respecting WIP limits
2. ❌ Board doesn't reflect reality
3. ❌ No buy-in from team
4. ❌ Over-complicated boards

---

## Curation Notes (from Advisor)

### Strongest Support
- Toyota official sources — authoritative, primary-source, no vendor bias
- David Anderson's 5 properties — canonical, widely cited
- Consensus across 4+ independent sources — triangulation solid
- Case studies with quantified outcomes (Vanguard, Microsoft)

### Strongest Counter-Evidence
- Brodzinski's critique — from respected practitioner, not competitor
- Hidden dependency on disciplined execution
- Timeline-based project limitation

### Gaps
| Gap | Impact |
|-----|--------|
| Vendor bias (tool vendors) | High |
| Academic evidence thin | Medium |
| "Progress" metric undefined | High |
| Context-dependency under-explored | Medium |

### Key Contradiction
> "Kanban is simple" vs "Failure to understand Kanban is the most common reason it fails"
> **Simplicity is deceptive.**

---

## Verdict & Reasoning

**Verdict: Confirmed (with conditions)**

**Confidence: Medium**

Evidence mendukung klaim bahwa fitur esensial kanban (WIP limits, visual board, explicit policies) **demonstrably meningkatkan flow metrics** (lead time, throughput, bottleneck visibility) dalam konteks **software/IT teams** dengan **disciplined execution**.

Namun, verdict ini **dengan syarat**:
1. **Boundary conditions** — bukti terkuat berasal dari software/IT teams, bukan universal
2. **Execution dependency** — keberhasilan sangat bergantung pada disiplin tim dalam mengikuti WIP limits dan menjaga board tetap aktual
3. **Metric specificity** — "team progress" harus didefinisikan sebagai flow metrics (lead time, throughput, cycle time), bukan output generik

---

## Recommendation (Non-Binding)

### Untuk Project Kanban Ini:

1. **Implementasikan 6 fitur esensial** — Visualize, WIP Limits, Manage Flow, Explicit Policies, Feedback Loops, Continuous Improvement

2. **Mulai dari yang sederhana** — Jangan over-complicate boards. Gunakan 3-5 kolom saja.

3. **Disiplin adalah kunci** — Pastikan semua tim buy-in dan konsisten update board. Tanpa ini, Kanban akan gagal.

4. **Track flow metrics** — Lead time, throughput, cycle time. Ini yang terbukti meningkat, bukan "produktivitas" secara generik.

5. **Expect limitations** — Kanban kurang cocok untuk fixed-deadline projects. Gunakan hybrid approach jika perlu.

---

## What Would Change This Verdict

| Jika ditemukan... | Verdict berubah ke... |
|-------------------|----------------------|
| Controlled study yang menunjukkan Kanban tidak efektif | Refuted |
| Evidence bahwa fitur esensial tidak berkontribusi pada improvement | Refuted |
| Bukti bahwa disciplined execution bukan faktor kunci | Confirmed (tanpa syarat) |
| Academic studies 2020-2024 dengan sample besar | Confidence → High |

---

## Appendix: Rumusan Masalah (First-Principles)

1. **Definisi Fundamental** — Apa prinsip dasar yang membuat kanban berbeda?
2. **Komponen Esensial** — Fitur apa yang secara konsisten disebut "essential"?
3. **Mekanisme Kerja** — Bagaimana setiap fitur secara mekanistik mempengaruhi workflow?
4. **Evidence Empiris** — Apa bukti empiris bahwa fitur-fitur tersebut efektif?
5. **Outcome** — Bagaimana hubungan dengan metrik team progress?

---

*Research conducted: 2026-06-10*
*Sources: Toyota official sites, Kanban University, Atlassian, ACM, IEEE, industry blogs*
*Methods: Source Triangulation, First-Principles Decomposition, Falsification*
