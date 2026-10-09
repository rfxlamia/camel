# Research Report — Chatbot vs Form for Kanban Card Creation: User Preference

- **Date:** 2026-06-12
- **Verdict:** Refuted
- **Confidence:** Medium

## Assumption tested

"Pengguna lebih suka membuat card di kanban board melalui chatbot (natural language) dibanding form manual (click + fill fields) — chatbot meningkatkan kepuasan dan adoption."

**Disconfirming observation:** Jika studi UX, data empiris, atau bukti konkret menunjukkan user lebih suka form manual (karena lebih predictable, transparan, dan kontrol penuh) — maka chatbot bukan preferensi user, melainkan preferensi developer.

## Methods used

1. **Source Triangulation** (triangulation) — Cross-check dari ≥7 sumber independen tentang chatbot vs form preference
2. **Perspective Sampling** (elicitation) — Analisis dari 3 perspektif: end-user, UX designer, product manager
3. **Pre-Mortem** (adversarial) — Asumsikan chatbot gagal, identifikasi failure modes
4. **Bayesian Updating** (probabilistic) — Kalibrasi confidence dari prior 40% → posterior 25%

## Evidence

| # | Finding | Source | Supports / Refutes |
|---|---------|--------|--------------------|
| 1 | Chatbots require MORE cognitive effort than menu-based interfaces, result in LOWER perceived autonomy, and lead to LOWER user satisfaction (Nguyen, Sidorova & Torres) | [width.ai](https://www.width.ai/post/do-users-prefer-chatbots-or-menu-based-formats) | **Refutes** |
| 2 | Users prefer chatbots for ROUTINE tasks (finding info 72.4%, paying bills 54.7%) but prefer HUMANS for complex, high-stakes tasks | [buildcommonwealth.org](https://buildcommonwealth.org/blog/chatbot-or-human-research-shows-preference-is-based-on-task) | **Mixed** |
| 3 | User preferences are HIGHLY CONTEXT-DEPENDENT — for subjective/empathy tasks favor humans; for objective/analytical tasks bots may be preferred (Castelo et al., 2019) | [uxpsychology.substack.com](https://uxpsychology.substack.com/p/do-users-prefer-chatbots-over-humans) | **Mixed** |
| 4 | CUI satisfaction: ease of use 82%, but Understanding Intent drops to 69%, Trust/Transparency lowest at 60% (GJETA 2025) | [gjeta.com PDF](https://gjeta.com/sites/default/files/fulltext_pdf/GJETA-2025-0172.pdf) | **Refutes** |
| 5 | Intercom data: conversational lead qualification flows have 35–40% higher completion rates vs traditional multi-field forms | [marcfriedmanportfolio.com](https://www.marcfriedmanportfolio.com/blog/conversational-ui-chat-interfaces) | **Supports** |
| 6 | NN/g: "I would not use the Domino's chatbot… On the site, I'm already logged in" — power users prefer existing shortcuts | [nngroup.com](https://www.nngroup.com/articles/chatbots) | **Refutes** |
| 7 | "Sometimes, a well-designed button can outperform typing out a request" — visual browsing may provide more satisfaction than Q&A (Fruto Design) | [fruto.design](https://fruto.design/blog/the-future-of-usability-conventions-in-the-age-of-conversational-ai) | **Refutes** |
| 8 | "The future isn't either/or — it's both/and" — when AI needs multiple inputs, a proper form is better. Serve the right interface at the right moment | [LinkedIn](https://www.linkedin.com/posts/maksym-chervynskyi_the-future-of-ui-isnt-eitheror-its-both-activity-7382087192652713984-Z1FZ) | **Refutes** |
| 9 | "Most deployed chatbots make UX WORSE, not better" — replacing faster direct navigation is a failure pattern. Hybrid model recommended | [marcfriedmanportfolio.com](https://www.marcfriedmanportfolio.com/blog/conversational-ui-chat-interfaces) | **Refutes** |
| 10 | Kanban Tool AI: "Suggest tasks" creates cards faster, but augments (suggest), does NOT replace form | [kanbantool.com](https://kanbantool.com/support/integrations/how-does-kanban-tool-integrate-with-openai) | **Mixed** |

### Bayesian Updating

| Element | Value |
|---------|-------|
| Prior confidence | 40% — "Chatbot mungkin lebih disukai" |
| Evidence for | Intercom +35-40% completion rate (moderate strength) |
| Evidence against | Higher cognitive effort, lower autonomy, lower satisfaction (strong); NN/g power user rejection (strong); "most chatbots make UX worse" (strong); intent understanding 69% (moderate) |
| **Posterior confidence** | **~25%** — chatbot preference is unlikely for structured card creation |

## Curation notes

**Strongest support:** Intercom +35-40% completion rate — tapi dari konteks berbeda (lead qualification ≠ kanban card creation). Lead qualification mengumpulkan info dari user; card creation meng-struktur-kan data ke predefined fields. Task type berbeda.

**Strongest refutation:** Nguyen et al. (cognitive effort ↑, autonomy ↓, satisfaction ↓) + NN/g power user rejection + "most chatbots make UX worse" (Marc Friedman meta-observation).

**Key contradictions:**
1. Intercom data vs Nguyen study — completion rate tinggi tapi satisfaction rendah. Resolution: konteks Intercom (lead qualification) lebih simple dan kurang structured dari kanban card creation.
2. "Chatbots good for routine tasks" vs "Chatbots require more cognitive effort" — routine ≠ structured multi-field input.

**Key gaps:**
1. Tidak ada studi langsung tentang kanban/project management + chatbot — semua dari domain adjacent
2. Simple vs complex card creation: chatbot mungkin work untuk quick-add (title only), tapi form superior untuk multi-field structured input
3. Camel's user profile: small dev teams (technical users) — cenderung prefer precision & control (CLI > GUI analogy)

**Inline fallback used** — advisor tool available and returned full curation.

## Verdict & reasoning

**Verdict: Refuted (confidence: medium)**

Evidence menunjukkan bahwa untuk **structured multi-field input** (seperti membuat kanban card dengan title, description, assignee, priority, labels), **form manual lebih disukai** dibanding chatbot. Tiga sumber kuat (Nguyen et al., NN/g, Marc Friedman meta-observation) secara konsisten menunjukkan bahwa chatbot meningkatkan cognitive load, mengurangi perceived autonomy, dan menurunkan user satisfaction untuk task yang memerlukan structured input. Satu-satunya sumber yang mendukung chatbot (Intercom data) berasal dari konteks yang berbeda (lead qualification) dan tidak dapat di-apply langsung ke kanban card creation.

Namun, confidence adalah **medium** (bukan high) karena:
1. Tidak ada studi langsung tentang kanban + chatbot
2. Chatbot mungkin tetap berguna untuk **simple quick-add** (title only, tanpa multi-field)
3. Domain spesifik Camel (small dev teams) belum ter-studi secara langsung

## Recommendation (non-binding)

**Jangan buat chatbot sebagai replacement untuk form.** Sebaliknya, pertimbangkan **hybrid approach:**

1. **Form tetap sebagai primary interface** — untuk card creation dengan multi-field input (title, description, assignee, priority, labels)
2. **Chatbot/quick-add sebagai optional supplement** — untuk simple card creation (title only) yang kemudian bisa di-refine via form
3. **Jika tetap ingin chatbot** — pastikan:
   - NLP accuracy >95% untuk structured multi-field parsing
   - Ada confirmation step sebelum card dibuat (show parsed result, user approve)
   - Ada fallback ke form jika chatbot gagal parse
   - Measure: task completion rate, error rate, user satisfaction

**Alternatif yang lebih practical:**
- **Quick-add button** di setiap column — satu click → mini form (title + priority) → card created
- **Keyboard shortcut** untuk power users — Ctrl+N → quick form
- **AI-assisted field filling** — user fill title, AI suggests description/priority/assignee

## What would change this verdict

1. **A controlled study** showing users prefer chatbot for kanban card creation specifically
2. **Evidence that hybrid approach** (chatbot for simple adds, form for complex) outperforms pure form
3. **Data showing NLP intent understanding >95%** for structured multi-field project management input
4. **User testing with Camel's actual user base** (small dev teams) showing preference for chatbot

---

*Research conducted following structured-research methodology. Sources triangulated from academic studies, industry UX research, and product-specific evidence.*
